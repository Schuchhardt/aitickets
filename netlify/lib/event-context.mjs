// Contexto de un evento publicado para los asistentes de IA (página del evento y bot de WhatsApp).
// Se arma EN EL SERVIDOR desde la BD: solo eventos publicados, columnas explícitas, nunca secret_location.
import { TICKET_COLUMNS, isTicketOnSale, maxPerPurchase, getSoldCounts } from './tickets.mjs'
import { IVA_PERCENT_LABEL, SERVICE_FEE_PERCENT_LABEL, computeBuyerTotal } from './fees.mjs'
import { isDemoEventSlug, getDemoEventDate } from '../../src/lib/demoEvent.mjs'
import { EVENT_DATE_COLUMNS, todayInTimeZone, formatDateOnlyLong, formatTimeShort, formatEventLocation } from './dates.mjs'

export const stripHtml = (html) => String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()

/**
 * Carga un evento publicado por id ({id}) o slug ({slug}) con sus funciones, entradas a la venta y FAQs.
 * Devuelve null si no existe o no está publicado.
 */
export async function loadEventContext(supabase, { id, slug }) {
  const loadEvent = cols => {
    let q = supabase.from('events').select(cols).eq('status', 'published')
    q = id != null ? q.eq('id', id) : q.eq('slug', slug)
    return q.maybeSingle()
  }
  let { data: event, error } = await loadEvent('id, slug, name, description, location, start_date, end_date, fee_absorbed')
  // Base sin events.fee_absorbed (202610090200): el comprador paga el cargo, como siempre
  if (error && ['42703', 'PGRST204'].includes(String(error.code || ''))) ({ data: event, error } = await loadEvent('id, slug, name, description, location, start_date, end_date'))
  if (error) throw new Error(error.message)
  if (!event) return null
  const feeAbsorbed = event.fee_absorbed === true
  const isDemo = isDemoEventSlug(event.slug)
  const eventId = event.id

  const [{ data: dates }, { data: tickets }, { data: faqs }] = await Promise.all([
    supabase.from('event_dates').select(EVENT_DATE_COLUMNS).eq('event_id', eventId).order('date', { ascending: true }).order('start_time', { ascending: true }).limit(20),
    supabase.from('event_tickets').select(TICKET_COLUMNS).eq('event_id', eventId).order('price', { ascending: true }),
    supabase.from('event_faqs').select('question, answer').eq('event_id', eventId).limit(30),
  ])

  const now = new Date()
  const onSale = (tickets || []).filter(t => isTicketOnSale(t, now))
  const limitedIds = onSale.filter(t => t.total_quantity != null).map(t => Number(t.id))
  let sold = new Map()
  if (limitedIds.length) {
    // getSoldCounts usa el RPC aitickets_ticket_availability (misma regla que la reserva de la compra)
    try { sold = await getSoldCounts(supabase, eventId, limitedIds) } catch { /* sin stock no bloquea el chat */ }
  }
  const saleTickets = onSale.map(t => ({
    id: Number(t.id),
    name: t.ticket_name,
    price: Math.round(Number(t.price) || 0),
    max: maxPerPurchase(t),
    soldOut: t.total_quantity != null && Number(t.total_quantity) - (sold.get(Number(t.id)) || 0) <= 0,
  }))

  // Evento demo: fecha dinámica (misma fecha que muestra la página)
  const demoDate = isDemo ? getDemoEventDate(now, event.slug) : null
  const eventDates = (dates || []).map(d => (demoDate ? { ...d, date: demoDate } : d))
  return { event, feeAbsorbed, isDemo, dates: eventDates, tickets: saleTickets, faqs: faqs || [] }
}

/** Regla del cargo por servicio para el comprador, según si el productor lo absorbe. */
export function feeRuleText(feeAbsorbed) {
  return feeAbsorbed
    ? 'En este evento el cargo por servicio está incluido en el precio de cada entrada: el comprador paga exactamente el precio publicado, sin cargos adicionales.'
    : `Las entradas pagadas tienen un cargo por servicio del ${SERVICE_FEE_PERCENT_LABEL} del valor de las entradas, más IVA (${IVA_PERCENT_LABEL}) sobre ese cargo; el desglose (subtotal, cargo, IVA del cargo y total) se muestra antes de pagar.`
}

/** Ficha del evento en texto (fechas, lugar, entradas a la venta con total, FAQs) para el prompt. */
export function eventInfoText({ event, feeAbsorbed, dates, tickets, faqs }) {
  const today = todayInTimeZone()
  const upcoming = dates.filter(d => d.date >= today)
  const dateLines = (upcoming.length ? upcoming : dates).map(d => {
    const place = formatEventLocation(d.event_locations) || event.location || 'por confirmar'
    const time = `${formatTimeShort(d.start_time)}${d.end_time ? ` a ${formatTimeShort(d.end_time)}` : ''}`
    return `- ${formatDateOnlyLong(d.date)}, ${time} hrs. Lugar: ${place}`
  })
  if (!dateLines.length && event.start_date) {
    dateLines.push(`- ${new Date(event.start_date).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'full', timeStyle: 'short' })}. Lugar: ${event.location || 'por confirmar'}`)
  }
  const clp = n => `$${n.toLocaleString('es-CL')} CLP`
  const ticketLines = tickets.map(t =>
    `- ID ${t.id}: "${t.name}" — ${t.price > 0 ? (feeAbsorbed ? `${clp(t.price)}, cargo por servicio incluido (total ${clp(t.price)} por 1 entrada)` : `${clp(t.price)} + cargo por servicio ${SERVICE_FEE_PERCENT_LABEL} + IVA (total ${clp(computeBuyerTotal(t.price).total)} por 1 entrada)`) : 'Gratis'}; máximo ${t.max} por compra${t.soldOut ? ' (AGOTADA)' : ''}`
  )
  const faqLines = faqs.map(f => `- P: ${stripHtml(f.question).slice(0, 300)}\n  R: ${stripHtml(f.answer).slice(0, 600)}`)

  return `Información del evento (ID ${event.id}):
Nombre: ${event.name}
Descripción: ${stripHtml(event.description).slice(0, 3000) || 'Sin descripción'}
Fechas y lugar:
${dateLines.join('\n') || '- Por confirmar'}
Entradas a la venta:
${ticketLines.join('\n') || '- No hay entradas a la venta en este momento'}
Preguntas frecuentes:
${faqLines.join('\n') || '- No hay preguntas frecuentes'}`
}
