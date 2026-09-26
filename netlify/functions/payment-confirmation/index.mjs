// POST /api/payment-confirmation — webhook (urlConfirmation) de Flow.
// Reemplaza la AWS Lambda functions/paymentConfirmation.mjs (nodejs18, EOL).
// Flow envía `token` (x-www-form-urlencoded); consultamos payment/getStatus firmado y actuamos según el estado.
// Idempotente: una orden ya pagada no se reprocesa (solo se completan entradas/correo si faltaran).
// Concurrencia: la orden se reclama de forma atómica (status 'processing') antes de emitir entradas.
// Sobreventa: antes de emitir se re-cuenta el stock emitido; si no alcanza, la orden queda en 'review' + Slack.
// Reintentos: si el correo de entradas falla se responde 5xx para que Flow reintente (el camino es idempotente).
import { getSupabaseAdmin, json } from '../../lib/supabase.mjs'
import { getFlowPaymentStatus, FLOW_STATUS } from '../../lib/flow.mjs'
import { ensureOrderAttendees, getSoldCounts } from '../../lib/tickets.mjs'
import { sendOrderTicketsEmail } from '../../lib/tickets-email.mjs'
import { notifySlack } from '../../lib/slack.mjs'
import { SITE_URL } from '../../lib/mailer.mjs'

const ORDER_COLUMNS = 'id, status, event_id, attendee_id, amount, ticket_fee, total_payment, ticket_details, payment_external_id, processing_started_at'
// Una orden en 'processing' por más de esto se considera abandonada (la función murió) y puede reclamarse.
const PROCESSING_STALE_MINUTES = 5
const CLAIMABLE_STATUSES = ['pending', 'failed', 'rejected', 'cancelled']

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function readToken(req) {
  const url = new URL(req.url)
  const fromQuery = url.searchParams.get('token')
  if (fromQuery) return fromQuery
  const raw = await req.text()
  if (!raw) return null
  const contentType = req.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try { return JSON.parse(raw)?.token || null } catch { return null }
  }
  return new URLSearchParams(raw).get('token')
}

/** Emite entradas (idempotente) y envía el correo. Devuelve false si el correo falló. */
async function fulfillPaidOrder(supabase, order) {
  const { created } = await ensureOrderAttendees(supabase, order)
  if (created) console.log(`🎫 Orden ${order.id}: ${created} entrada(s) emitidas`)
  const emailResult = await sendOrderTicketsEmail(order.id)
  if (!emailResult.ok) {
    console.error(`Orden ${order.id}: correo no enviado (${emailResult.status}: ${emailResult.message || ''})`)
    return false
  }
  return true
}

/** Devuelve el texto de sobreventa si emitir esta orden supera el stock (solo cuenta entradas ya emitidas). */
async function findOversell(supabase, order) {
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
  const sold = await getSoldCounts(supabase, order.event_id, limited.map(t => Number(t.id)), { includePending: false })
  const problems = []
  for (const t of limited) {
    const qty = lines.filter(l => l.id === Number(t.id)).reduce((sum, l) => sum + l.quantity, 0)
    const issued = sold.get(Number(t.id)) || 0
    if (issued + qty > Number(t.total_quantity)) problems.push(`${t.ticket_name}: ${issued} emitidas + ${qty} > ${t.total_quantity}`)
  }
  return problems.length ? problems.join('; ') : null
}

/** Slack "first_ticket_sold": primera orden pagada (monto > 0) del evento. Nunca lanza. */
async function notifyFirstSaleIfNeeded(supabase, order, amount) {
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

export default async function handler(req) {
  if (req.method !== 'POST') return json({ message: 'Método no permitido' }, 405)

  let token
  try {
    token = await readToken(req)
  } catch {
    token = null
  }
  if (!token || typeof token !== 'string' || token.length > 200) {
    return json({ message: 'Token no recibido' }, 400)
  }

  let payment
  try {
    payment = await getFlowPaymentStatus(token)
  } catch (err) {
    console.error('Error consultando Flow getStatus:', err.message)
    // 5xx para que Flow reintente la notificación
    return json({ message: 'Error al consultar Flow' }, 502)
  }

  const { commerceOrder, status, amount, currency, flowOrder } = payment
  const paymentData = payment.paymentData || {}
  const supabase = getSupabaseAdmin()

  if (!UUID_RE.test(String(commerceOrder || ''))) {
    console.error(`Flow notificó un commerceOrder inválido (${commerceOrder}, flowOrder=${flowOrder})`)
    return json({ message: 'Orden no encontrada' }, 404)
  }

  try {
    const { data: order, error: orderError } = await supabase
      .from('event_orders')
      .select(ORDER_COLUMNS)
      .eq('id', commerceOrder)
      .maybeSingle()
    if (orderError) throw new Error(`Error buscando orden: ${orderError.message}`)
    if (!order) {
      console.error(`Flow notificó una orden inexistente (commerceOrder=${commerceOrder}, flowOrder=${flowOrder})`)
      return json({ message: 'Orden no encontrada' }, 404)
    }

    // Idempotencia: ya pagada -> solo asegurar entradas y correo (por si un intento anterior falló a medias)
    if (order.status === 'paid') {
      const emailed = await fulfillPaidOrder(supabase, order)
      if (!emailed) return json({ message: 'Orden pagada; correo pendiente' }, 503)
      return json({ message: 'Orden ya procesada' }, 200)
    }
    if (order.status === 'review') {
      return json({ message: 'Orden en revisión manual' }, 200)
    }

    if (status === FLOW_STATUS.PAID) {
      const expected = (Number(order.amount) || 0) + (Number(order.ticket_fee) || 0)
      const flowOrderMatches = !order.payment_external_id || flowOrder == null || String(order.payment_external_id) === String(flowOrder)
      const paymentFields = {
        total_payment: Number(amount) || null,
        payment_external_id: flowOrder != null ? String(flowOrder) : order.payment_external_id,
      }
      if (String(commerceOrder) !== String(order.id) || Number(amount) !== expected || (currency && currency !== 'CLP') || !flowOrderMatches) {
        console.error(`⚠️ Orden ${order.id}: pago de Flow no coincide (monto Flow ${amount} ${currency || ''}, esperado ${expected}, flowOrder ${flowOrder}). Requiere revisión manual.`)
        await supabase
          .from('event_orders')
          .update({ status: 'review', ...paymentFields })
          .eq('id', order.id)
          .neq('status', 'paid')
        await notifySlack(`⚠️ Orden ${order.id} en revisión: el pago de Flow no coincide (Flow ${amount} ${currency || ''}, esperado ${expected}, flowOrder ${flowOrder}).`)
        return json({ message: 'Pago registrado para revisión' }, 200)
      }

      // Reclamo atómico: solo una invocación emite las entradas de esta orden
      const nowIso = new Date().toISOString()
      const staleBefore = new Date(Date.now() - PROCESSING_STALE_MINUTES * 60 * 1000).toISOString()
      const { data: claimed, error: claimError } = await supabase
        .from('event_orders')
        .update({ status: 'processing', processing_started_at: nowIso })
        .eq('id', order.id)
        .or(`status.in.(${CLAIMABLE_STATUSES.join(',')}),and(status.eq.processing,processing_started_at.lt.${staleBefore}),and(status.eq.processing,processing_started_at.is.null)`)
        .select(ORDER_COLUMNS)
      if (claimError) throw new Error(`Error reclamando orden: ${claimError.message}`)
      if (!claimed?.length) {
        // Otra invocación la está procesando (o ya terminó): Flow reintentará y caerá en el camino idempotente
        console.log(`Orden ${order.id}: ya está siendo procesada por otra invocación`)
        return json({ message: 'Orden en proceso' }, 503)
      }
      const claimedOrder = claimed[0]

      // Sobreventa (pagos tardíos / carreras): no emitir en silencio
      const oversell = await findOversell(supabase, claimedOrder)
      if (oversell) {
        console.error(`⚠️ Orden ${order.id}: pagada pero sin stock (${oversell}). Requiere revisión manual.`)
        await supabase.from('event_orders').update({ status: 'review', ...paymentFields }).eq('id', order.id).eq('status', 'processing')
        await notifySlack(`🚨 Sobreventa: la orden ${order.id} (evento ${order.event_id}) fue pagada en Flow (${amount} CLP, flowOrder ${flowOrder}) pero no hay stock: ${oversell}. Quedó en 'review': reembolsar o ampliar cupo y emitir manualmente.`)
        return json({ message: 'Pago registrado para revisión (sin stock)' }, 200)
      }

      const fee = (Number.parseInt(paymentData.fee, 10) || 0) + (Number.parseInt(paymentData.taxes, 10) || 0)
      const updateData = {
        status: 'paid',
        total_payment: Number(amount),
        payment_fee: fee,
        balance: paymentData.balance != null ? Math.round(Number(paymentData.balance)) : null,
        payment_commerce_id: paymentData.media || null,
        payment_external_id: paymentFields.payment_external_id,
      }

      // Emitir entradas antes de marcar pagada; ensureOrderAttendees es idempotente por event_order_id
      try {
        await ensureOrderAttendees(supabase, claimedOrder)
      } catch (err) {
        // Liberar el reclamo para que el reintento de Flow vuelva a intentarlo
        await supabase.from('event_orders').update({ status: 'pending', processing_started_at: null }).eq('id', order.id).eq('status', 'processing')
        throw err
      }

      const { error: updateError } = await supabase
        .from('event_orders')
        .update(updateData)
        .eq('id', order.id)
        .eq('status', 'processing')
      if (updateError) throw new Error(`Error actualizando orden: ${updateError.message}`)

      console.log(`✅ Orden ${order.id} pagada (Flow ${flowOrder}, ${amount} CLP)`)
      await notifyFirstSaleIfNeeded(supabase, order, amount)
      const emailed = await fulfillPaidOrder(supabase, { ...claimedOrder, status: 'paid' })
      if (!emailed) return json({ message: 'Pago confirmado; correo pendiente' }, 503)
      return json({ message: 'Pago confirmado y entradas registradas' }, 200)
    }

    if (status === FLOW_STATUS.REJECTED || status === FLOW_STATUS.CANCELLED) {
      const newStatus = status === FLOW_STATUS.REJECTED ? 'rejected' : 'cancelled'
      await supabase.from('event_orders').update({ status: newStatus }).eq('id', order.id).eq('status', 'pending')
      console.log(`Orden ${order.id}: pago ${newStatus}`)
      return json({ message: `Pago ${newStatus}` }, 200)
    }

    return json({ message: 'Pago pendiente', status }, 200)
  } catch (error) {
    console.error(`Error procesando confirmación de pago (commerceOrder=${commerceOrder}):`, error?.message)
    return json({ message: 'Error interno' }, 500)
  }
}

export const config = {
  path: ['/api/payment-confirmation'],
}
