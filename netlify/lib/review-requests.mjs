// Correos "¿Cómo estuvo?" (función programada send-review-requests, cada hora a los :20). Pedido del dueño (nov
// 2026): al menos 3 correos por persona, el primero cuando estén despiertos, para que califiquen y suban sus fotos.
//
// - A quién: por cada entrada vigente de la función, el correo de su titular (attendees.email), el de quien compró la
//   orden (event_orders.buyer_email) y el del asistente de ese QR (event_attendees.holder_email). Un envío por email.
// - 1º correo: 4 h después del término si la función termina de día y 8 h si termina de noche, corrido a la ventana
//   10:00-23:00 de Chile (firstReviewRequestAt en reviews.mjs), hasta 72 h después del término. Las entradas
//   "cualquier función" (event_date_id NULL o de una función que ya no existe) lo reciben después de la última función.
//   Eventos antiguos sin funciones: por events.end_date.
// - 2º y 3º (recordatorios): 2 días después del 1º y 3 días después del 2º (nextReviewReminderAt), hasta 10 días
//   después del 1º y solo si la persona sigue con una entrada vigente.
// - Nunca a quien ya calificó ni a quien pidió no recibir más recordatorios de ese evento (enlace del correo:
//   notification_log 'review_request_optout'). Los recordatorios tampoco a quien se dio de baja de la productora
//   (aitickets_org_email_optouts).
// - Fuera de 10:00-23:00 no sale nada: si la función programada se atrasó, espera a la mañana.
// - Solo eventos publicados, no cancelados, no demo y con review_settings.enabled (por defecto sí).
// - Cada envío queda en notification_log (type 'review_request', con email y attendee_id): cuántas filas tiene un email
//   dice en qué paso va. Las filas anteriores a la columna email (migración 202611080300) se asocian por attendee_id.
//   Si la columna aún no existe, se omite a quien no tiene attendee_id (no habría cómo registrar su envío).
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
  OPTOUTS_TABLE,
  REVIEW_REQUEST_TYPE,
  REVIEW_REQUEST_OPTOUT_TYPE,
  REVIEW_REQUEST_STEPS,
  REVIEW_REQUEST_WINDOW_HOURS,
  REVIEW_REMINDER_MAX_DAYS,
  dueReviewFunctions,
  isReviewSendTime,
  lastFunctionOf,
  nextReviewReminderAt,
  normalizeReviewSettings,
  isLiveTicketStatus,
  rewardLabel,
} from './reviews.mjs'
import { signReviewToken, signReviewReminderOptoutToken } from './review-token.mjs'

const BATCH_SIZE = 50
/** Event ids por consulta .in() (la URL de PostgREST tiene un largo máximo). */
const CHUNK = 100
/** Tiempo para empezar eventos nuevos: las funciones programadas mueren a los 30 s. */
const TIME_BUDGET_MS = 20_000
const EVENT_COLUMNS = 'id, name, slug, status, organization_id, cancelled_at, end_date'
/** Días hacia atrás en que se buscan funciones: primer correo (72 h) + ventana de recordatorios (10 días) + margen. */
const LOOKBACK_DAYS = Math.ceil(REVIEW_REQUEST_WINDOW_HOURS / 24) + REVIEW_REMINDER_MAX_DAYS + 1
const DAY_MS = 86_400_000
const isMissingTable = (error) => ['42P01', 'PGRST205'].includes(String(error?.code || ''))
const one = (v) => (Array.isArray(v) ? v[0] : v) || null
const cleanEmail = (v) => String(v ?? '').trim().toLowerCase()
const time = (v) => {
  const t = Date.parse(v ?? '')
  return Number.isFinite(t) ? t : null
}

/** Links del correo: página del evento con el token en el fragmento (#), que no llega a servidores ni a analytics. */
export function reviewLinks(slug, token) {
  const base = `${SITE_URL}/eventos/${encodeURIComponent(slug || '')}#resena=${encodeURIComponent(token)}`
  return { review: base, stars: [1, 2, 3, 4, 5].map((n) => `${base}&nota=${n}`) }
}

/** Enlaces de baja de los recordatorios: página de confirmación y one-click (List-Unsubscribe, RFC 8058). */
export function reviewOptoutLinks(token) {
  const t = encodeURIComponent(token)
  return { page: `${SITE_URL}/resenas/baja?t=${t}`, oneClick: `${SITE_URL}/api/resenas/baja?t=${t}` }
}

/**
 * Estado de cada persona según notification_log: cuántos correos de reseña recibió, cuándo el primero y el último, y
 * si pidió no recibir más. La clave es el email; las filas antiguas (sin email) usan `attendeeEmails` (attendee_id =>
 * email) o, si no se puede, 'a:<attendee_id>'.
 * @param {Array<{ attendee_id?: number | null, email?: string | null, type: string, created_at?: string }>} rows
 * @param {Map<string, string>} [attendeeEmails]
 * @returns {Map<string, { count: number, first: number | null, last: number | null, optedOut: boolean }>}
 */
export function summarizeReviewRequestLog(rows, attendeeEmails = new Map()) {
  const emails = new Map(attendeeEmails)
  // Filas nuevas con email y attendee_id: unen las antiguas del mismo attendee con el email
  for (const r of rows || []) {
    const email = cleanEmail(r?.email)
    if (email && r.attendee_id != null && !emails.has(String(r.attendee_id))) emails.set(String(r.attendee_id), email)
  }
  const out = new Map()
  for (const r of rows || []) {
    const key = cleanEmail(r?.email) || (r?.attendee_id != null ? emails.get(String(r.attendee_id)) || `a:${r.attendee_id}` : '')
    if (!key) continue
    if (!out.has(key)) out.set(key, { count: 0, first: null, last: null, optedOut: false })
    const s = out.get(key)
    if (r.type === REVIEW_REQUEST_OPTOUT_TYPE) {
      s.optedOut = true
      continue
    }
    if (r.type !== REVIEW_REQUEST_TYPE) continue
    s.count += 1
    const at = time(r.created_at)
    if (at != null) {
      s.first = s.first == null ? at : Math.min(s.first, at)
      s.last = s.last == null ? at : Math.max(s.last, at)
    }
  }
  return out
}

/** ¿Le toca un recordatorio (2º o 3º correo) ahora a quien tiene este estado? */
export function reminderDue(state, now = new Date()) {
  if (!state || state.optedOut || state.count < 1 || state.count >= REVIEW_REQUEST_STEPS || state.first == null) return false
  if (now.getTime() > state.first + REVIEW_REMINDER_MAX_DAYS * DAY_MS) return false
  const next = nextReviewReminderAt(state.count, state.last)
  return Boolean(next && next.getTime() <= now.getTime())
}

/**
 * Eventos con funciones recientes (o, sin funciones, events.end_date reciente): pueden tener un primer correo o un
 * recordatorio pendiente. Devuelve sus ids (string).
 */
async function findCandidateEvents(supabase, now) {
  const today = todayInTimeZone(undefined, now)
  const dates = await fetchAllRows(() =>
    supabase.from('event_dates').select('id, event_id').gte('date', addDays(today, -LOOKBACK_DAYS)).lte('date', today).order('id', { ascending: true })
  )
  const ids = new Set(dates.map((d) => String(d.event_id)))
  // Eventos antiguos sin funciones (solo events.end_date)
  const { data: legacy, error } = await supabase
    .from('events')
    .select('id')
    .eq('status', 'published')
    .gt('end_date', new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS).toISOString())
    .lte('end_date', now.toISOString())
    .limit(500)
  if (error) throw error
  for (const e of legacy || []) {
    if (ids.has(String(e.id))) continue
    const { count } = await supabase.from('event_dates').select('id', { count: 'exact', head: true }).eq('event_id', e.id)
    if (!count) ids.add(String(e.id))
  }
  return [...ids]
}

/** Filas de `table` con `column` en `ids`, de a CHUNK ids por consulta (paginadas). */
async function loadIn(supabase, table, cols, column, ids) {
  const out = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK)
    out.push(...(await fetchAllRows(() => supabase.from(table).select(cols).in(column, slice).order('id', { ascending: true }))))
  }
  return out
}

/** Eventos que pueden pedir reseñas (publicados, no cancelados, no demo, con el correo activado). */
async function loadEligibleEvents(supabase, ids) {
  let rows
  try {
    rows = await loadIn(supabase, 'events', `${EVENT_COLUMNS}, review_settings`, 'id', ids)
  } catch (err) {
    // Base sin la migración 202610220100: sin review_settings (valores por defecto)
    if (!/review_settings/i.test(String(err?.message || ''))) throw err
    rows = await loadIn(supabase, 'events', EVENT_COLUMNS, 'id', ids)
  }
  return rows
    .filter((e) => e.status === 'published' && !e.cancelled_at && !isDemoEventSlug(e.slug))
    .map((e) => ({ ...e, settings: normalizeReviewSettings(e.review_settings) }))
    .filter((e) => e.settings.enabled)
}

/** Funciones del evento cuyo primer correo toca ahora, y si las entradas "cualquier función" también lo reciben. */
function firstDueOf(event, dates, now) {
  if (dates.length) {
    const firstDueIds = new Set(dueReviewFunctions(dates, now).map((fn) => String(fn.id)))
    const last = lastFunctionOf(dates)
    return { firstDueIds, includeUntied: Boolean(last && firstDueIds.has(String(last.id))) }
  }
  // Evento antiguo sin funciones: todas sus entradas son "cualquier función"
  return { firstDueIds: new Set(), includeUntied: dueReviewFunctions([{ id: 'event', end_date: event.end_date }], now).length > 0 }
}

/** notification_log del evento (correos de reseña y bajas), con o sin la columna email. */
async function loadRequestLog(supabase, eventId) {
  const query = (cols) => () =>
    supabase.from('notification_log').select(cols).eq('event_id', eventId).in('type', [REVIEW_REQUEST_TYPE, REVIEW_REQUEST_OPTOUT_TYPE]).order('id', { ascending: true })
  try {
    return { rows: await fetchAllRows(query('id, attendee_id, email, type, created_at')), hasEmailColumn: true }
  } catch (err) {
    if (!/column .*email.* does not exist|could not find the 'email' column|42703/i.test(String(err?.message || ''))) throw err
    return { rows: await fetchAllRows(query('id, attendee_id, type, created_at')), hasEmailColumn: false }
  }
}

/** Entradas del evento con titular, comprador y asistente del QR (holder_* puede no existir aún). */
async function loadTickets(supabase, eventId) {
  const base = 'id, status, attendee_id, attendees ( id, first_name, last_name, email ), event_tickets ( event_date_id ), event_orders ( attendee_id, buyer_first_name, buyer_last_name, buyer_email )'
  const query = (cols) => () => supabase.from('event_attendees').select(cols).eq('event_id', eventId).order('id', { ascending: true })
  try {
    return await fetchAllRows(query(`${base}, holder_name, holder_email`))
  } catch (err) {
    if (!/holder_(name|email)/i.test(String(err?.message || ''))) throw err
    return fetchAllRows(query(base))
  }
}

/**
 * Personas de las entradas vigentes, una por email: { email, attendeeId, first_name, last_name, fnIds, untied }.
 * También devuelve attendee_id => email de todas las entradas (para asociar filas antiguas de notification_log).
 */
export function collectRecipients(tickets, dateIds) {
  const people = new Map()
  const attendeeEmails = new Map()
  const add = (rawEmail, attendeeId, name, fnId) => {
    const email = cleanEmail(rawEmail)
    if (!email || !isValidEmail(email)) return
    let p = people.get(email)
    if (!p) {
      p = { email, attendeeId: null, first_name: null, last_name: null, fnIds: new Set(), untied: false }
      people.set(email, p)
    }
    if (p.attendeeId == null && attendeeId != null) p.attendeeId = Number(attendeeId)
    if (!String(p.first_name ?? '').trim() && String(name?.first_name ?? '').trim()) {
      p.first_name = name.first_name
      p.last_name = name.last_name || null
    }
    if (fnId) p.fnIds.add(fnId)
    else p.untied = true
  }
  for (const ea of tickets || []) {
    const a = one(ea.attendees)
    const order = one(ea.event_orders)
    if (a?.id != null && cleanEmail(a.email)) attendeeEmails.set(String(a.id), cleanEmail(a.email))
    if (!isLiveTicketStatus(ea.status)) continue
    const fnRaw = one(ea.event_tickets)?.event_date_id ?? null
    const fnId = fnRaw != null && dateIds.has(String(fnRaw)) ? String(fnRaw) : null
    // Asistente de este QR con correo propio: su nombre, no el de quien compró
    if (ea.holder_email) {
      const [first, ...rest] = String(ea.holder_name ?? '').trim().split(/\s+/)
      add(ea.holder_email, null, { first_name: first || null, last_name: rest.join(' ') || null }, fnId)
    }
    add(a?.email, a?.id ?? ea.attendee_id, holderName(a, order), fnId)
    if (order?.buyer_email) add(order.buyer_email, order.attendee_id, { first_name: order.buyer_first_name, last_name: order.buyer_last_name }, fnId)
  }
  return { people, attendeeEmails }
}

/** Emails dados de baja de la productora (solo los consultados), tolerando la tabla ausente. */
async function loadOrgOptouts(supabase, organizationId, emails) {
  const out = new Set()
  const list = [...emails]
  for (let i = 0; i < list.length; i += 100) {
    const { data, error } = await supabase.from(OPTOUTS_TABLE).select('email').eq('organization_id', organizationId).in('email', list.slice(i, i + 100))
    if (error) {
      if (isMissingTable(error)) return out
      throw error
    }
    for (const r of data || []) out.add(cleanEmail(r.email))
  }
  return out
}

async function loadReviewedEmails(supabase, eventId) {
  try {
    const rows = await fetchAllRows(() => supabase.from(REVIEWS_TABLE).select('id, email').eq('event_id', eventId).order('id', { ascending: true }))
    return new Set(rows.map((r) => cleanEmail(r.email)))
  } catch (err) {
    if (/does not exist|could not find the table/i.test(String(err?.message || ''))) return new Set()
    throw err
  }
}

/**
 * Revisa un evento y manda los correos que correspondan (1º, 2º o 3º).
 * @returns {Promise<{ sent: number, failed: number, reminders: number } | null>} null si no había nada que mandar
 */
async function processEvent(supabase, event, { dates, firstDueIds, includeUntied, now, sendEmail }) {
  const settings = event.settings
  const dateIds = new Set(dates.map((d) => String(d.id)))
  const { rows: logRows, hasEmailColumn } = await loadRequestLog(supabase, event.id)
  // Sin primeros correos por mandar y sin recordatorios vencidos: no hace falta leer las entradas
  if (!firstDueIds.size && !includeUntied && ![...summarizeReviewRequestLog(logRows).values()].some((s) => reminderDue(s, now))) return null

  const tickets = await loadTickets(supabase, event.id)
  const { people, attendeeEmails } = collectRecipients(tickets, dateIds)
  if (!people.size) return null
  const log = summarizeReviewRequestLog(logRows, attendeeEmails)
  const reviewed = await loadReviewedEmails(supabase, event.id)

  // Paso que le toca a cada persona ahora
  const byStep = new Map()
  const reminderEmails = []
  for (const p of people.values()) {
    if (reviewed.has(p.email)) continue
    if (!hasEmailColumn && p.attendeeId == null) continue
    const state = log.get(p.email)
    if (state?.optedOut) continue
    const already = state?.count || 0
    let step = 0
    if (already === 0) {
      if ([...p.fnIds].some((id) => firstDueIds.has(id)) || (p.untied && includeUntied)) step = 1
    } else if (reminderDue(state, now)) {
      step = already + 1
      reminderEmails.push(p.email)
    }
    if (!step) continue
    if (!byStep.has(step)) byStep.set(step, [])
    byStep.get(step).push(p)
  }

  // Los recordatorios no van a quien se dio de baja de la productora
  if (reminderEmails.length) {
    const optedOut = await loadOrgOptouts(supabase, event.organization_id, reminderEmails)
    for (const [step, list] of byStep) {
      if (step === 1 || !optedOut.size) continue
      const kept = list.filter((p) => !optedOut.has(p.email))
      if (kept.length) byStep.set(step, kept)
      else byStep.delete(step)
    }
  }
  if (!byStep.size) return null

  const { data: org } = await supabase.from('organizations').select('public_name, email').eq('id', event.organization_id).maybeSingle()
  const replyTo = org?.email && isValidEmail(org.email) ? org.email : LEGAL.supportEmail
  let sent = 0
  let failed = 0
  let reminders = 0

  for (const step of [...byStep.keys()].sort((a, b) => a - b)) {
    const recipients = byStep.get(step)
    const { subject, html, text } = await renderReviewRequestEmail({
      eventName: event.name,
      organizerName: org?.public_name || '',
      rewardLabel: rewardLabel(settings.reward),
      step,
    })
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE)
      const recipientVariables = {}
      const to = []
      for (const r of batch) {
        const token = signReviewToken({ eventId: event.id, email: r.email }, { now })
        const optout = signReviewReminderOptoutToken({ eventId: event.id, email: r.email })
        if (!token || !optout) throw new Error('falta el secreto de firma de reseñas (REVIEW_TOKEN_SECRET)')
        const links = reviewLinks(event.slug, token)
        const unsub = reviewOptoutLinks(optout)
        const name = greetingName(r.first_name, r.last_name)
        const vars = {
          name: { html: escapeHtml(name), text: name },
          review_url: { html: escapeHtml(links.review), text: links.review },
          unsubscribe_url: { html: escapeHtml(unsub.page), text: unsub.page },
          unsubscribe_one_click: { html: escapeHtml(unsub.oneClick), text: unsub.oneClick },
        }
        links.stars.forEach((url, n) => (vars[`star${n + 1}`] = { html: escapeHtml(url), text: url }))
        recipientVariables[r.email] = vars
        to.push(formatRecipient(`${r.first_name || ''} ${r.last_name || ''}`, r.email))
      }
      // La clave depende del paso y de los destinatarios: un reintento del mismo lote no duplica, uno distinto no choca
      const key = createHash('sha256').update(batch.map((r) => r.email).join(',')).digest('hex').slice(0, 24)
      try {
        await sendEmail({
          to,
          subject,
          html,
          text,
          replyTo,
          recipientVariables,
          headers: { 'List-Unsubscribe': '<%recipient.unsubscribe_one_click%>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
          tags: ['review-request', `review-step-${step}`],
          idempotencyKey: `review-${event.id}-s${step}-${key}`,
        })
        sent += batch.length
        if (step > 1) reminders += batch.length
        const rows = batch.map((r) => ({
          event_id: event.id,
          attendee_id: r.attendeeId ?? null,
          ...(hasEmailColumn ? { email: r.email } : {}),
          type: REVIEW_REQUEST_TYPE,
          channel: 'email',
          status: 'sent',
        }))
        const { error: insError } = await supabase.from('notification_log').insert(rows)
        if (insError) console.warn('notification_log (reseñas):', insError.message)
      } catch (err) {
        failed += batch.length
        console.error(`send-review-requests: lote del evento ${event.id} (correo ${step}) falló:`, err?.message)
      }
    }
  }
  return { sent, failed, reminders }
}

/**
 * Envía los correos de reseña que correspondan. Nunca lanza por un evento: lo registra y sigue con el resto.
 * Primero los eventos con primeros correos y después los recordatorios; si se acaba el tiempo (las funciones
 * programadas mueren a los 30 s), lo pendiente sale en la próxima hora (`partial: true`).
 * @returns {Promise<{ events: number, sent: number, failed: number, reminders: number, partial?: boolean, skipped?: string }>}
 */
export async function sendReviewRequests(supabase, { now = new Date(), sendEmail = defaultSendEmail, budgetMs = TIME_BUDGET_MS } = {}) {
  // De noche no sale nada (ni lo atrasado): espera a las 10:00
  if (!isReviewSendTime(now)) return { events: 0, sent: 0, failed: 0, reminders: 0, skipped: 'fuera de horario (10:00-23:00)' }
  const startedAt = Date.now()

  const events = await loadEligibleEvents(supabase, await findCandidateEvents(supabase, now))
  const allDates = await loadIn(supabase, 'event_dates', 'id, event_id, date, start_time, end_time', 'event_id', events.map((e) => e.id))
  const datesByEvent = new Map()
  for (const d of allDates) {
    if (!datesByEvent.has(String(d.event_id))) datesByEvent.set(String(d.event_id), [])
    datesByEvent.get(String(d.event_id)).push(d)
  }
  const work = events.map((event) => {
    const dates = datesByEvent.get(String(event.id)) || []
    return { event, dates, ...firstDueOf(event, dates, now) }
  })
  // Primeros correos antes que recordatorios
  work.sort((a, b) => Number(b.firstDueIds.size > 0 || b.includeUntied) - Number(a.firstDueIds.size > 0 || a.includeUntied))

  const total = { events: 0, sent: 0, failed: 0, reminders: 0 }
  for (const item of work) {
    if (Date.now() - startedAt > budgetMs) {
      total.partial = true
      break
    }
    try {
      const result = await processEvent(supabase, item.event, { ...item, now, sendEmail })
      if (!result) continue
      total.events += 1
      total.sent += result.sent
      total.failed += result.failed
      total.reminders += result.reminders
    } catch (err) {
      console.error(`send-review-requests: evento ${item.event.id}:`, err?.message || err)
    }
  }
  return total
}
