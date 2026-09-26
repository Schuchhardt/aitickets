// Función programada (cada 10 minutos): libera las órdenes pendientes cuya reserva de stock venció y
// retoma las órdenes 'processing' abandonadas.
// 1) Expiración: marca 'expired' las órdenes 'pending' con hold_expires_at < now() (o sin hold y creadas
//    hace > 15 min), máx. BATCH_LIMIT por corrida. El stock ya dejaba de contarse al vencer la reserva;
//    esto deja el estado explícito y cierra el checkout del proveedor.
//    - Stripe: expira la Checkout Session abierta para que no se pueda pagar sobre stock liberado. Si la
//      sesión ya no estaba abierta se consulta: cobrada -> se cumple (confirmPaidOrder), pago asíncrono en
//      curso -> se deja pendiente, expirada -> se expira la orden. Si no se puede verificar (error de la API)
//      se reintenta en la próxima corrida; pasado el máximo de vida de una sesión (24 h) se expira igual.
//    - Flow: la orden de pago ya expira sola (timeout = reserva) al crearla.
//    - Rollback: el código anterior no reclama 'expired'; ver el runbook en db/migrations/README.md.
//    - Un pago tardío igual se procesa: confirmPaidOrder puede reclamar órdenes 'expired' (se cumple o
//      queda en 'review' si ya no hay stock).
// 2) Barrido de 'processing': una orden queda en 'processing' si la invocación que la cumplía murió
//    (timeout, OOM) sin terminar; el webhook de Stripe ya registró el evento y sus reintentos no la retoman,
//    y aitickets_ticket_availability la sigue contando. Con más de PROCESSING_STALE_MINUTES se consulta el
//    estado al proveedor (payments/reconcile.mjs) y, si está pagada, se llama a confirmPaidOrder
//    (idempotente: no duplica entradas ni correo). Si no se puede verificar, aviso a Slack (una vez).
// - Presupuesto: < 30 s por corrida (límite de funciones programadas).
import { getSupabaseAdmin, json } from '../../lib/supabase.mjs'
import { expireStripeSession } from '../../lib/payments/stripe.mjs'
import { reconcileOrder, reconcileStripeOrder } from '../../lib/payments/reconcile.mjs'
import { isMissingSchemaError, PROCESSING_STALE_MINUTES, LEGACY_HOLD_MINUTES } from '../../lib/orders.mjs'
import { notifySlack } from '../../lib/slack.mjs'

const BATCH_LIMIT = 100
const SWEEP_LIMIT = 20
const TIME_BUDGET_MS = 20000
/** Una Checkout Session vive como máximo 24 h: pasado eso ya no se puede cobrar. */
const STRIPE_SESSION_MAX_MS = 24 * 60 * 60 * 1000
/** Ventana (una corrida del cron) en la que se avisa a Slack de un 'processing' que no se pudo conciliar. */
const STUCK_ALERT_AFTER_MINUTES = 30
const CRON_INTERVAL_MINUTES = 10

const minutesAgoIso = (minutes) => new Date(Date.now() - minutes * 60 * 1000).toISOString()

/** Decide si una orden pendiente de Stripe vencida se puede expirar. Devuelve true para expirarla. */
async function settleStripeOrder(supabase, order, counters) {
  const result = await expireStripeSession(order.provider_session_id)
  if (result === 'expired') {
    counters.sessions++
    return true
  }
  // Stripe sin configurar: no hay forma de cobrar ni de verificar; se libera como antes.
  if (!process.env.STRIPE_SECRET_KEY) return true

  // 'not_open' (ya completada o ya expirada) o 'error': preguntar a Stripe antes de liberar el stock.
  const rec = await reconcileStripeOrder(supabase, order)
  switch (rec.outcome) {
    case 'confirmed':
    case 'retry':
      counters.recovered++
      console.log(`expire-pending-orders: la orden ${order.id} ya estaba cobrada en Stripe (${rec.result?.status}); no se expira`)
      return false
    case 'payment_pending':
      return false
    case 'session_expired':
      return true
    default: {
      // 'open' (no se pudo expirar) o 'error': reintentar en la próxima corrida, salvo que la sesión ya no
      // pueda existir (más de 24 h desde el vencimiento de la reserva).
      const holdEnd = Date.parse(order.hold_expires_at || '') || (Date.parse(order.created_at || '') + LEGACY_HOLD_MINUTES * 60 * 1000)
      if (Number.isFinite(holdEnd) && Date.now() - holdEnd > STRIPE_SESSION_MAX_MS) return true
      console.warn(`expire-pending-orders: no se pudo verificar la sesión de Stripe de ${order.id} (${rec.outcome}${rec.message ? `: ${rec.message}` : ''}); se reintenta`)
      return false
    }
  }
}

async function expirePending(supabase, started, counters) {
  // Vencidas: hold_expires_at pasado, u órdenes antiguas sin hold creadas hace más de 15 minutos.
  const expiredFilter = () => {
    const now = new Date()
    const legacy = new Date(now.getTime() - LEGACY_HOLD_MINUTES * 60 * 1000).toISOString()
    return `hold_expires_at.lt.${now.toISOString()},and(hold_expires_at.is.null,created_at.lt.${legacy})`
  }

  const { data: orders, error } = await supabase
    .from('event_orders')
    .select('id, created_at, hold_expires_at, payment_provider, provider_session_id')
    .eq('status', 'pending')
    .or(expiredFilter())
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT)
  if (error) {
    if (isMissingSchemaError(error)) {
      console.warn('expire-pending-orders: la base aún no tiene hold_expires_at; nada que hacer')
      return { skipped: 'schema' }
    }
    throw new Error(`error leyendo órdenes: ${error.message}`)
  }
  counters.scanned = orders?.length || 0

  for (const order of orders || []) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    // Primero cerrar el checkout; si Stripe ya cobró, se cumple en vez de expirar.
    if (order.payment_provider === 'stripe' && order.provider_session_id) {
      const canExpire = await settleStripeOrder(supabase, order, counters)
      if (!canExpire) continue
    }
    const { data: updated, error: updateError } = await supabase
      .from('event_orders')
      .update({ status: 'expired' })
      .eq('id', order.id)
      .eq('status', 'pending')
      .or(expiredFilter())
      .select('id')
    if (updateError) {
      console.error(`expire-pending-orders: no se pudo expirar ${order.id}:`, updateError.message)
      continue
    }
    if (updated?.length) counters.expired++
  }
  return {}
}

async function sweepProcessing(supabase, started, counters) {
  const staleBefore = minutesAgoIso(PROCESSING_STALE_MINUTES)
  let { data: stuck, error } = await supabase
    .from('event_orders')
    .select('id, event_id, processing_started_at, payment_provider, provider_session_id')
    .eq('status', 'processing')
    .or(`processing_started_at.lt.${staleBefore},processing_started_at.is.null`)
    .order('processing_started_at', { ascending: true, nullsFirst: true })
    .limit(SWEEP_LIMIT)
  if (error && isMissingSchemaError(error)) {
    // Base sin migrar (sin payment_provider/provider_session_id): solo Flow existía
    ;({ data: stuck, error } = await supabase
      .from('event_orders')
      .select('id, event_id, processing_started_at')
      .eq('status', 'processing')
      .or(`processing_started_at.lt.${staleBefore},processing_started_at.is.null`)
      .limit(SWEEP_LIMIT))
  }
  if (error) {
    console.error('expire-pending-orders: error leyendo órdenes en processing:', error.message)
    return
  }

  const alertFrom = Date.now() - (STUCK_ALERT_AFTER_MINUTES + CRON_INTERVAL_MINUTES) * 60 * 1000
  const alertTo = Date.now() - STUCK_ALERT_AFTER_MINUTES * 60 * 1000
  for (const order of stuck || []) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    const rec = await reconcileOrder(supabase, order)
    if (rec.outcome === 'confirmed' || rec.outcome === 'retry') {
      counters.recovered++
      console.log(`expire-pending-orders: orden ${order.id} retomada desde 'processing' (${rec.result?.status})`)
      continue
    }
    console.warn(`expire-pending-orders: orden ${order.id} en 'processing' sin conciliar (${rec.outcome}${rec.message ? `: ${rec.message}` : ''})`)
    // Aviso único: solo en la corrida que cae en la ventana [30, 40) min desde processing_started_at
    // (sin reclamo de por medio, processing_started_at no cambia entre corridas).
    const startedAt = Date.parse(order.processing_started_at || '')
    const inWindow = Number.isFinite(startedAt) ? startedAt >= alertFrom && startedAt < alertTo : false
    if (inWindow) {
      await notifySlack(`⚠️ La orden ${order.id} (evento ${order.event_id}, ${order.payment_provider || 'flow'}) lleva más de ${STUCK_ALERT_AFTER_MINUTES} min en 'processing' y no se pudo conciliar con el proveedor (${rec.outcome}). Sigue reteniendo stock: revisar el pago y emitir o liberar manualmente.`)
    }
  }
}

export default async function handler() {
  const started = Date.now()
  const supabase = getSupabaseAdmin()
  const counters = { expired: 0, sessions: 0, recovered: 0, scanned: 0 }

  let skipped
  try {
    ;({ skipped } = await expirePending(supabase, started, counters))
  } catch (err) {
    console.error('expire-pending-orders:', err?.message)
    return json({ message: 'Error leyendo órdenes' }, 500)
  }

  try {
    await sweepProcessing(supabase, started, counters)
  } catch (err) {
    console.error('expire-pending-orders: error en el barrido de processing:', err?.message)
  }

  const { expired, sessions, recovered, scanned } = counters
  if (expired || sessions || recovered) {
    console.log(`⏱️ expire-pending-orders: ${expired} orden(es) expiradas, ${sessions} sesión(es) de Stripe cerradas, ${recovered} orden(es) cobradas retomadas`)
  }
  return json({ expired, stripeSessions: sessions, recovered, scanned, ...(skipped ? { skipped } : {}) }, 200)
}

export const config = {
  schedule: '*/10 * * * *',
}
