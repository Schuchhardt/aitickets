// Reglas de venta de entradas compartidas por purchase-tickets, payment-confirmation y ai-assistant.
// Contrato C2: una entrada está a la venta si status='available' AND is_gift=false AND
// (init_date IS NULL OR init_date <= now) AND (end_date IS NULL OR end_date >= now).
import crypto from 'node:crypto'

export const SERVICE_FEE_RATE = 0.10
export const DEFAULT_MAX_PER_PURCHASE = 10
export const PENDING_HOLD_MINUTES = 15

export const TICKET_COLUMNS = 'id, event_id, event_date_id, ticket_name, price, max_quantity, is_gift, status, init_date, end_date, total_quantity'

export function isTicketOnSale(ticket, now = new Date()) {
  if (!ticket) return false
  if (ticket.status !== 'available') return false
  if (ticket.is_gift === true) return false
  if (ticket.init_date && new Date(ticket.init_date) > now) return false
  if (ticket.end_date && new Date(ticket.end_date) < now) return false
  return true
}

export function maxPerPurchase(ticket) {
  const max = Number(ticket?.max_quantity)
  return Number.isInteger(max) && max > 0 ? max : DEFAULT_MAX_PER_PURCHASE
}

/** Cargo por servicio al comprador (10% del subtotal, entero CLP). */
export function computeServiceFee(subtotal) {
  return subtotal > 0 ? Math.round(subtotal * SERVICE_FEE_RATE) : 0
}

/**
 * Entradas vendidas/reservadas por event_ticket_id:
 * event_attendees no cancelados + cantidades de órdenes 'pending'/'processing' de los últimos 15 minutos.
 * includePending=false cuenta solo entradas emitidas (lo usa el webhook para detectar sobreventa real).
 * @returns {Promise<Map<number, number>>}
 */
export async function getSoldCounts(supabase, eventId, ticketIds, { includePending = true } = {}) {
  const sold = new Map(ticketIds.map(id => [Number(id), 0]))
  if (!ticketIds.length) return sold

  await Promise.all(ticketIds.map(async (ticketId) => {
    const { count, error } = await supabase
      .from('event_attendees')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('event_ticket_id', ticketId)
      .or('status.is.null,status.neq.cancelled')
    if (error) throw new Error(`Error contando entradas: ${error.message}`)
    sold.set(Number(ticketId), (sold.get(Number(ticketId)) || 0) + (count || 0))
  }))

  if (!includePending) return sold

  const since = new Date(Date.now() - PENDING_HOLD_MINUTES * 60 * 1000).toISOString()
  const { data: pendingOrders, error: pendingError } = await supabase
    .from('event_orders')
    .select('ticket_details')
    .eq('event_id', eventId)
    .in('status', ['pending', 'processing'])
    .gte('created_at', since)
  if (pendingError) throw new Error(`Error leyendo órdenes pendientes: ${pendingError.message}`)

  for (const order of pendingOrders || []) {
    for (const line of Array.isArray(order.ticket_details) ? order.ticket_details : []) {
      const id = Number(line?.id)
      if (sold.has(id)) sold.set(id, sold.get(id) + (Number(line.quantity) || 0))
    }
  }
  return sold
}

/** Código QR único y no adivinable. */
export function generateQrCode() {
  return crypto.createHash('sha256').update(`${crypto.randomUUID()}-${crypto.randomBytes(16).toString('hex')}`).digest('hex')
}

/**
 * Filas de event_attendees: una por unidad comprada.
 * @param {{eventId:number, attendeeId:number, orderId:string, lines:Array<{id:number, quantity:number}>, isComplimentary?:boolean}} p
 */
export function buildAttendeeRows({ eventId, attendeeId, orderId, lines, isComplimentary = false }) {
  const rows = []
  for (const line of lines) {
    const qty = Number(line.quantity) || 0
    for (let i = 0; i < qty; i++) {
      rows.push({
        event_id: eventId,
        event_ticket_id: Number(line.id),
        attendee_id: attendeeId,
        qr_code: generateQrCode(),
        is_complimentary: isComplimentary,
        status: 'active',
        event_order_id: orderId,
      })
    }
  }
  return rows
}

/**
 * Crea las entradas de una orden si todavía no existen (idempotente por event_order_id).
 * Valida que cada id de ticket_details pertenezca al evento de la orden.
 * @returns {Promise<{created:number, existing:number}>}
 */
export async function ensureOrderAttendees(supabase, order) {
  const { count: existing, error: countError } = await supabase
    .from('event_attendees')
    .select('id', { count: 'exact', head: true })
    .eq('event_order_id', order.id)
  if (countError) throw new Error(`Error contando entradas de la orden: ${countError.message}`)
  if (existing && existing > 0) return { created: 0, existing }

  const lines = (Array.isArray(order.ticket_details) ? order.ticket_details : [])
    .map(l => ({ id: Number(l?.id), quantity: Number(l?.quantity) }))
    .filter(l => Number.isInteger(l.id) && Number.isInteger(l.quantity) && l.quantity > 0)
  if (!lines.length) throw new Error('La orden no tiene detalle de entradas válido')

  const ids = [...new Set(lines.map(l => l.id))]
  const { data: validTickets, error: ticketsError } = await supabase
    .from('event_tickets')
    .select('id')
    .eq('event_id', order.event_id)
    .in('id', ids)
  if (ticketsError) throw new Error(`Error validando tipos de entrada: ${ticketsError.message}`)
  if ((validTickets || []).length !== ids.length) {
    throw new Error('La orden contiene tipos de entrada que no pertenecen al evento')
  }

  const rows = buildAttendeeRows({ eventId: order.event_id, attendeeId: order.attendee_id, orderId: order.id, lines })
  const { error: insertError } = await supabase.from('event_attendees').insert(rows)
  if (insertError) throw new Error(`Error insertando entradas: ${insertError.message}`)
  return { created: rows.length, existing: 0 }
}
