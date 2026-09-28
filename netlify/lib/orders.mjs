// Cumplimiento de órdenes, común a todos los proveedores de pago (Flow, Stripe).
// Lo usan el webhook de Flow (/api/payment-confirmation), el de Stripe (/api/webhooks/stripe) y la
// página de retorno /pago/retorno como red de seguridad.
//
// - Idempotente: una orden ya pagada no se reprocesa (solo se completan entradas/correo si faltaran).
// - Concurrencia: la orden se reclama de forma atómica (status 'processing') antes de emitir entradas;
//   un 'processing' con más de 5 minutos se considera abandonado y puede reclamarse.
// - Pagos tardíos: se pueden reclamar órdenes pending/failed/rejected/cancelled/expired, así un pago que
//   llega después de liberar la reserva se cumple o queda en 'review'. Un pago tardío compite contra las
//   reservas vigentes de otros compradores (no se las quita): si no alcanza, el tardío queda en 'review'.
// - Un 'processing' abandonado lo retoma el siguiente reintento del proveedor, el retorno del comprador o el
//   barrido de expire-pending-orders (payments/reconcile.mjs).
// - Sobreventa o monto/moneda que no coincide: 'review' + Slack, nunca se emite en silencio.
// - Reintentos: si el correo falla se devuelve httpStatus 503 para que el proveedor reintente.
// - Stripe en modo prueba (livemode=false, o sin dato y con clave sk_test_): solo se cumplen órdenes del
//   evento demo o de eventos marcados de prueba (STRIPE_TEST_EVENT_SLUGS). Cualquier otra queda en
//   'review' + Slack: un pago de prueba nunca emite entradas reales (los previews comparten la base).
import { ensureOrderAttendees, getSoldCounts } from './tickets.mjs'
import { sendOrderTicketsEmail } from './tickets-email.mjs'
import { notifySlack } from './slack.mjs'
import { SITE_URL } from './mailer.mjs'
import { isStripeTestKey, isStripeTestEligibleEvent } from './payments/mode.mjs'

const LEGACY_ORDER_COLUMNS = 'id, status, event_id, attendee_id, amount, ticket_fee, total_payment, ticket_details, payment_external_id, processing_started_at, created_at'
const ORDER_COLUMNS = `${LEGACY_ORDER_COLUMNS}, payment_provider, currency, provider_session_id, payment_intent_id, hold_expires_at`
export const PROCESSING_STALE_MINUTES = 5
/** Reserva por defecto de órdenes sin hold_expires_at (misma regla que aitickets_ticket_availability). */
export const LEGACY_HOLD_MINUTES = 15
export const CLAIMABLE_STATUSES = ['pending', 'failed', 'rejected', 'cancelled', 'expired']

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Error de PostgREST por columna/función inexistente (deploy preview contra una base sin migrar). */
export function isMissingSchemaError(error) {
  if (!error) return false
  const code = String(error.code || '')
  return code === '42703' || code === '42883' || code === 'PGRST202' || code === 'PGRST204' || code === '42P01' || code === 'PGRST205'
}

/** Carga una orden con las columnas nuevas; si la base aún no está migrada, con las antiguas. */
export async function loadOrder(supabase, orderId, columns = ORDER_COLUMNS) {
  let { data, error } = await supabase.from('event_orders').select(columns).eq('id', orderId).maybeSingle()
  if (error && isMissingSchemaError(error) && columns !== LEGACY_ORDER_COLUMNS) {
    ;({ data, error } = await supabase.from('event_orders').select(LEGACY_ORDER_COLUMNS).eq('id', orderId).maybeSingle())
  }
  if (error) throw new Error(`Error buscando orden: ${error.message}`)
  return data
}

/** Emite entradas (idempotente) y envía el correo. Devuelve false si el correo falló. */
export async function fulfillPaidOrder(supabase, order) {
  const { created } = await ensureOrderAttendees(supabase, order)
  if (created) console.log(`🎫 Orden ${order.id}: ${created} entrada(s) emitidas`)
  const emailResult = await sendOrderTicketsEmail(order.id)
  if (!emailResult.ok) {
    console.error(`Orden ${order.id}: correo no enviado (${emailResult.status}: ${emailResult.message || ''})`)
    return false
  }
  return true
}

/**
 * true si la orden sigue en 'pending' con su reserva de stock vigente
 * (COALESCE(hold_expires_at, created_at + 15 min) > now, igual que aitickets_ticket_availability).
 */
export function hasLiveHold(order, now = Date.now()) {
  if (!order || order.status !== 'pending') return false
  const holdEnd = order.hold_expires_at
    ? Date.parse(order.hold_expires_at)
    : order.created_at ? Date.parse(order.created_at) + LEGACY_HOLD_MINUTES * 60 * 1000 : NaN
  return Number.isFinite(holdEnd) && holdEnd > now
}

/**
 * Devuelve el texto de sobreventa si emitir esta orden supera el stock, o null.
 * - Las entradas ya emitidas de ESTA orden (un intento anterior que murió tras insertarlas) no se cuentan dos veces.
 * - includeHolds=false (la orden tenía su reserva vigente): solo cuentan las entradas emitidas; la reserva
 *   atómica ya le garantizó el cupo frente a las demás reservas.
 * - includeHolds=true (pago tardío o reclamo de un 'processing' abandonado): también cuentan las reservas
 *   vigentes y las órdenes 'processing' de otros compradores, así el pago tardío no le quita el cupo a quien
 *   reservó bien; si no alcanza, el tardío queda en 'review'. La propia orden (ya en 'processing') se descuenta.
 */
export async function findOversell(supabase, order, { includeHolds = false } = {}) {
  const lines = (Array.isArray(order.ticket_details) ? order.ticket_details : [])
    .map(l => ({ id: Number(l?.id), quantity: Number(l?.quantity) || 0 }))
    .filter(l => Number.isInteger(l.id) && l.quantity > 0)
  if (!lines.length) return null
  const { data: tickets, error } = await supabase
    .from('event_tickets')
    .select('id, ticket_name, total_quantity')
    .eq('event_id', order.event_id)
    .in('id', [...new Set(lines.map(l => l.id))])
  if (error) throw new Error(`Error cargando stock: ${error.message}`)
  const limited = (tickets || []).filter(t => t.total_quantity != null)
  if (!limited.length) return null
  const sold = await getSoldCounts(supabase, order.event_id, limited.map(t => Number(t.id)), { includePending: includeHolds })

  // Entradas propias ya emitidas (se filtra el estado en JS: NULL cuenta como vigente)
  const { data: own, error: ownError } = await supabase
    .from('event_attendees')
    .select('event_ticket_id, status')
    .eq('event_order_id', order.id)
  if (ownError) throw new Error(`Error contando entradas de la orden: ${ownError.message}`)
  const ownIssued = new Map()
  for (const a of own || []) {
    if (a?.status === 'cancelled') continue
    const id = Number(a?.event_ticket_id)
    ownIssued.set(id, (ownIssued.get(id) || 0) + 1)
  }

  const problems = []
  for (const t of limited) {
    const id = Number(t.id)
    const qty = lines.filter(l => l.id === id).reduce((sum, l) => sum + l.quantity, 0)
    // Con reservas: el conteo incluye esta misma orden como 'processing'; se descuenta
    const ownHeld = includeHolds && order.status === 'processing' ? qty : 0
    const used = Math.max(0, (sold.get(id) || 0) - (ownIssued.get(id) || 0) - ownHeld)
    if (used + qty > Number(t.total_quantity)) {
      problems.push(`${t.ticket_name}: ${used} ${includeHolds ? 'emitidas/reservadas' : 'emitidas'} + ${qty} > ${t.total_quantity}`)
    }
  }
  return problems.length ? problems.join('; ') : null
}

/** Slack "first_ticket_sold": primera orden pagada (monto > 0) del evento. Nunca lanza. */
export async function notifyFirstSaleIfNeeded(supabase, order, amount) {
  try {
    const { count } = await supabase
      .from('event_orders')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', order.event_id)
      .eq('status', 'paid')
      .gt('amount', 0)
    if (count !== 1) return
    const { data: event } = await supabase
      .from('events')
      .select('id, name, slug, organization_id, organizations ( public_name )')
      .eq('id', order.event_id)
      .maybeSingle()
    const orgName = event?.organizations?.public_name || `org ${event?.organization_id ?? '?'}`
    await notifySlack(`🎉 first_ticket_sold: primera venta de "${event?.name || order.event_id}" (${orgName}) por $${Number(amount).toLocaleString('es-CL')} CLP — ${SITE_URL}/eventos/${event?.slug || ''}`)
  } catch (err) {
    console.warn('No se pudo evaluar first_ticket_sold:', err?.message)
  }
}

const PROVIDER_LABEL = { flow: 'Flow', stripe: 'Stripe' }

/**
 * Confirma el pago de una orden y la cumple (entradas + correo). Común a Flow y Stripe.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} orderId  uuid de event_orders
 * @param {{provider:'flow'|'stripe', amount:number, currency?:string, externalId?:string|null,
 *          fee?:number|null, net?:number|null, method?:string|null, paymentIntentId?:string|null,
 *          livemode?:boolean|null}} payment
 *   externalId: flowOrder (Flow) o id de la Checkout Session (Stripe).
 *   livemode: solo Stripe (event.livemode / session.livemode); false = pago de prueba.
 * @returns {Promise<{status:'paid'|'already_paid'|'review'|'retry'|'not_found', httpStatus:number, message:string}>}
 */
export async function confirmPaidOrder(supabase, orderId, payment) {
  const { provider, amount, currency, externalId = null, fee = null, net = null, method = null, paymentIntentId = null, livemode = null } = payment || {}
  const label = PROVIDER_LABEL[provider] || provider
  if (!UUID_RE.test(String(orderId || ''))) return { status: 'not_found', httpStatus: 404, message: 'Orden no encontrada' }

  const order = await loadOrder(supabase, orderId)
  if (!order) return { status: 'not_found', httpStatus: 404, message: 'Orden no encontrada' }

  // Idempotencia: ya pagada -> solo asegurar entradas y correo (por si un intento anterior falló a medias)
  if (order.status === 'paid') {
    const emailed = await fulfillPaidOrder(supabase, order)
    if (!emailed) return { status: 'retry', httpStatus: 503, message: 'Orden pagada; correo pendiente' }
    return { status: 'already_paid', httpStatus: 200, message: 'Orden ya procesada' }
  }
  if (order.status === 'review') return { status: 'review', httpStatus: 200, message: 'Orden en revisión manual' }
  if (order.status === 'refunded') {
    await notifySlack(`⚠️ Llegó un pago de ${label} para la orden ${order.id}, que ya estaba reembolsada. Revisar manualmente.`)
    return { status: 'review', httpStatus: 200, message: 'Orden reembolsada' }
  }

  // Pago de prueba de Stripe: solo evento demo o marcados de prueba; si no, revisión (nunca entradas reales)
  const testPayment = provider === 'stripe' && (livemode === false || (livemode == null && isStripeTestKey()))
  if (testPayment) {
    const { data: ev, error: evError } = await supabase.from('events').select('slug').eq('id', order.event_id).maybeSingle()
    if (evError) throw new Error(`Error cargando evento de la orden: ${evError.message}`)
    if (!isStripeTestEligibleEvent(ev?.slug)) {
      console.error(`⚠️ Orden ${order.id}: pago de PRUEBA de Stripe (${externalId}) en un evento real (${ev?.slug || order.event_id}). No se emiten entradas.`)
      await supabase.from('event_orders')
        .update({ status: 'review', payment_external_id: externalId != null ? String(externalId) : order.payment_external_id })
        .eq('id', order.id).neq('status', 'paid')
      await notifySlack(`🚨 Orden ${order.id} en revisión: llegó un pago de PRUEBA de Stripe (livemode=false, ref ${externalId}) para el evento real "${ev?.slug || order.event_id}". No se emitieron entradas. Revisar la configuración de claves de Stripe (sk_test_ no debe usarse con eventos reales).`)
      return { status: 'review', httpStatus: 200, message: 'Pago de prueba registrado para revisión' }
    }
  }

  const expected = (Number(order.amount) || 0) + (Number(order.ticket_fee) || 0)
  const storedExternal = provider === 'stripe' ? (order.provider_session_id || order.payment_external_id) : order.payment_external_id
  const externalMatches = !storedExternal || externalId == null || String(storedExternal) === String(externalId)
  const providerMatches = !order.payment_provider || order.payment_provider === provider
  const currencyOk = !currency || String(currency).toUpperCase() === String(order.currency || 'CLP').toUpperCase()
  const paymentFields = {
    total_payment: Number(amount) || null,
    payment_external_id: externalId != null ? String(externalId) : order.payment_external_id,
  }
  if (Number(amount) !== expected || !currencyOk || !externalMatches || !providerMatches) {
    const detail = `${label} ${amount} ${currency || ''}, esperado ${expected} ${order.currency || 'CLP'}, ref ${externalId}, proveedor de la orden ${order.payment_provider || '?'}`
    console.error(`⚠️ Orden ${order.id}: el pago no coincide (${detail}). Requiere revisión manual.`)
    await supabase.from('event_orders').update({ status: 'review', ...paymentFields }).eq('id', order.id).neq('status', 'paid')
    await notifySlack(`⚠️ Orden ${order.id} en revisión: el pago no coincide (${detail}).`)
    return { status: 'review', httpStatus: 200, message: 'Pago registrado para revisión' }
  }

  // Reclamo atómico: solo una invocación emite las entradas de esta orden
  const claimStartedAt = Date.now()
  const nowIso = new Date(claimStartedAt).toISOString()
  const staleBefore = new Date(Date.now() - PROCESSING_STALE_MINUTES * 60 * 1000).toISOString()
  // PostgREST 12.2 falla (42703) si un UPDATE con filtro or()/and() pide la fila de vuelta
  // (return=representation): se usa count exacto y, si hace falta, una lectura aparte.
  const { count: claimedCount, error: claimError } = await supabase
    .from('event_orders')
    .update({ status: 'processing', processing_started_at: nowIso }, { count: 'exact' })
    .eq('id', order.id)
    .or(`status.in.(${CLAIMABLE_STATUSES.join(',')}),and(status.eq.processing,processing_started_at.lt.${staleBefore}),and(status.eq.processing,processing_started_at.is.null)`)
  if (claimError) throw new Error(`Error reclamando orden: ${claimError.message}`)
  let claimed = []
  if (claimedCount) {
    const { data: claimedRows, error: claimedReadError } = await supabase
      .from('event_orders')
      .select(LEGACY_ORDER_COLUMNS)
      .eq('id', order.id)
      .eq('processing_started_at', nowIso)
    if (claimedReadError) throw new Error(`Error leyendo orden reclamada: ${claimedReadError.message}`)
    claimed = claimedRows || []
  }
  if (!claimed?.length) {
    // Otra invocación la está procesando (o ya terminó): el proveedor reintentará y caerá en el camino idempotente
    console.log(`Orden ${order.id}: ya está siendo procesada por otra invocación`)
    return { status: 'retry', httpStatus: 503, message: 'Orden en proceso' }
  }
  const claimedOrder = claimed[0]

  // Sobreventa (pagos tardíos / carreras): no emitir en silencio. Si la orden ya no tenía su reserva
  // vigente (pago tardío, o un 'processing' abandonado) también cuentan las reservas de otros compradores.
  const oversell = await findOversell(supabase, claimedOrder, { includeHolds: !hasLiveHold(order, claimStartedAt) })
  if (oversell) {
    console.error(`⚠️ Orden ${order.id}: pagada pero sin stock (${oversell}). Requiere revisión manual.`)
    await supabase.from('event_orders').update({ status: 'review', ...paymentFields }).eq('id', order.id).eq('status', 'processing')
    await notifySlack(`🚨 Sobreventa: la orden ${order.id} (evento ${order.event_id}) fue pagada en ${label} (${amount} CLP, ref ${externalId}) pero no hay stock: ${oversell}. Quedó en 'review': reembolsar o ampliar cupo y emitir manualmente.`)
    return { status: 'review', httpStatus: 200, message: 'Pago registrado para revisión (sin stock)' }
  }

  const updateData = {
    status: 'paid',
    total_payment: Number(amount),
    payment_fee: fee != null ? Math.round(Number(fee)) || 0 : null,
    balance: net != null ? Math.round(Number(net)) : null,
    payment_commerce_id: method || null,
    payment_external_id: paymentFields.payment_external_id,
  }
  // Columnas nuevas solo cuando hay dato (Flow sigue funcionando contra una base sin migrar)
  if (paymentIntentId) updateData.payment_intent_id = String(paymentIntentId)

  // Emitir entradas antes de marcar pagada; ensureOrderAttendees es idempotente por event_order_id
  try {
    await ensureOrderAttendees(supabase, claimedOrder)
  } catch (err) {
    // Liberar el reclamo para que el reintento del proveedor vuelva a intentarlo
    await supabase.from('event_orders').update({ status: 'pending', processing_started_at: null }).eq('id', order.id).eq('status', 'processing')
    throw err
  }

  const { error: updateError } = await supabase
    .from('event_orders')
    .update(updateData)
    .eq('id', order.id)
    .eq('status', 'processing')
  if (updateError) throw new Error(`Error actualizando orden: ${updateError.message}`)

  console.log(`✅ Orden ${order.id} pagada (${label} ${externalId}, ${amount} CLP)`)
  await notifyFirstSaleIfNeeded(supabase, order, amount)
  const emailed = await fulfillPaidOrder(supabase, { ...claimedOrder, status: 'paid' })
  if (!emailed) return { status: 'retry', httpStatus: 503, message: 'Pago confirmado; correo pendiente' }
  return { status: 'paid', httpStatus: 200, message: 'Pago confirmado y entradas registradas' }
}

/**
 * Marca una orden no pagada como fallida/rechazada/cancelada/expirada.
 * Solo transiciona desde los estados de `from` (por defecto 'pending'). Devuelve true si cambió.
 */
export async function markOrderFailed(supabase, orderId, status, { from = ['pending'] } = {}) {
  if (!UUID_RE.test(String(orderId || ''))) return false
  const { data, error } = await supabase
    .from('event_orders')
    .update({ status })
    .eq('id', orderId)
    .in('status', from)
    .select('id')
  if (error) {
    console.error(`No se pudo marcar la orden ${orderId} como ${status}:`, error.message)
    return false
  }
  return Boolean(data?.length)
}

/**
 * Reembolso total: orden 'refunded' + entradas anuladas (checkin rechaza status distinto de active).
 * @returns {Promise<{changed:boolean, voided:number}>}
 */
export async function markOrderRefunded(supabase, orderId, { refundedAt = new Date().toISOString() } = {}) {
  if (!UUID_RE.test(String(orderId || ''))) return { changed: false, voided: 0 }
  let { data, error } = await supabase
    .from('event_orders')
    .update({ status: 'refunded', refunded_at: refundedAt })
    .eq('id', orderId)
    .neq('status', 'refunded')
    .select('id')
  if (error && isMissingSchemaError(error)) {
    ;({ data, error } = await supabase.from('event_orders').update({ status: 'refunded' }).eq('id', orderId).neq('status', 'refunded').select('id'))
  }
  if (error) throw new Error(`Error marcando reembolso: ${error.message}`)
  // PostgREST 12.2 falla (42703) si un UPDATE con filtro or()/and() pide la fila de vuelta
  // (return=representation): se usa count exacto y, si hace falta, una lectura aparte.
  const { count: voided, error: voidError } = await supabase
    .from('event_attendees')
    .update({ status: 'cancelled' }, { count: 'exact' })
    .eq('event_order_id', orderId)
    .or('status.is.null,status.neq.cancelled')
  if (voidError) throw new Error(`Error anulando entradas: ${voidError.message}`)
  return { changed: Boolean(data?.length), voided: voided || 0 }
}

/**
 * Registra un evento de webhook (idempotencia). Devuelve false si ya se había registrado (duplicado).
 * Si la tabla aún no existe (base sin migrar) devuelve true: el cumplimiento igual es idempotente.
 */
export async function recordPaymentEvent(supabase, { id, provider, type, orderId = null, payload = null }) {
  const { error } = await supabase
    .from('aitickets_payment_events')
    .insert([{ id: String(id), provider, type, order_id: UUID_RE.test(String(orderId || '')) ? orderId : null, payload }])
  if (!error) return true
  if (error.code === '23505') return false
  console.error(`No se pudo registrar el evento de pago ${id}:`, error.message)
  return true
}

/** Olvida un evento registrado para que el reintento del proveedor vuelva a procesarlo. Nunca lanza. */
export async function forgetPaymentEvent(supabase, id) {
  try {
    await supabase.from('aitickets_payment_events').delete().eq('id', String(id))
  } catch (err) {
    console.error(`No se pudo borrar el evento de pago ${id}:`, err?.message)
  }
}
