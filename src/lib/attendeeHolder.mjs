// Titular de cada entrada para certificados, credenciales y listas: el nombre y correo escritos para esa entrada
// (event_attendees.holder_name / holder_email, cuando la compra los pide por asistente) y, si no, los de quien
// compró: los de la orden (buyer_first_name / buyer_email) y, en órdenes antiguas, los del attendee.
// Las columnas holder_* y event_orders.company_name pueden no existir todavía (deploy previews comparten la BD de
// producción): las consultas las piden y, si PostgREST responde 42703, repiten sin ellas.
import { holderName } from '../../netlify/lib/buyer-name.mjs'

export const HOLDER_COLUMNS = 'holder_name, holder_email'

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()
const one = (v) => (Array.isArray(v) ? v[0] : v) || null

/** Columna que no existe (aún sin migrar). */
export const isMissingColumn = (error) => ['42703', 'PGRST204'].includes(error?.code) || /column .* does not exist|could not find the .* column/i.test(error?.message || '')

/**
 * ¿Terminó el evento? events.end_date (se recalcula con las funciones) o, sin ella, el inicio. Hasta entonces cada
 * persona puede completar sus datos desde su entrada (/api/tickets/holder).
 * @param {{ end_date?: string|null, start_date?: string|null }} event
 */
export function eventEnded(event, now = Date.now()) {
  const end = Date.parse(event?.end_date || event?.start_date || '')
  return Number.isFinite(end) && end < now
}

/**
 * Nombre y correo de una entrada (fila de event_attendees con `attendees` y, si viene, `event_orders` embebidos).
 * @returns {{ name: string, email: string }}
 */
export function ticketHolder(row) {
  const name = clean(row?.holder_name)
  const email = clean(row?.holder_email).toLowerCase()
  const order = one(row?.event_orders)
  const buyer = holderName(one(row?.attendees), order)
  const buyerName = clean(`${buyer.first_name || ''} ${buyer.last_name || ''}`)
  const buyerEmail = clean(order?.buyer_email || one(row?.attendees)?.email).toLowerCase()
  return { name: name || buyerName, email: email || buyerEmail }
}

/**
 * Todas las entradas de un evento (o solo `ids`) con sus titulares, paginadas de a 1000. `columns` son las de
 * event_attendees sin las holder_*: se agregan solas (y se quitan si la BD aún no las tiene).
 * @param {any} supabase
 * @param {number} eventId
 * @param {string} columns
 * @param {{ ids?: string[] | null }} [opts]
 * @returns {Promise<any[]>}
 */
export async function loadEventTickets(supabase, eventId, columns, { ids = null } = {}) {
  const embeds = 'attendees ( first_name, last_name, email ), event_orders ( buyer_first_name, buyer_last_name, buyer_email )'
  let withHolder = true
  const rows = []
  for (let from = 0; from < 200_000; ) {
    const select = `${columns}, ${withHolder ? `${HOLDER_COLUMNS}, ` : ''}${embeds}`
    let query = supabase.from('event_attendees').select(select).eq('event_id', eventId)
    if (ids) query = query.in('id', ids)
    const { data, error } = await query.order('created_at', { ascending: true }).range(from, from + 999)
    if (error) {
      if (withHolder && isMissingColumn(error)) {
        withHolder = false
        continue
      }
      throw new Error(error.message)
    }
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
    from += 1000
  }
  return rows
}

/** Empresa de cada orden (event_orders.company_name), si la compra la pidió. Sin la columna, un mapa vacío. */
export async function loadOrderCompanies(supabase, orderIds) {
  const ids = [...new Set((orderIds || []).filter(Boolean).map(String))]
  const companies = new Map()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('event_orders').select('id, company_name').in('id', ids.slice(i, i + 200))
    if (error) {
      if (!isMissingColumn(error)) console.error('loadOrderCompanies:', error.message)
      return new Map()
    }
    for (const o of data || []) {
      const name = clean(o.company_name)
      if (name) companies.set(String(o.id), name)
    }
  }
  return companies
}
