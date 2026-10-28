// Aviso automático a la lista de espera (aitickets_event_waitlist, función programada send-waitlist-notifications).
// - Se avisa a quien se anotó cuando su evento (o su función, si se anotó a una) tiene al menos una entrada que se
//   puede comprar ahora: disponible, no regalo, dentro de su ventana de venta y con stock (vendidas y reservas
//   en curso descontadas, aitickets_ticket_availability). Sirve para los tres motivos: 'sale_opens' (abrió la
//   venta), 'sold_out' y 'full' (se liberó cupo o se abrió otra tanda).
// - Un solo correo por persona y evento; después se marca notified_at y no se le vuelve a escribir.
// - Solo eventos publicados, no cancelados, no demo, que no hayan terminado.
import { createHash } from 'node:crypto'

import { sendEmail as defaultSendEmail, SITE_URL, isValidEmail } from './mailer.mjs'
import { renderWaitlistOpenEmail } from './emails/index.mjs'
import { LEGAL } from './legal.mjs'
import { formatDateOnlyLong, formatTimeShort } from './dates.mjs'
import { isDemoEventSlug } from '../../src/lib/demoEvent.mjs'

export const WAITLIST_TABLE = 'aitickets_event_waitlist'
export const WAITLIST_KIND_LABELS = Object.freeze({ sale_opens: 'Venta por abrir', sold_out: 'Agotado', full: 'Cupos llenos' })
/** Anotados más antiguos que esto ya no se avisan (el evento cambió demasiado o lo olvidaron). */
export const WAITLIST_MAX_AGE_DAYS = 180
/** Canal de la venta en la analítica ("ventas por canal"). */
export const WAITLIST_REF = 'lista-espera'

const isMissingTable = (error) => ['42P01', 'PGRST205'].includes(String(error?.code || ''))

/**
 * Entradas que se pueden comprar ahora, con su función. `availability`: filas de aitickets_ticket_availability
 * ({ ticket_id, sold, pending }).
 */
export function buyableTickets(tickets, availability, now = new Date()) {
  const used = new Map((availability || []).map((r) => [String(r.ticket_id), (Number(r.sold) || 0) + (Number(r.pending) || 0)]))
  return (tickets || []).filter((t) => {
    if (t.status !== 'available' || t.is_gift) return false
    if (t.init_date && new Date(t.init_date) > now) return false
    if (t.end_date && new Date(t.end_date) < now) return false
    if (t.total_quantity === null || t.total_quantity === undefined) return true
    return Number(t.total_quantity) - (used.get(String(t.id)) || 0) > 0
  })
}

/** ¿Hay algo comprable para esta fila? Anotado a una función: entradas de esa función o "para todas las funciones". */
export function isWaitlistRowOpen(row, buyable) {
  if (row.event_date_id == null) return buyable.length > 0
  return buyable.some((t) => t.event_date_id == null || String(t.event_date_id) === String(row.event_date_id))
}

/** Link del correo, con el canal para medir las ventas que trae. */
// Lista de un evento para el panel y la API de productores: más reciente primero, con el motivo y la función en texto.
export async function listWaitlist(supabase, eventId, { limit = 5000 } = {}) {
  const { data, error } = await supabase
    .from(WAITLIST_TABLE)
    .select('id, email, kind, event_date_id, created_at, notified_at')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error

  const dateIds = [...new Set((data || []).map((r) => r.event_date_id).filter((id) => id != null))]
  const { data: dates } = dateIds.length
    ? await supabase.from('event_dates').select('id, date, start_time').in('id', dateIds)
    : { data: [] }
  const fnLabel = new Map(
    (dates || []).map((d) => [
      String(d.id),
      [new Date(`${d.date}T12:00:00Z`).toLocaleDateString('es-CL', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }), d.start_time?.slice(0, 5)]
        .filter(Boolean)
        .join(' · '),
    ]),
  )
  const rows = (data || []).map((r) => ({
    id: r.id,
    email: r.email,
    kind: r.kind,
    kind_label: WAITLIST_KIND_LABELS[r.kind] || r.kind,
    event_date_id: r.event_date_id,
    function_label: r.event_date_id != null ? fnLabel.get(String(r.event_date_id)) || 'Función eliminada' : null,
    created_at: r.created_at,
    notified_at: r.notified_at,
  }))
  const notified = rows.filter((r) => r.notified_at).length
  return { total: rows.length, notified, pending: rows.length - notified, rows }
}

export const waitlistEventUrl = (slug) => `${SITE_URL}/eventos/${encodeURIComponent(slug || '')}?ref=${WAITLIST_REF}`

async function pendingRows(supabase, now) {
  const since = new Date(now.getTime() - WAITLIST_MAX_AGE_DAYS * 86400_000).toISOString()
  const { data, error } = await supabase
    .from(WAITLIST_TABLE)
    .select('id, event_id, event_date_id, email, kind, created_at')
    .is('notified_at', null)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(5000)
  if (isMissingTable(error)) return []
  if (error) throw error
  return data || []
}

/**
 * Envía los avisos que correspondan. Nunca lanza por un evento: lo registra y sigue con el resto.
 * @returns {Promise<{ events: number, sent: number, failed: number }>}
 */
export async function notifyWaitlist(supabase, { now = new Date(), sendEmail = defaultSendEmail } = {}) {
  const byEvent = new Map()
  for (const row of await pendingRows(supabase, now)) {
    if (!byEvent.has(row.event_id)) byEvent.set(row.event_id, [])
    byEvent.get(row.event_id).push(row)
  }

  let events = 0
  let sent = 0
  let failed = 0
  for (const [eventId, rows] of byEvent) {
    try {
      const { data: event, error: eError } = await supabase
        .from('events')
        .select('id, name, slug, status, organization_id, cancelled_at, end_date')
        .eq('id', eventId)
        .maybeSingle()
      if (eError) throw eError
      if (!event || event.status !== 'published' || event.cancelled_at || isDemoEventSlug(event.slug)) continue
      if (event.end_date && new Date(event.end_date) < now) continue

      const [{ data: tickets, error: tError }, { data: availability, error: aError }] = await Promise.all([
        supabase
          .from('event_tickets')
          .select('id, status, is_gift, total_quantity, init_date, end_date, event_date_id')
          .eq('event_id', eventId),
        supabase.rpc('aitickets_ticket_availability', { p_event_id: eventId }),
      ])
      if (tError) throw tError
      // Sin el conteo de stock no se puede saber si hay cupo: mejor no avisar que avisar de más
      if (aError) throw aError
      const buyable = buyableTickets(tickets, availability, now)
      if (!buyable.length) continue

      const byEmail = new Map()
      for (const row of rows) {
        const email = String(row.email || '').trim().toLowerCase()
        if (!isValidEmail(email) || !isWaitlistRowOpen(row, buyable)) continue
        if (!byEmail.has(email)) byEmail.set(email, [])
        byEmail.get(email).push(row)
      }
      if (!byEmail.size) continue
      events += 1

      const { data: org } = await supabase.from('organizations').select('public_name, email').eq('id', event.organization_id).maybeSingle()
      const replyTo = org?.email && isValidEmail(org.email) ? org.email : LEGAL.supportEmail
      const dateIds = [...new Set(rows.map((r) => r.event_date_id).filter((id) => id != null))]
      const { data: dates } = dateIds.length
        ? await supabase.from('event_dates').select('id, date, start_time').in('id', dateIds)
        : { data: [] }
      const fnLabel = new Map((dates || []).map((d) => [String(d.id), [formatDateOnlyLong(d.date), d.start_time ? `${formatTimeShort(d.start_time)} h` : null].filter(Boolean).join(' · ')]))

      for (const [email, mine] of byEmail) {
        const fnIds = [...new Set(mine.map((r) => r.event_date_id).filter((id) => id != null).map(String))]
        const { subject, html, text } = await renderWaitlistOpenEmail({
          eventName: event.name,
          organizerName: org?.public_name || '',
          opened: mine.some((r) => r.kind === 'sale_opens'),
          whenLabel: fnIds.length === 1 ? fnLabel.get(fnIds[0]) || '' : '',
          eventUrl: waitlistEventUrl(event.slug),
        })
        const key = createHash('sha256').update(email).digest('hex').slice(0, 24)
        try {
          await sendEmail({ to: email, subject, html, text, replyTo, tags: ['waitlist'], idempotencyKey: `waitlist-${eventId}-${key}` })
          sent += 1
          const { error: uError } = await supabase
            .from(WAITLIST_TABLE)
            .update({ notified_at: now.toISOString() })
            .in('id', mine.map((r) => r.id))
          if (uError) console.warn('waitlist: no se pudo marcar como avisado:', uError.message)
        } catch (err) {
          failed += 1
          console.error(`send-waitlist-notifications: evento ${eventId}:`, err?.message)
        }
      }
    } catch (err) {
      console.error(`send-waitlist-notifications: evento ${eventId}:`, err?.message || err)
    }
  }
  return { events, sent, failed }
}
