// Función programada (cada 10 minutos): libera las órdenes pendientes cuya reserva de stock venció y
// retoma las órdenes 'processing' abandonadas.
// 1) Expiración: marca 'expired' las órdenes 'pending' con hold_expires_at < now() (o sin hold y creadas
//    hace > 15 min), máx. BATCH_LIMIT por corrida. El stock ya dejaba de contarse al vencer la reserva;
//    esto deja el estado explícito. La orden de pago de Flow ya expira sola (timeout = reserva) al crearla.
//    - Rollback: el código anterior no reclama 'expired'; ver el runbook en db/migrations/README.md.
//    - Un pago tardío igual se procesa: confirmPaidOrder puede reclamar órdenes 'expired' (se cumple o
//      queda en 'review' si ya no hay stock).
// 2) Barrido de 'processing': una orden queda en 'processing' si la invocación que la cumplía murió
//    (timeout, OOM) sin terminar, y aitickets_ticket_availability la sigue contando. Con más de PROCESSING_STALE_MINUTES se consulta el
//    estado al proveedor (payments/reconcile.mjs) y, si está pagada, se llama a confirmPaidOrder
//    (idempotente: no duplica entradas ni correo). Si no se puede verificar, aviso a Slack (una vez).
// - Presupuesto: < 30 s por corrida (límite de funciones programadas).
import { getSupabaseAdmin, json } from '../../lib/supabase.mjs'
import { reconcileOrder } from '../../lib/payments/reconcile.mjs'
import { isMissingSchemaError, PROCESSING_STALE_MINUTES, LEGACY_HOLD_MINUTES } from '../../lib/orders.mjs'
import { notifySlack } from '../../lib/slack.mjs'

const BATCH_LIMIT = 100
const SWEEP_LIMIT = 20
const TIME_BUDGET_MS = 20000
/** Ventana (una corrida del cron) en la que se avisa a Slack de un 'processing' que no se pudo conciliar. */
const STUCK_ALERT_AFTER_MINUTES = 30
const CRON_INTERVAL_MINUTES = 10

const minutesAgoIso = (minutes) => new Date(Date.now() - minutes * 60 * 1000).toISOString()

async function expirePending(supabase, started, counters) {
  // Vencidas: hold_expires_at pasado, u órdenes antiguas sin hold creadas hace más de 15 minutos.
  const expiredFilter = () => {
    const now = new Date()
    const legacy = new Date(now.getTime() - LEGACY_HOLD_MINUTES * 60 * 1000).toISOString()
    return `hold_expires_at.lt.${now.toISOString()},and(hold_expires_at.is.null,created_at.lt.${legacy})`
  }

  const { data: orders, error } = await supabase
    .from('event_orders')
    .select('id, created_at, hold_expires_at, payment_provider')
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
    // PostgREST 12.2 falla (42703) si un UPDATE con filtro or()/and() pide la fila de vuelta
    // (return=representation): se usa count exacto y, si hace falta, una lectura aparte.
    const { count: updatedCount, error: updateError } = await supabase
      .from('event_orders')
      .update({ status: 'expired' }, { count: 'exact' })
      .eq('id', order.id)
      .eq('status', 'pending')
      .or(expiredFilter())
    if (updateError) {
      console.error(`expire-pending-orders: no se pudo expirar ${order.id}:`, updateError.message)
      continue
    }
    if (updatedCount) counters.expired++
  }
  return {}
}

async function sweepProcessing(supabase, started, counters) {
  const staleBefore = minutesAgoIso(PROCESSING_STALE_MINUTES)
  let { data: stuck, error } = await supabase
    .from('event_orders')
    .select('id, event_id, processing_started_at, payment_provider')
    .eq('status', 'processing')
    .or(`processing_started_at.lt.${staleBefore},processing_started_at.is.null`)
    .order('processing_started_at', { ascending: true, nullsFirst: true })
    .limit(SWEEP_LIMIT)
  if (error && isMissingSchemaError(error)) {
    // Base sin migrar (sin payment_provider)
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
  const counters = { expired: 0, recovered: 0, scanned: 0 }

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

  const { expired, recovered, scanned } = counters
  if (expired || recovered) {
    console.log(`⏱️ expire-pending-orders: ${expired} orden(es) expiradas, ${recovered} orden(es) cobradas retomadas`)
  }
  return json({ expired, recovered, scanned, ...(skipped ? { skipped } : {}) }, 200)
}

export const config = {
  schedule: '*/10 * * * *',
}
