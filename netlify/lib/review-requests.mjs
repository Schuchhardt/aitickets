// Correo "¿Cómo estuvo?" 24 h después de cada función (función programada send-review-requests, cada hora).
// - Por cada función que terminó hace entre REVIEW_REQUEST_DELAY_HOURS y REVIEW_REQUEST_WINDOW_HOURS (la
//   ventana cubre ejecuciones perdidas) se escribe a quienes tienen entradas vigentes de ESA función y, si es la
//   última función del evento, también a las entradas "cualquier función" (event_date_id NULL o de una función
//   que ya no existe). Eventos antiguos sin funciones: por events.end_date.
// - Solo eventos publicados, no cancelados, no demo y con review_settings.enabled (por defecto sí).
// - Un correo por email y evento: se omite a quien ya lo recibió (notification_log type 'review_request') o ya
//   calificó. Cada destinatario recibe su link firmado (review-token.mjs) y un link por estrella.
import { createHash } from 'node:crypto'

import { escapeHtml, fetchAllRows } from './supabase.mjs'
import { sendEmail as defaultSendEmail, SITE_URL, formatRecipient, isValidEmail } from './mailer.mjs'
import { renderReviewRequestEmail } from './emails/index.mjs'
import { LEGAL } from './legal.mjs'
import { greetingName, holderName } from './buyer-name.mjs'
import { todayInTimeZone, addDays } from './dates.mjs'
import { isDemoEventSlug } from '../../src/lib/demoEvent.mjs'
import {
  REVIEWS_TABLE,
  REVIEW_REQUEST_TYPE,
  REVIEW_REQUEST_DELAY_HOURS,
  REVIEW_REQUEST_WINDOW_HOURS,
  dueReviewFunctions,
  lastFunctionOf,
  normalizeReviewSettings,
  isLiveTicketStatus,
  rewardLabel,
} from './reviews.mjs'
import { signReviewToken } from './review-token.mjs'

const BATCH_SIZE = 50
const EVENT_COLUMNS = 'id, name, slug, status, organization_id, cancelled_at, end_date'
const isMissingTable = (error) => ['42P01', 'PGRST205'].includes(String(error?.code || ''))

/** Links del correo: página del evento con el token en el fragmento (#), que no llega a servidores ni a analytics. */
export function reviewLinks(slug, token) {
  const base = `${SITE_URL}/eventos/${encodeURIComponent(slug || '')}#resena=${encodeURIComponent(token)}`
  return { review: base, stars: [1, 2, 3, 4, 5].map((n) => `${base}&nota=${n}`) }
}

async function loadEvent(supabase, eventId) {
  let { data, error } = await supabase.from('events').select(`${EVENT_COLUMNS}, review_settings`).eq('id', eventId).maybeSingle()
  // Base sin la migración 202610220100: sin review_settings (valores por defecto)
  if (error?.code === '42703') ({ data, error } = await supabase.from('events').select(EVENT_COLUMNS).eq('id', eventId).maybeSingle())
  if (error) throw error
  return data
}

/**
 * Eventos con reseñas por pedir ahora: Map eventId => { dueIds: Set<string>, whole: boolean }.
 */
async function findDueEvents(supabase, now) {
  const today = todayInTimeZone(undefined, now)
  const { data: dates, error } = await supabase
    .from('event_dates')
    .select('id, event_id, date, start_time, end_time')
    .gte('date', addDays(today, -5))
    .lte('date', today)
  if (error) throw error
  const due = new Map()
  for (const fn of dueReviewFunctions(dates || [], now)) {
    if (!due.has(fn.event_id)) due.set(fn.event_id, { dueIds: new Set(), whole: false })
    due.get(fn.event_id).dueIds.add(String(fn.id))
  }
  // Eventos antiguos sin funciones (solo events.end_date)
  const { data: legacy, error: lError } = await supabase
    .from('events')
    .select('id')
    .eq('status', 'published')
    .gt('end_date', new Date(now.getTime() - REVIEW_REQUEST_WINDOW_HOURS * 3600_000).toISOString())
    .lte('end_date', new Date(now.getTime() - REVIEW_REQUEST_DELAY_HOURS * 3600_000).toISOString())
    .limit(500)
  if (lError) throw lError
  for (const e of legacy || []) {
    if (due.has(e.id)) continue
    const { count } = await supabase.from('event_dates').select('id', { count: 'exact', head: true }).eq('event_id', e.id)
    if (!count) due.set(e.id, { dueIds: new Set(), whole: true })
  }
  return due
}

/**
 * Envía los correos de reseña que correspondan. Nunca lanza por un evento: lo registra y sigue con el resto.
 * @returns {Promise<{ events: number, sent: number, failed: number }>}
 */
export async function sendReviewRequests(supabase, { now = new Date(), sendEmail = defaultSendEmail } = {}) {
  const due = await findDueEvents(supabase, now)
  let sent = 0
  let failed = 0
  let events = 0

  for (const [eventId, { dueIds, whole }] of due) {
    try {
      const event = await loadEvent(supabase, eventId)
      if (!event || event.status !== 'published' || event.cancelled_at || isDemoEventSlug(event.slug)) continue
      const settings = normalizeReviewSettings(event.review_settings)
      if (!settings.enabled) continue

      const { data: allDates, error: dError } = await supabase.from('event_dates').select('id, date, start_time, end_time').eq('event_id', eventId)
      if (dError) throw dError
      const dateIds = new Set((allDates || []).map((d) => String(d.id)))
      const last = lastFunctionOf(allDates || [])
      const includeUntied = whole || (last && dueIds.has(String(last.id)))

      const tickets = await fetchAllRows(() => supabase
        .from('event_attendees')
        .select('id, status, attendee_id, attendees ( id, first_name, last_name, email ), event_tickets ( event_date_id ), event_orders ( buyer_first_name, buyer_last_name )')
        .eq('event_id', eventId)
        .order('id', { ascending: true }))

      const { data: logged, error: logError } = await supabase.from('notification_log').select('attendee_id').eq('event_id', eventId).eq('type', REVIEW_REQUEST_TYPE)
      if (logError) throw logError
      const alreadyAsked = new Set((logged || []).map((r) => String(r.attendee_id)))

      const { data: reviews, error: rError } = await supabase.from(REVIEWS_TABLE).select('email').eq('event_id', eventId).limit(20000)
      if (rError && !isMissingTable(rError)) throw rError
      const reviewed = new Set((reviews || []).map((r) => String(r.email).toLowerCase()))

      const recipients = []
      const seen = new Set()
      for (const ea of tickets) {
        if (!isLiveTicketStatus(ea.status)) continue
        const fnRaw = (Array.isArray(ea.event_tickets) ? ea.event_tickets[0] : ea.event_tickets)?.event_date_id ?? null
        const fnId = fnRaw != null && dateIds.has(String(fnRaw)) ? String(fnRaw) : null
        if (fnId ? !dueIds.has(fnId) : !includeUntied) continue
        const a = Array.isArray(ea.attendees) ? ea.attendees[0] : ea.attendees
        const email = String(a?.email || '').trim().toLowerCase()
        if (!email || !isValidEmail(email) || seen.has(email) || reviewed.has(email) || alreadyAsked.has(String(a.id))) continue
        seen.add(email)
        recipients.push({ id: a.id, email, ...holderName(a, ea.event_orders) })
      }
      if (!recipients.length) continue
      events += 1

      const { data: org } = await supabase.from('organizations').select('public_name, email').eq('id', event.organization_id).maybeSingle()
      const { subject, html, text } = await renderReviewRequestEmail({
        eventName: event.name,
        organizerName: org?.public_name || '',
        rewardLabel: rewardLabel(settings.reward),
      })
      const replyTo = org?.email && isValidEmail(org.email) ? org.email : LEGAL.supportEmail

      for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
        const batch = []
        const recipientVariables = {}
        const to = []
        for (const r of recipients.slice(i, i + BATCH_SIZE)) {
          const token = signReviewToken({ eventId, email: r.email }, { now })
          if (!token) throw new Error('falta el secreto de firma de reseñas (REVIEW_TOKEN_SECRET)')
          const links = reviewLinks(event.slug, token)
          const name = greetingName(r.first_name, r.last_name)
          const vars = { name: { html: escapeHtml(name), text: name }, review_url: { html: escapeHtml(links.review), text: links.review } }
          links.stars.forEach((url, n) => (vars[`star${n + 1}`] = { html: escapeHtml(url), text: url }))
          recipientVariables[r.email] = vars
          to.push(formatRecipient(`${r.first_name || ''} ${r.last_name || ''}`, r.email))
          batch.push(r)
        }
        // La clave depende de los destinatarios: un reintento del mismo lote no duplica, uno distinto no choca
        const key = createHash('sha256').update(batch.map((r) => r.email).join(',')).digest('hex').slice(0, 24)
        try {
          await sendEmail({ to, subject, html, text, replyTo, recipientVariables, tags: ['review-request'], idempotencyKey: `review-${eventId}-${key}` })
          sent += batch.length
          const { error: insError } = await supabase
            .from('notification_log')
            .insert(batch.map((r) => ({ event_id: eventId, attendee_id: r.id, type: REVIEW_REQUEST_TYPE, channel: 'email', status: 'sent' })))
          if (insError) console.warn('notification_log (reseñas):', insError.message)
        } catch (err) {
          failed += batch.length
          console.error(`send-review-requests: lote del evento ${eventId} falló:`, err?.message)
        }
      }
    } catch (err) {
      console.error(`send-review-requests: evento ${eventId}:`, err?.message || err)
    }
  }
  return { events, sent, failed }
}
