// "Mis entradas": las órdenes de un asistente (por email) en todos los eventos, separadas en próximas y pasadas.
// Lo usa src/pages/mis-entradas.astro con la sesión de asistente (netlify/lib/buyer-session.mjs). Solo servidor.
import { orderKind } from './order-kind.mjs'
import { isLiveTicketStatus, escapeLike } from './reviews.mjs'

const ORDER_COLUMNS = 'id, created_at, status, event_id, attendee_id, total_payment, amount, payment_provider, ticket_details, buyer_email'
const EVENT_COLUMNS = 'id, name, slug, image_url, start_date, end_date, location'
// Órdenes que se muestran: pagadas y las que se están emitiendo (pago recibido, entradas en camino)
const LISTED_STATUSES = ['paid', 'processing']
const MAX_ORDERS = 200

/**
 * Agrupa las órdenes del asistente. Una orden pagada sin entradas vigentes (reembolsada, transferida entera) no
 * aparece. Próximas: el evento no ha terminado (end_date, o start_date + 6 h sin end_date), de la más cercana a la
 * más lejana. Pasadas: de la más reciente a la más antigua.
 * @param {Array<any>} orders filas de event_orders con `events` embebido
 * @param {Map<string, number>} liveCounts orderId => entradas vigentes
 */
export function groupBuyerOrders(orders, liveCounts, now = new Date()) {
  const items = []
  for (const o of orders || []) {
    const event = Array.isArray(o.events) ? o.events[0] : o.events
    if (!event) continue
    const count = liveCounts.get(String(o.id)) || 0
    if (o.status === 'paid' && !count) continue
    const startMs = event.start_date ? new Date(event.start_date).getTime() : NaN
    const endMs = event.end_date ? new Date(event.end_date).getTime() : Number.isFinite(startMs) ? startMs + 6 * 3600 * 1000 : NaN
    items.push({
      orderId: String(o.id),
      status: o.status,
      kind: orderKind(o),
      count,
      createdAt: o.created_at,
      upcoming: !Number.isFinite(endMs) || endMs >= now.getTime(),
      startMs: Number.isFinite(startMs) ? startMs : 0,
      event: { id: event.id, name: event.name || 'Evento', slug: event.slug || '', image_url: event.image_url || '', start_date: event.start_date || null, end_date: event.end_date || null, location: event.location || '' },
    })
  }
  const upcoming = items.filter((i) => i.upcoming).sort((a, b) => a.startMs - b.startMs)
  const past = items.filter((i) => !i.upcoming).sort((a, b) => b.startMs - a.startMs)
  return { upcoming, past }
}

/** Órdenes de un email (las de buyer_email y, en órdenes antiguas sin buyer_email, las del registro attendees). */
export async function listBuyerOrders(supabase, email, { now = new Date() } = {}) {
  const target = String(email || '').trim().toLowerCase()
  if (!target) return { upcoming: [], past: [] }
  const select = `${ORDER_COLUMNS}, events ( ${EVENT_COLUMNS} )`
  const [{ data: direct, error }, { data: people, error: peopleError }] = await Promise.all([
    supabase.from('event_orders').select(select).eq('buyer_email', target).in('status', LISTED_STATUSES).order('created_at', { ascending: false }).limit(MAX_ORDERS),
    supabase.from('attendees').select('id').ilike('email', escapeLike(target)).limit(20),
  ])
  if (error) throw error
  if (peopleError) throw peopleError
  let legacy = []
  const attendeeIds = (people || []).map((p) => p.id)
  if (attendeeIds.length) {
    const { data, error: legacyError } = await supabase
      .from('event_orders')
      .select(select)
      .in('attendee_id', attendeeIds)
      .is('buyer_email', null)
      .in('status', LISTED_STATUSES)
      .order('created_at', { ascending: false })
      .limit(MAX_ORDERS)
    if (legacyError) throw legacyError
    legacy = data || []
  }
  const orders = [...(direct || []), ...legacy]
  const liveCounts = new Map()
  if (orders.length) {
    const { data: tickets, error: ticketsError } = await supabase
      .from('event_attendees')
      .select('event_order_id, status')
      .in('event_order_id', orders.map((o) => o.id))
      .limit(5000)
    if (ticketsError) throw ticketsError
    for (const t of tickets || []) {
      if (isLiveTicketStatus(t.status)) liveCounts.set(String(t.event_order_id), (liveCounts.get(String(t.event_order_id)) || 0) + 1)
    }
  }
  return groupBuyerOrders(orders, liveCounts, now)
}

/** ¿El email tiene alguna orden pagada? (para no enviar links de acceso a direcciones sin entradas) */
export async function hasBuyerOrders(supabase, email) {
  const { upcoming, past } = await listBuyerOrders(supabase, email)
  return upcoming.length + past.length > 0
}
