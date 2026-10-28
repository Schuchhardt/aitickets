// Dirección que solo ven quienes compran (events.secret_location) y cuándo se revela
// (events.secret_location_reveal_hours, migración 202610300310: NULL = apenas compran; N = N horas antes de la primera
// función de la entrada).
// Mientras hay dirección privada, lo público (página, JSON-LD, meta, listados, chat del comprador, invitaciones) muestra
// el lugar sin calle ni coordenadas: nombre y comuna (publicPlace). La orden, la entrada, el correo de la entrada, el
// recordatorio y el aviso programado (send-secret-location) la muestran desde que se revela.
import { zonedDateTimeToUtc, formatDateOnlyLong, formatTimeShort } from './dates.mjs'

export const SECRET_LOCATION_MAX = 300
export const MAX_REVEAL_HOURS = 168
/** Opciones del formulario del panel (horas antes de la función). */
export const REVEAL_HOURS_OPTIONS = Object.freeze([1, 2, 3, 6, 12, 24, 48])

const MISSING_COLUMN = new Set(['42703', 'PGRST204'])

/** Dirección privada limpia (una línea, hasta 300 caracteres) o null. */
export function normalizeSecretLocation(value) {
  if (value === null || value === undefined) return null
  const s = String(value).replace(/\s+/g, ' ').trim().slice(0, SECRET_LOCATION_MAX)
  return s || null
}

/** Horas antes de la función en que se revela (1 a 168) o null (apenas compran). */
export function normalizeRevealHours(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n >= 1 && n <= MAX_REVEAL_HOURS ? n : null
}

/** "24 horas" / "1 hora". */
export const revealHoursLabel = (hours) => (Number(hours) === 1 ? '1 hora' : `${Number(hours)} horas`)

/** Inicio (Date, UTC) de una función { date, start_time } en hora de Chile. */
export const functionStart = (fn) => (fn?.date ? zonedDateTimeToUtc(String(fn.date).slice(0, 10), fn.start_time || '00:00') : null)

/**
 * Inicio de la primera función que cubre la entrada: las de sus funciones específicas o, si alguna vale para todas
 * (o no se sabe), la primera del evento. Queda revelada desde ahí: entre dos funciones no se vuelve a esconder.
 * @param {Array<{ id?: unknown, date?: string, start_time?: string | null }>} dates
 * @param {Array<number | string | null> | null} [functionIds]
 * @returns {Date | null}
 */
export function firstRelevantStart(dates, functionIds = null) {
  const list = Array.isArray(dates) ? dates : []
  const ids = Array.isArray(functionIds) ? functionIds : null
  const anyFunction = !ids || !ids.length || ids.some((id) => id === null || id === undefined)
  const wanted = anyFunction ? list : list.filter((d) => ids.some((id) => String(id) === String(d.id)))
  let first = null
  for (const d of wanted.length ? wanted : list) {
    const start = functionStart(d)
    if (start && (!first || start < first)) first = start
  }
  return first
}

/** Instante en que se revela (null = ya, apenas compran). */
export function revealAt(start, revealHours) {
  const hours = normalizeRevealHours(revealHours)
  if (!hours || !start) return null
  return new Date(new Date(start).getTime() - hours * 3_600_000)
}

/** ¿Ya se puede mostrar la dirección a quien compró? */
export function isRevealed({ revealHours, start, now = new Date() }) {
  const at = revealAt(start, revealHours)
  return !at || new Date(now).getTime() >= at.getTime()
}

/** "sábado, 7 de noviembre de 2026 a las 18:00" (hora de Chile). */
export function formatRevealMoment(instant) {
  if (!instant) return ''
  const d = new Date(instant)
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  )
  return `${formatDateOnlyLong(`${parts.year}-${parts.month}-${parts.day}`)} a las ${formatTimeShort(`${parts.hour}:${parts.minute}`)}`
}

/** Aviso para quien compró antes de que se revele. */
export function pendingRevealText(revealHours, at) {
  return `La dirección exacta te llega por correo ${revealHoursLabel(revealHours)} antes${at ? ` (${formatRevealMoment(at)})` : ''}. También aparecerá en tu orden.`
}

/**
 * Lugar de un event_location (con join a venues) sin calle ni coordenadas: nombre y comuna. Para lo público cuando
 * hay dirección privada.
 */
export function publicPlace(loc) {
  if (!loc) return ''
  const venue = (Array.isArray(loc.venues) ? loc.venues[0] : loc.venues) || {}
  const internalName = loc.name && loc.name !== 'Main' ? loc.name : ''
  const name = loc.display_name || venue.name || internalName || ''
  const city = loc.city_override || venue.city || ''
  return [name, city].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(', ')
}

/**
 * Dirección privada y horas de revelado del evento. { address: null } si no tiene. Sin la columna de horas (migración
 * pendiente) se revela apenas compran, como antes.
 */
export async function loadSecretLocation(supabase, eventId) {
  let { data, error } = await supabase.from('events').select('secret_location, secret_location_reveal_hours').eq('id', eventId).maybeSingle()
  if (error && MISSING_COLUMN.has(String(error.code || ''))) ({ data, error } = await supabase.from('events').select('secret_location').eq('id', eventId).maybeSingle())
  if (error) throw new Error(error.message)
  const address = normalizeSecretLocation(data?.secret_location)
  return { address, revealHours: address ? normalizeRevealHours(data?.secret_location_reveal_hours) : null }
}

/** true si el evento tiene dirección privada (sin leer su valor fuera del servidor). */
export async function hasSecretLocation(supabase, eventId) {
  const { count, error } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('id', eventId)
    .not('secret_location', 'is', null)
    .neq('secret_location', '')
  return !error && Number(count) > 0
}

/**
 * Guarda la dirección privada (y cuándo se revela). Solo toca lo que viene definido. Las horas van aparte: sin la
 * migración 202610300310 la dirección se guarda igual y se revela apenas compran (revealSaved: false).
 */
export async function saveSecretLocation(supabase, eventId, { address, revealHours } = {}) {
  let revealSaved = true
  if (address !== undefined) {
    const { error } = await supabase.from('events').update({ secret_location: normalizeSecretLocation(address) }).eq('id', eventId)
    if (error) throw new Error(error.message)
  }
  if (revealHours !== undefined) {
    const { error } = await supabase.from('events').update({ secret_location_reveal_hours: normalizeRevealHours(revealHours) }).eq('id', eventId)
    if (error) {
      if (!MISSING_COLUMN.has(String(error.code || ''))) throw new Error(error.message)
      revealSaved = false
    }
  }
  return { revealSaved }
}

// ==== Aviso programado: la dirección llega por correo cuando se revela (send-secret-location, cada 15 min) ====

const NOTIFICATION_TYPE = 'secret_location'
/** Si la función programada no corrió un rato, igual se manda lo que se reveló en las últimas 6 horas. */
const LOOKBACK_HOURS = 6

/** Funciones cuya dirección se reveló en las últimas 6 horas (now - 6 h, now]. Devuelve [{ event, fn, start, at }]. */
export function dueReveals(events, dates, now = new Date()) {
  const byEvent = new Map(events.map((e) => [String(e.id), e]))
  const from = now.getTime() - LOOKBACK_HOURS * 3_600_000
  const out = []
  for (const fn of dates) {
    const event = byEvent.get(String(fn.event_id))
    if (!event) continue
    const start = functionStart(fn)
    const at = revealAt(start, event.secret_location_reveal_hours)
    if (!at || at.getTime() > now.getTime() || at.getTime() <= from) continue
    out.push({ event, fn, start, at })
  }
  return out
}

/**
 * Manda la dirección a quienes tienen entradas vigentes de la función (las "para todas las funciones" solo con la
 * primera función del evento: desde ahí ya la tienen). Una vez por persona y evento (notification_log). No le escribe a
 * quien compró después de que se reveló: su correo de la entrada ya la traía.
 */
export async function sendSecretLocationReveals(supabase, { now = new Date(), sendEmail, renderEmail, siteUrl, formatRecipient, isValidEmail, escapeHtml, greetingName, holderName, fetchAllRows, formatDateOnlyLong: fmtDate, formatTimeShort: fmtTime } = {}) {
  const { data: events, error } = await supabase
    .from('events')
    .select('id, name, slug, secret_location, secret_location_reveal_hours')
    .eq('status', 'published')
    .not('secret_location', 'is', null)
    .not('secret_location_reveal_hours', 'is', null)
  if (error) {
    if (MISSING_COLUMN.has(String(error.code || ''))) return { sent: 0, events: 0 }
    throw new Error(error.message)
  }
  const withAddress = (events || []).filter((e) => normalizeSecretLocation(e.secret_location) && normalizeRevealHours(e.secret_location_reveal_hours))
  if (!withAddress.length) return { sent: 0, events: 0 }

  const { data: dates, error: datesError } = await supabase
    .from('event_dates')
    .select('id, event_id, date, start_time')
    .in('event_id', withAddress.map((e) => e.id))
  if (datesError) throw new Error(datesError.message)
  const due = dueReveals(withAddress, dates || [], now)
  let sent = 0
  const touched = new Set()

  for (const { event, fn, at } of due) {
    const eventDates = (dates || []).filter((d) => String(d.event_id) === String(event.id))
    const firstId = [...eventDates].sort((a, b) => (functionStart(a)?.getTime() || 0) - (functionStart(b)?.getTime() || 0))[0]?.id
    const { data: logged } = await supabase.from('notification_log').select('attendee_id').eq('event_id', event.id).eq('type', NOTIFICATION_TYPE)
    const already = new Set((logged || []).map((r) => r.attendee_id))
    const rows = await fetchAllRows(() =>
      supabase
        .from('event_attendees')
        .select('id, attendee_id, event_order_id, status, created_at, attendees ( id, first_name, last_name, email ), event_tickets ( event_date_id ), event_orders ( buyer_first_name, buyer_last_name )')
        .eq('event_id', event.id)
        .order('id', { ascending: true })
    )
    const recipients = []
    const seen = new Set()
    for (const ea of rows) {
      if (ea.status === 'cancelled') continue
      const fnId = ea.event_tickets?.event_date_id ?? null
      if (fnId == null ? String(fn.id) !== String(firstId) : String(fnId) !== String(fn.id)) continue
      // Compró después de que se reveló: su correo de la entrada ya traía la dirección
      if (ea.created_at && new Date(ea.created_at).getTime() >= at.getTime()) continue
      const a = ea.attendees
      const email = a?.email?.toLowerCase()
      if (!email || !isValidEmail(email) || seen.has(email) || already.has(a.id)) continue
      seen.add(email)
      already.add(a.id)
      recipients.push({ id: a.id, email, ...holderName(a, ea.event_orders), order_url: ea.event_order_id ? `${siteUrl}/order/${ea.event_order_id}` : `${siteUrl}/eventos/${encodeURIComponent(event.slug || '')}` })
    }
    if (!recipients.length) continue

    const { subject, html, text } = await renderEmail({
      eventName: event.name,
      eventDate: fmtDate(fn.date),
      startTime: fmtTime(fn.start_time),
      address: normalizeSecretLocation(event.secret_location),
    })
    const ok = []
    for (let i = 0; i < recipients.length; i += 50) {
      const batch = recipients.slice(i, i + 50)
      const vars = {}
      const to = batch.map((r) => {
        const name = greetingName(r.first_name, r.last_name)
        vars[r.email] = { name: { html: escapeHtml(name), text: name }, order_url: { html: escapeHtml(r.order_url), text: r.order_url } }
        return formatRecipient(`${r.first_name || ''} ${r.last_name || ''}`, r.email)
      })
      try {
        await sendEmail({ to, subject, html, text, recipientVariables: vars, tags: ['secret-location'] })
        ok.push(...batch)
      } catch (err) {
        console.error(`send-secret-location: lote del evento ${event.id}:`, err?.message)
      }
    }
    if (ok.length) {
      const { error: logError } = await supabase
        .from('notification_log')
        .insert(ok.map((r) => ({ event_id: event.id, attendee_id: r.id, type: NOTIFICATION_TYPE, channel: 'email', status: 'sent' })))
      if (logError) console.warn('send-secret-location: notification_log:', logError.message)
      sent += ok.length
      touched.add(String(event.id))
    }
  }
  return { sent, events: touched.size }
}
