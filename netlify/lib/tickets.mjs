// Reglas de venta de entradas compartidas por purchase-tickets, orders.mjs (webhooks) y ai-assistant.
// Contrato C2: una entrada está a la venta si status='available' AND is_gift=false AND
// (init_date IS NULL OR init_date <= now) AND (end_date IS NULL OR end_date >= now).
import crypto from 'node:crypto'

// Cargo por servicio (8% + IVA del cargo): fuente única en fees.mjs.
export { SERVICE_FEE_RATE, IVA_RATE, computeServiceFee, computeBuyerTotal } from './fees.mjs'
export const DEFAULT_MAX_PER_PURCHASE = 10
/** Reserva por defecto de una orden pendiente (Flow). */
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

// ---------------------------------------------------------------------------------------------------------
// Tandas encadenadas (event_tickets.opens_after_ticket_id, migración 202610290100): una tanda espera a que la
// anterior deje de venderse. La anterior "sigue vendiéndose" si está disponible, no cerró su ventana y le queda cupo
// (vendidas + reservas vigentes < cupo); sin cupo definido nunca se agota. Si su venta aún no abre, también espera.
// ---------------------------------------------------------------------------------------------------------

export function isStillSelling(prev, remaining, now = new Date()) {
  if (!prev || prev.status !== 'available' || prev.is_gift === true) return false
  if (prev.end_date && new Date(prev.end_date) < now) return false
  if (prev.total_quantity === null || prev.total_quantity === undefined) return true
  return Number(remaining) > 0
}

/**
 * Tandas que esperan a la anterior.
 * @param tickets filas de event_tickets del evento (las anteriores incluidas; una que falte cuenta como cerrada)
 * @param chain Map<ticketId, anteriorId> (loadTicketChain)
 * @param remainingOf (ticket) => cupo que le queda (total - vendidas - reservas)
 * @returns {Map<number, object>} ticketId -> fila de la anterior
 */
export function waitingOnPrevious(tickets, chain, remainingOf, now = new Date()) {
  const waiting = new Map()
  if (!chain?.size) return waiting
  const byId = new Map((tickets || []).map((t) => [Number(t.id), t]))
  for (const [id, prevId] of chain) {
    const prev = byId.get(Number(prevId))
    if (prev && isStillSelling(prev, remainingOf(prev), now)) waiting.set(Number(id), prev)
  }
  return waiting
}

/**
 * Valida encadenar `ticketId` detrás de `prevId` (null = quitar). `tickets`: los del evento; `chain`: el encadenamiento
 * actual. Devuelve el motivo del rechazo o null.
 */
export function chainError(tickets, chain, ticketId, prevId) {
  if (prevId == null) return null
  const prev = (tickets || []).find((t) => Number(t.id) === Number(prevId))
  if (!prev) return 'La tanda anterior no es de este evento'
  if (Number(prevId) === Number(ticketId)) return 'Una tanda no puede esperar a sí misma'
  if (prev.is_gift === true) return 'No se puede encadenar a las cortesías'
  if ((prev.total_quantity === null || prev.total_quantity === undefined) && !prev.end_date) {
    return `"${prev.ticket_name}" no tiene cupo ni fecha de cierre: nunca se agotaría`
  }
  // Sin ciclos: subiendo desde la anterior no se puede volver a esta
  const seen = new Set()
  for (let id = Number(prevId); id && !seen.has(id); id = chain.get(id)) {
    if (id === Number(ticketId)) return 'Ese orden de tandas forma un círculo'
    seen.add(id)
  }
  return null
}

/** Map<ticketId, anteriorId> de un evento. Vacío si la columna aún no existe (deploy preview sin migrar). */
export async function loadTicketChain(supabase, eventId) {
  const { data, error } = await supabase
    .from('event_tickets')
    .select('id, opens_after_ticket_id')
    .eq('event_id', Number(eventId))
    .not('opens_after_ticket_id', 'is', null)
  if (error) {
    if (!['42703', 'PGRST204'].includes(String(error.code || ''))) console.warn('loadTicketChain:', error.message)
    return new Map()
  }
  return new Map((data || []).map((t) => [Number(t.id), Number(t.opens_after_ticket_id)]))
}

/** Lo mismo con todo cargado: tandas del evento que hoy esperan a la anterior (compra y asistente). */
export async function ticketsWaitingOnPrevious(supabase, eventId, now = new Date()) {
  const chain = await loadTicketChain(supabase, eventId)
  if (!chain.size) return new Map()
  const { data: tickets } = await supabase.from('event_tickets').select(TICKET_COLUMNS).eq('event_id', Number(eventId))
  const prevIds = [...new Set(chain.values())]
  const sold = await getSoldCounts(supabase, eventId, prevIds)
  const remainingOf = (t) => Number(t.total_quantity) - (sold.get(Number(t.id)) || 0)
  return waitingOnPrevious(tickets, chain, remainingOf, now)
}

export function maxPerPurchase(ticket) {
  const max = Number(ticket?.max_quantity)
  return Number.isInteger(max) && max > 0 ? max : DEFAULT_MAX_PER_PURCHASE
}

/**
 * Entradas vendidas/reservadas por event_ticket_id.
 * Fuente única: RPC aitickets_ticket_availability(event_id) -> [{ticket_id, sold, pending}]
 *   sold = event_attendees no cancelados; pending = órdenes 'processing' + 'pending' con reserva vigente
 *   (COALESCE(hold_expires_at, created_at + 15 min) > now()).
 * Si el RPC no existe o falla (p. ej. deploy preview contra una base sin migrar) se usan las consultas antiguas.
 * includePending=false cuenta solo entradas emitidas (lo usa el cumplimiento para detectar sobreventa real).
 * @returns {Promise<Map<number, number>>}
 */
export async function getSoldCounts(supabase, eventId, ticketIds, { includePending = true } = {}) {
  const sold = new Map(ticketIds.map(id => [Number(id), 0]))
  if (!ticketIds.length) return sold

  try {
    const { data, error } = await supabase.rpc('aitickets_ticket_availability', { p_event_id: Number(eventId) })
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('respuesta inesperada del RPC')
    for (const row of data) {
      const id = Number(row?.ticket_id)
      if (!sold.has(id)) continue
      sold.set(id, (Number(row.sold) || 0) + (includePending ? Number(row.pending) || 0 : 0))
    }
    return sold
  } catch (err) {
    console.warn('aitickets_ticket_availability no disponible; usando conteo antiguo:', err?.message || err?.code)
  }
  return getSoldCountsLegacy(supabase, eventId, ticketIds, { includePending })
}

/** Conteo anterior al RPC (fallback): consultas separadas por tipo de entrada. */
export async function getSoldCountsLegacy(supabase, eventId, ticketIds, { includePending = true } = {}) {
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
    .or(`status.eq.processing,and(status.eq.pending,created_at.gte.${since})`)
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
 * Filas de event_attendees: una por QR. Una entrada normal emite un QR por unidad; una mesa para N
 * (event_tickets.people_per_ticket, migración 202610300110) emite N, con el mismo unit_id y seat_number 1..N.
 * holders (event_orders.attendee_holders, migración 202610300100): [{ ticket_id, name, email }] en orden de emisión;
 * se asignan en orden a los QR de ese tipo de entrada. answers (preguntas por persona, migración 202610310100) pasan a
 * event_attendees.registration_answers. Las columnas nuevas solo van si hay algo que guardar, así una compra normal se
 * inserta igual en una base sin migrar.
 * @param {{eventId:number, attendeeId:number, orderId:string, lines:Array<{id:number, quantity:number}>, isComplimentary?:boolean,
 *          peopleOf?:(ticketId:number)=>number, holders?:Array<{ticket_id:number, name?:string|null, email?:string|null, answers?:any[]|null}>|null}} p
 */
export function buildAttendeeRows({ eventId, attendeeId, orderId, lines, isComplimentary = false, peopleOf = () => 1, holders = null }) {
  const rows = []
  // Asistentes por tipo de entrada, en orden
  const queue = new Map()
  for (const h of Array.isArray(holders) ? holders : []) {
    const id = Number(h?.ticket_id)
    if (!queue.has(id)) queue.set(id, [])
    queue.get(id).push(h)
  }
  for (const line of lines) {
    const qty = Number(line.quantity) || 0
    const people = Math.max(1, Math.min(30, Math.floor(Number(peopleOf(Number(line.id))) || 1)))
    for (let i = 0; i < qty; i++) {
      const unitId = people > 1 ? crypto.randomUUID() : null
      for (let seat = 1; seat <= people; seat++) {
        const holder = queue.get(Number(line.id))?.shift()
        rows.push({
          event_id: eventId,
          event_ticket_id: Number(line.id),
          attendee_id: attendeeId,
          qr_code: generateQrCode(),
          is_complimentary: isComplimentary,
          status: 'active',
          event_order_id: orderId,
          ...(unitId ? { unit_id: unitId, seat_number: seat } : {}),
          ...(holder?.name ? { holder_name: String(holder.name) } : {}),
          ...(holder?.email ? { holder_email: String(holder.email) } : {}),
          ...(Array.isArray(holder?.answers) && holder.answers.length ? { registration_answers: holder.answers } : {}),
        })
      }
    }
  }
  return rows
}

const MISSING_COLUMN = ['42703', 'PGRST204']
const NEW_ATTENDEE_COLUMNS = ['unit_id', 'seat_number', 'holder_name', 'holder_email', 'registration_answers']
const without = (rows, cols) => rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !cols.includes(k))))

/**
 * Personas por entrada de un evento (mesa para N): Map<ticketId, N> solo con las de más de 1.
 * Vacío si la columna aún no existe (deploy preview sin migrar).
 */
export async function loadPeoplePerTicket(supabase, eventId) {
  const { data, error } = await supabase
    .from('event_tickets')
    .select('id, people_per_ticket')
    .eq('event_id', Number(eventId))
    .gt('people_per_ticket', 1)
  if (error) {
    if (!MISSING_COLUMN.includes(String(error.code || ''))) console.warn('loadPeoplePerTicket:', error.message)
    return new Map()
  }
  return new Map((data || []).map((t) => [Number(t.id), Number(t.people_per_ticket) || 1]))
}

/** Asistentes guardados en la orden (null si no hay o la columna aún no existe). */
async function loadOrderHolders(supabase, order) {
  if (order.attendee_holders !== undefined) return Array.isArray(order.attendee_holders) ? order.attendee_holders : null
  const { data, error } = await supabase.from('event_orders').select('attendee_holders').eq('id', order.id).maybeSingle()
  if (error) return null
  return Array.isArray(data?.attendee_holders) ? data.attendee_holders : null
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

  const [people, holders] = await Promise.all([loadPeoplePerTicket(supabase, order.event_id), loadOrderHolders(supabase, order)])
  const rows = buildAttendeeRows({
    eventId: order.event_id,
    attendeeId: order.attendee_id,
    orderId: order.id,
    lines,
    peopleOf: (id) => people.get(id) || 1,
    holders,
  })
  let { error: insertError } = await supabase.from('event_attendees').insert(rows)
  if (insertError && MISSING_COLUMN.includes(String(insertError.code || '')) && rows.some(r => r.registration_answers)) {
    // Base sin respuestas por persona (202610310100): se emiten con el resto de los datos
    ;({ error: insertError } = await supabase.from('event_attendees').insert(without(rows, ['registration_answers'])))
  }
  if (insertError && MISSING_COLUMN.includes(String(insertError.code || ''))) {
    // Base sin las columnas de asistentes o mesas: se emiten igual, a nombre de quien compró
    ;({ error: insertError } = await supabase.from('event_attendees').insert(without(rows, NEW_ATTENDEE_COLUMNS)))
  }
  if (insertError) throw new Error(`Error insertando entradas: ${insertError.message}`)
  return { created: rows.length, existing: 0 }
}
