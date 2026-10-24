// Función programada (cada 10 minutos): libera las órdenes pendientes cuya reserva de stock venció,
// rescata los pagos de Flow cuyo webhook no llegó y retoma las órdenes 'processing' abandonadas.
// 1) Expiración: las órdenes 'pending' con hold_expires_at < now() (o sin hold y creadas hace > 15 min),
//    máx. BATCH_LIMIT por corrida. El stock ya dejaba de contarse al vencer la reserva; esto deja el estado
//    explícito. La orden de pago de Flow ya expira sola (timeout = reserva) al crearla.
//    - Conciliación antes de expirar: si la orden llegó a Flow (payment_external_id = flowOrder), se consulta
//      su estado (payments/reconcile.mjs), lo mismo que haría el webhook si hubiera llegado:
//        pagada            → confirmPaidOrder (idempotente: entradas + correo; 'review' si ya no hay stock)
//        rechazada/anulada → 'rejected' / 'cancelled', como el webhook
//        pendiente en Flow → 'expired' (el comprador no terminó; la revisión tardía la vuelve a mirar)
//        no se pudo consultar (Flow caído, timeout) o sin cupo en esta corrida → sigue 'pending' (sin
//        reserva ya no retiene stock) y se reintenta en la próxima corrida, hasta reserva + RECONCILE_GRACE_MINUTES;
//        después se expira igual (un pago tardío lo sigue cumpliendo el webhook).
//    - Rollback: el código anterior no reclama 'expired'; ver el runbook en db/migrations/README.md.
//    - Un pago tardío igual se procesa: confirmPaidOrder puede reclamar órdenes 'expired' (se cumple o
//      queda en 'review' si ya no hay stock).
// 2) Barrido de 'processing': una orden queda en 'processing' si la invocación que la cumplía murió
//    (timeout, OOM) sin terminar, y aitickets_ticket_availability la sigue contando. Con más de PROCESSING_STALE_MINUTES se consulta el
//    estado al proveedor (payments/reconcile.mjs) y, si está pagada, se llama a confirmPaidOrder
//    (idempotente: no duplica entradas ni correo). Si no se puede verificar, aviso a Slack (una vez).
// 3) Revisión tardía: cada orden de Flow expirada se consulta una vez más (o dos), en las corridas que caen en
//    [LATE_CHECK_AFTER_MINUTES, +LATE_CHECK_WINDOW_MINUTES) min desde que venció su reserva. Atrapa el pago que se completó justo al
//    vencer (Webpay iniciado antes del timeout de Flow) y cuyo webhook se perdió. Usa el mismo camino de pago
//    tardío del webhook (confirmPaidOrder reclama 'expired'; 'review' si ya no hay stock o código).
// - Cada rescate (pagada en Flow sin webhook) avisa a Slack: es la señal de que el webhook está fallando.
// - Presupuesto: < 30 s por corrida (límite de funciones programadas). Las consultas a Flow tienen timeout y
//   tope por corrida; no se inicia una conciliación pasado RECONCILE_BUDGET_MS.
import { getSupabaseAdmin, json } from '../../lib/supabase.mjs'
import { reconcileOrder } from '../../lib/payments/reconcile.mjs'
import { FLOW_STATUS, isFlowConfigured } from '../../lib/payments/flow.mjs'
import { isMissingSchemaError, markOrderFailed, PROCESSING_STALE_MINUTES, LEGACY_HOLD_MINUTES } from '../../lib/orders.mjs'
import { notifySlack } from '../../lib/slack.mjs'

const BATCH_LIMIT = 100
const SWEEP_LIMIT = 20
const TIME_BUDGET_MS = 20000
/** Ventana (una corrida del cron) en la que se avisa a Slack de un 'processing' que no se pudo conciliar. */
const STUCK_ALERT_AFTER_MINUTES = 30
const CRON_INTERVAL_MINUTES = 10

/** Consultas a Flow por corrida al expirar pendientes. */
export const RECONCILE_PENDING_LIMIT = 25
/** Consultas a Flow por corrida en la revisión tardía de expiradas. */
export const RECONCILE_EXPIRED_LIMIT = 10
/** Un pendiente que Flow no deja verificar se reintenta hasta su reserva + estos minutos; después se expira. */
export const RECONCILE_GRACE_MINUTES = 30
/** Minutos desde el vencimiento de la reserva en que una orden expirada se consulta por última vez. */
export const LATE_CHECK_AFTER_MINUTES = 60
/**
 * Ancho de esa ventana. Mayor que el intervalo del cron: con corridas que se atrasan unos segundos, una ventana de
 * exactamente 10 min dejaría huecos (órdenes que no caen en ninguna corrida). Así cada orden cae en una o dos
 * corridas; consultarla dos veces es inofensivo (confirmPaidOrder es idempotente).
 */
export const LATE_CHECK_WINDOW_MINUTES = CRON_INTERVAL_MINUTES + 5
/** No se inicia una conciliación (consulta a Flow + cumplimiento) pasado este tiempo de la corrida. */
export const RECONCILE_BUDGET_MS = 12000
/** Tope de cada consulta a Flow. */
export const FLOW_TIMEOUT_MS = 4000

const minutesAgoIso = (minutes) => new Date(Date.now() - minutes * 60 * 1000).toISOString()

/** La orden llegó a Flow: es de Flow (o sin proveedor, anterior a la columna) y se creó su pago (flowOrder). */
export const reachedFlow = (order) =>
  (order?.payment_provider || 'flow') === 'flow' && order?.payment_external_id != null && String(order.payment_external_id) !== ''

/** Fin de la reserva: hold_expires_at, o created_at + 15 min en órdenes antiguas (como aitickets_ticket_availability). */
function holdEndMs(order) {
  if (order.hold_expires_at) return Date.parse(order.hold_expires_at)
  return Date.parse(order.created_at || '') + LEGACY_HOLD_MINUTES * 60 * 1000
}

const canStartReconcile = (started, counters, limit, key) => counters[key] < limit && Date.now() - started < RECONCILE_BUDGET_MS

/**
 * Resultado de confirmPaidOrder que cumplió (o dejó en revisión) ESTA conciliación: el pago estaba en Flow y el
 * webhook no lo había procesado. No cuenta si el webhook llegó en paralelo (otra invocación tiene la orden, o
 * ya estaba pagada).
 */
const isRescue = (rec) => {
  const status = rec?.result?.status
  if (status === 'paid' || status === 'review') return true
  return status === 'retry' && !rec.result.inProgress && !rec.result.alreadyPaid
}

async function notifyRescue(order, rec, phase) {
  const p = rec.payment || {}
  const ref = p.externalId ? `ref ${p.externalId}, ` : ''
  const outcome =
    rec.result.status === 'paid'
      ? 'Se cumplió: entradas emitidas y correo enviado.'
      : rec.result.status === 'review'
        ? "Quedó en 'review' (ver el aviso anterior)."
        : 'Quedó pagada con sus entradas, pero el correo no salió: reenviarlo desde el panel (Reenviar entradas).'
  await notifySlack(
    `🛟 Pago recuperado por conciliación: la orden ${order.id} (evento ${order.event_id ?? '?'}) estaba pagada en Flow ` +
      `(${ref}${Number(p.amount) || 0} CLP) pero su confirmación (webhook) no llegó${phase === 'expired' ? ' y la orden ya había expirado' : ''}. ` +
      `${outcome} Revisar /api/payment-confirmation si se repite.`,
  )
}

/** Marca 'expired' si sigue 'pending' con la reserva vencida (filtro sin or(): con o sin hold_expires_at). */
async function expireOne(supabase, order, counters) {
  const now = new Date()
  let update = supabase.from('event_orders').update({ status: 'expired' }, { count: 'exact' }).eq('id', order.id).eq('status', 'pending')
  update = order.hold_expires_at
    ? update.lt('hold_expires_at', now.toISOString())
    : update.is('hold_expires_at', null).lt('created_at', new Date(now.getTime() - LEGACY_HOLD_MINUTES * 60 * 1000).toISOString())
  const { count, error } = await update
  if (error) {
    console.error(`expire-pending-orders: no se pudo expirar ${order.id}:`, error.message)
    return
  }
  if (count) counters.expired++
}

/** Pendientes con la reserva vencida: con hold_expires_at pasado y antiguas sin hold creadas hace > 15 min. */
async function loadDuePending(supabase) {
  const now = new Date().toISOString()
  const columns = 'id, event_id, created_at, hold_expires_at, payment_provider, payment_external_id'
  const withHold = await supabase
    .from('event_orders')
    .select(columns)
    .eq('status', 'pending')
    .lt('hold_expires_at', now)
    .order('hold_expires_at', { ascending: true })
    .limit(BATCH_LIMIT)
  if (withHold.error) return { error: withHold.error }
  const legacy = await supabase
    .from('event_orders')
    .select(columns)
    .eq('status', 'pending')
    .is('hold_expires_at', null)
    .lt('created_at', minutesAgoIso(LEGACY_HOLD_MINUTES))
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT)
  if (legacy.error) return { error: legacy.error }
  const orders = [...(withHold.data || []), ...(legacy.data || [])]
    .sort((a, b) => holdEndMs(a) - holdEndMs(b))
    .slice(0, BATCH_LIMIT)
  return { orders }
}

async function expirePending(supabase, started, counters, { canReconcile }) {
  const { orders, error } = await loadDuePending(supabase)
  if (error) {
    if (isMissingSchemaError(error)) {
      console.warn('expire-pending-orders: la base aún no tiene hold_expires_at / payment_provider; nada que hacer')
      return { skipped: 'schema' }
    }
    throw new Error(`error leyendo órdenes: ${error.message}`)
  }
  counters.scanned = orders.length

  for (const order of orders) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    if (!canReconcile || !reachedFlow(order)) {
      await expireOne(supabase, order, counters)
      continue
    }
    const pastGrace = Date.now() >= holdEndMs(order) + RECONCILE_GRACE_MINUTES * 60 * 1000
    if (!canStartReconcile(started, counters, RECONCILE_PENDING_LIMIT, 'reconciled')) {
      // Sin cupo/tiempo en esta corrida: se concilia en la próxima, salvo que ya pasó la gracia
      if (pastGrace) await expireOne(supabase, order, counters)
      else counters.deferred++
      continue
    }
    counters.reconciled++
    const rec = await reconcileOrder(supabase, order, { timeoutMs: FLOW_TIMEOUT_MS })
    if (rec.outcome === 'confirmed' || rec.outcome === 'retry') {
      // Pagada en Flow: confirmPaidOrder ya la reclamó (paid / review / correo pendiente) o el webhook la está
      // procesando en paralelo. En ningún caso se expira (y el UPDATE exige 'pending' de todos modos).
      if (isRescue(rec)) {
        counters.rescued++
        console.log(`expire-pending-orders: orden ${order.id} pagada en Flow sin webhook; cumplida por conciliación (${rec.result.status})`)
        await notifyRescue(order, rec, 'pending')
      }
      continue
    }
    if (rec.outcome === 'not_paid') {
      if (rec.status === FLOW_STATUS.REJECTED || rec.status === FLOW_STATUS.CANCELLED) {
        const status = rec.status === FLOW_STATUS.REJECTED ? 'rejected' : 'cancelled'
        if (await markOrderFailed(supabase, order.id, status)) counters.closed++
      } else {
        await expireOne(supabase, order, counters)
      }
      continue
    }
    // error / unverifiable: no se sabe si Flow cobró. Se reintenta en la próxima corrida hasta la gracia.
    console.warn(`expire-pending-orders: no se pudo conciliar la orden pendiente ${order.id} (${rec.outcome}${rec.message ? `: ${rec.message}` : ''})`)
    if (pastGrace) await expireOne(supabase, order, counters)
    else counters.deferred++
  }
  return {}
}

/**
 * Revisión tardía (una o dos veces por orden): expiradas de Flow cuya reserva venció hace
 * [LATE_CHECK_AFTER_MINUTES, +LATE_CHECK_WINDOW_MINUTES) min. Sin columna de "revisada", la ventana sobre
 * hold_expires_at (más ancha que el intervalo del cron) hace que cada orden caiga en una o dos corridas (si esas
 * corridas fallan o se quedan sin cupo, no se vuelve a mirar: el webhook tardío de Flow sigue siendo el camino principal).
 */
async function lateCheckExpired(supabase, started, counters) {
  const { data, error } = await supabase
    .from('event_orders')
    .select('id, event_id, created_at, hold_expires_at, payment_provider, payment_external_id')
    .eq('status', 'expired')
    .eq('payment_provider', 'flow')
    .not('payment_external_id', 'is', null)
    .gte('hold_expires_at', minutesAgoIso(LATE_CHECK_AFTER_MINUTES + LATE_CHECK_WINDOW_MINUTES))
    .lt('hold_expires_at', minutesAgoIso(LATE_CHECK_AFTER_MINUTES))
    .order('hold_expires_at', { ascending: true })
    .limit(RECONCILE_EXPIRED_LIMIT + 1)
  if (error) {
    if (!isMissingSchemaError(error)) console.error('expire-pending-orders: error leyendo órdenes expiradas:', error.message)
    return
  }
  const orders = data || []
  if (orders.length > RECONCILE_EXPIRED_LIMIT) {
    console.warn(`expire-pending-orders: más de ${RECONCILE_EXPIRED_LIMIT} órdenes expiradas en la ventana de revisión tardía; se revisan ${RECONCILE_EXPIRED_LIMIT}`)
  }
  for (const order of orders.slice(0, RECONCILE_EXPIRED_LIMIT)) {
    if (!canStartReconcile(started, counters, RECONCILE_EXPIRED_LIMIT, 'late_checked')) break
    counters.late_checked++
    const rec = await reconcileOrder(supabase, order, { timeoutMs: FLOW_TIMEOUT_MS })
    if ((rec.outcome === 'confirmed' || rec.outcome === 'retry') && isRescue(rec)) {
      counters.rescued++
      console.log(`expire-pending-orders: orden expirada ${order.id} pagada en Flow sin webhook; cumplida por conciliación (${rec.result.status})`)
      await notifyRescue(order, rec, 'expired')
    } else if (rec.outcome === 'error' || rec.outcome === 'unverifiable') {
      console.warn(`expire-pending-orders: revisión tardía de ${order.id} sin respuesta de Flow (${rec.outcome}${rec.message ? `: ${rec.message}` : ''})`)
    }
  }
}

/** 'processing' abandonadas: processing_started_at viejo o nulo (dos consultas: el filtro no usa or()). */
async function loadStuckProcessing(supabase, columns) {
  const stale = await supabase
    .from('event_orders')
    .select(columns)
    .eq('status', 'processing')
    .lt('processing_started_at', minutesAgoIso(PROCESSING_STALE_MINUTES))
    .order('processing_started_at', { ascending: true })
    .limit(SWEEP_LIMIT)
  if (stale.error) return { error: stale.error }
  const unset = await supabase
    .from('event_orders')
    .select(columns)
    .eq('status', 'processing')
    .is('processing_started_at', null)
    .limit(SWEEP_LIMIT)
  if (unset.error) return { error: unset.error }
  return { data: [...(unset.data || []), ...(stale.data || [])].slice(0, SWEEP_LIMIT) }
}

async function sweepProcessing(supabase, started, counters) {
  let { data: stuck, error } = await loadStuckProcessing(supabase, 'id, event_id, processing_started_at, payment_provider')
  if (error && isMissingSchemaError(error)) {
    // Base sin migrar (sin payment_provider)
    ;({ data: stuck, error } = await loadStuckProcessing(supabase, 'id, event_id, processing_started_at'))
  }
  if (error) {
    console.error('expire-pending-orders: error leyendo órdenes en processing:', error.message)
    return
  }

  const alertFrom = Date.now() - (STUCK_ALERT_AFTER_MINUTES + CRON_INTERVAL_MINUTES) * 60 * 1000
  const alertTo = Date.now() - STUCK_ALERT_AFTER_MINUTES * 60 * 1000
  for (const order of stuck || []) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    const rec = await reconcileOrder(supabase, order, { timeoutMs: FLOW_TIMEOUT_MS })
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
  const counters = { expired: 0, recovered: 0, scanned: 0, reconciled: 0, rescued: 0, closed: 0, deferred: 0, late_checked: 0 }
  // Sin credenciales de Flow (p. ej. entorno sin pagos) no hay a quién preguntar: se expira como siempre
  const canReconcile = isFlowConfigured()

  let skipped
  try {
    ;({ skipped } = await expirePending(supabase, started, counters, { canReconcile }))
  } catch (err) {
    console.error('expire-pending-orders:', err?.message)
    return json({ message: 'Error leyendo órdenes' }, 500)
  }

  try {
    await sweepProcessing(supabase, started, counters)
  } catch (err) {
    console.error('expire-pending-orders: error en el barrido de processing:', err?.message)
  }

  if (canReconcile && !skipped) {
    try {
      await lateCheckExpired(supabase, started, counters)
    } catch (err) {
      console.error('expire-pending-orders: error en la revisión tardía:', err?.message)
    }
  }

  const { expired, recovered, scanned, reconciled, rescued, closed, deferred, late_checked } = counters
  if (expired || recovered || rescued || closed || deferred) {
    console.log(
      `⏱️ expire-pending-orders: ${expired} expirada(s), ${closed} rechazada(s)/anulada(s) en Flow, ${rescued} pagada(s) rescatada(s) sin webhook, ` +
        `${deferred} pendiente(s) para la próxima corrida, ${recovered} 'processing' retomada(s); ${reconciled + late_checked} consulta(s) a Flow`,
    )
  }
  return json({ expired, recovered, scanned, reconciled, rescued, closed, deferred, late_checked, ...(skipped ? { skipped } : {}) }, 200)
}

export const config = {
  schedule: '*/10 * * * *',
}
