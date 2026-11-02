// Entradas numeradas en el servidor (migración 202611020100, formato del mapa en src/lib/seatMap.mjs).
//
// Flujo de una compra con asientos:
//   1. /api/purchase-ticket valida los asientos elegidos contra el mapa de la función (validateSeatSelection) y los
//      guarda en event_orders.seat_selection.
//   2. Después de reservar la orden, holdOrderSeats los toma en aitickets_event_seats hasta que vence la orden. Si
//      alguien los tomó primero, la orden se cancela y el comprador vuelve a elegir.
//   3. Al confirmar el pago (netlify/lib/orders.mjs) se vuelven a tomar (pago tardío) y ensureOrderAttendees
//      (netlify/lib/tickets.mjs) asigna un asiento a cada QR y los marca vendidos (markSeatsSold).
// Una base sin la migración (deploy preview) se comporta como si ningún evento tuviera asientos.

import { normalizeSeatMap, seatLabel, assignSeatsToLines, MAX_SEATS_PER_ORDER } from '../../src/lib/seatMap.mjs'

const MISSING = ['42703', 'PGRST204', '42P01', 'PGRST202', '42883', 'PGRST205']
const isMissing = (error) => MISSING.includes(String(error?.code || ''))

/**
 * Mapas de asientos del evento por función: { seated, mapsByDate: Map<dateId, map>, dates: Map<dateId, row> }.
 * seated = alguna ubicación del evento tiene mapa.
 */
export async function loadEventSeating(supabase, eventId) {
  const empty = { seated: false, mapsByDate: new Map(), dates: new Map() }
  const { data: locations, error } = await supabase.from('event_locations').select('id, seat_map').eq('event_id', Number(eventId))
  if (error) {
    if (!isMissing(error)) console.warn('loadEventSeating:', error.message)
    return empty
  }
  const mapsByLocation = new Map()
  for (const l of locations || []) {
    const map = normalizeSeatMap(l.seat_map)
    if (map) mapsByLocation.set(String(l.id), map)
  }
  if (!mapsByLocation.size) return empty
  const { data: dates, error: datesError } = await supabase
    .from('event_dates')
    .select('id, date, start_time, end_time, event_location_id')
    .eq('event_id', Number(eventId))
  if (datesError) throw new Error(`Error cargando funciones: ${datesError.message}`)
  const mapsByDate = new Map()
  const dateRows = new Map()
  for (const d of dates || []) {
    dateRows.set(Number(d.id), d)
    const map = mapsByLocation.get(String(d.event_location_id))
    if (map) mapsByDate.set(Number(d.id), map)
  }
  return { seated: true, mapsByDate, dates: dateRows }
}

/** Secciones permitidas por tipo de entrada: Map<ticketId, string[]|null>. Vacío si la columna no existe. */
export async function loadTicketSections(supabase, eventId) {
  const { data, error } = await supabase.from('event_tickets').select('id, seat_sections').eq('event_id', Number(eventId))
  if (error) {
    if (!isMissing(error)) console.warn('loadTicketSections:', error.message)
    return new Map()
  }
  return new Map((data || []).map((t) => [Number(t.id), Array.isArray(t.seat_sections) && t.seat_sections.length ? t.seat_sections : null]))
}

/**
 * Valida los asientos de una compra.
 * raw: body.seats = { eventDateId, keys: string[] }.
 * lines: ticket_details [{ id, quantity, event_date_id, people? }].
 * Devuelve { selection: { event_date_id, seats: [{ key, label, ticket_id }] } } o { error }.
 */
export function validateSeatSelection({ seating, lines, sectionsOf, raw, isFunctionOpen = () => true }) {
  const dateId = Number(raw?.eventDateId)
  const keys = Array.isArray(raw?.keys) ? [...new Set(raw.keys.map(String))] : []
  if (!Number.isInteger(dateId) || !seating.mapsByDate.has(dateId)) return { error: 'Elige la función y tus asientos.' }
  const fn = seating.dates.get(dateId)
  if (!fn || !isFunctionOpen(fn)) return { error: 'Esa función ya no está disponible.' }
  for (const l of lines) {
    if (l.event_date_id != null && Number(l.event_date_id) !== dateId) return { error: 'Una de las entradas es de otra función.' }
    if (Number(l.people || 1) > 1) return { error: 'Las mesas para varias personas no se venden con asiento numerado.' }
  }
  const count = lines.reduce((s, l) => s + Number(l.quantity || 0), 0)
  if (count > MAX_SEATS_PER_ORDER) return { error: `Puedes elegir como máximo ${MAX_SEATS_PER_ORDER} asientos por compra.` }
  if (keys.length !== count) return { error: `Elige ${count} ${count === 1 ? 'asiento' : 'asientos'}.` }
  const map = seating.mapsByDate.get(dateId)
  const assigned = assignSeatsToLines(
    map,
    lines.map((l) => ({ id: l.id, quantity: l.quantity, seat_sections: sectionsOf(Number(l.id)) })),
    keys,
  )
  if (assigned.error) return { error: assigned.error }
  return {
    selection: {
      event_date_id: dateId,
      seats: assigned.map((a) => ({ key: a.key, label: seatLabel(map, a.key), ticket_id: a.ticketId })),
    },
  }
}

/**
 * Toma los asientos de la orden hasta `expiresAt`. Devuelve { ok: true } o { ok: false, taken: [labels] }.
 * Sin la función SQL (base sin migrar) no puede garantizar el asiento: falla.
 */
export async function holdOrderSeats(supabase, orderId, selection, expiresAt) {
  const keys = selection.seats.map((s) => s.key)
  const { data, error } = await supabase.rpc('aitickets_hold_seats', {
    p_order_id: orderId,
    p_event_date_id: selection.event_date_id,
    p_keys: keys,
    p_expires_at: expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt,
  })
  if (error) throw new Error(`Error reservando asientos: ${error.message}`)
  const taken = Array.isArray(data) ? data : []
  if (!taken.length) return { ok: true }
  const labelOf = new Map(selection.seats.map((s) => [s.key, s.label]))
  return { ok: false, taken: taken.map((k) => labelOf.get(k) || k) }
}

/** Asientos de la orden (event_orders.seat_selection) o null. */
export async function loadOrderSeatSelection(supabase, order) {
  if (order.seat_selection !== undefined) return validSelection(order.seat_selection)
  const { data, error } = await supabase.from('event_orders').select('seat_selection').eq('id', order.id).maybeSingle()
  if (error) return null
  return validSelection(data?.seat_selection)
}

const validSelection = (s) => (s && Number.isInteger(Number(s.event_date_id)) && Array.isArray(s.seats) && s.seats.length ? s : null)

/** Marca vendidos los asientos de los QR recién emitidos: rows = [{ id, seat_key }]. */
export async function markSeatsSold(supabase, orderId, eventDateId, rows) {
  for (const r of rows || []) {
    if (!r?.seat_key) continue
    const { error } = await supabase
      .from('aitickets_event_seats')
      .update({ status: 'sold', attendee_ticket_id: r.id, expires_at: null })
      .eq('order_id', orderId)
      .eq('event_date_id', Number(eventDateId))
      .eq('seat_key', r.seat_key)
    if (error) console.error(`Orden ${orderId}: no se pudo marcar vendido ${r.seat_key}:`, error.message)
  }
}

/** Asientos ocupados de una función: string[] de claves. */
export async function takenSeats(supabase, eventDateId) {
  const { data, error } = await supabase.rpc('aitickets_taken_seats', { p_event_date_id: Number(eventDateId) })
  if (error) {
    if (isMissing(error)) return []
    throw new Error(`Error leyendo asientos: ${error.message}`)
  }
  return (data || []).map((r) => r.seat_key)
}

/** Asientos ocupados por función de un evento: Map<dateId, n>. */
export async function seatCounts(supabase, eventId) {
  const { data, error } = await supabase.rpc('aitickets_seat_counts', { p_event_id: Number(eventId) })
  if (error) {
    if (!isMissing(error)) console.warn('seatCounts:', error.message)
    return new Map()
  }
  return new Map((data || []).map((r) => [Number(r.event_date_id), Number(r.taken) || 0]))
}

