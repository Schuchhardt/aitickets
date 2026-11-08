// Reseñas de eventos (migración 202610220100): fuente única de las reglas. La usan la función programada
// send-review-requests, las rutas /api/reviews* y /api/events/reviews, la cola de invitaciones
// (scheduled-messages.mjs), la API de productores y los componentes Vue (constantes y etiquetas).
// Sin dependencias de Node: también se importa desde el navegador. Las funciones con BD reciben el cliente de
// Supabase (service role) como parámetro.
//
// Reglas (pedido del dueño, oct 2026; cadencia de 3 correos, nov 2026):
//   * "¿Cómo estuvo?" a quienes tenían entradas de cada función (titular, comprador y asistente del QR): el primero
//     4 h después del término si la función termina de día y 8 h si termina de noche, siempre entre las 10:00 y las
//     23:00 de Chile para que estén despiertos (firstReviewRequestAt); dos recordatorios, 2 y 5 días después del
//     primero (nextReviewReminderAt). Las entradas "cualquier función" (event_date_id NULL) solo después de la
//     última función. Máximo REVIEW_REQUEST_STEPS correos por persona y evento (notification_log type
//     'review_request'), nunca a quien ya calificó ni a quien pidió no recibir más recordatorios.
//   * Una reseña por persona (email) y evento: 1 a 5 estrellas, comentario público (página del evento) y privado
//     (solo la productora). Calificar de nuevo la actualiza.
//   * Premio opcional por calificar (events.review_settings.reward): un código de un solo uso, % de descuento en
//     cualquier evento de la misma productora, con vencimiento. Lo financia la productora (descuento sobre su
//     subtotal, igual que cualquier código), por eso es opcional y lo configura ella.
//   * Fotos: hasta MAX_PHOTOS_PER_PERSON por persona y evento; visibles al tiro salvo que la productora pida
//     revisarlas antes (moderate_photos). La productora puede ocultar comentarios y fotos.
//   * Videos (nov 2026): hasta MAX_VIDEOS_PER_PERSON por persona y evento, de ATTENDEE_VIDEO_MAX_BYTES y
//     ATTENDEE_VIDEO_MAX_SECONDS como máximo. Misma tabla, estados y moderación que las fotos (media_type 'video').
//   * Invitaciones al próximo evento: a los asistentes de un evento terminado, sin quienes se dieron de baja de
//     esa productora, sin quienes ya tienen entradas para el evento al que se invita y sin repetir invitación.
import { zonedDateTimeToUtc, addDays, EVENT_TIMEZONE } from './dates.mjs'

export const REVIEWS_TABLE = 'aitickets_event_reviews'
export const REVIEW_PHOTOS_TABLE = 'aitickets_event_review_photos'
export const OPTOUTS_TABLE = 'aitickets_org_email_optouts'

export const REVIEW_REQUEST_TYPE = 'review_request'
/** notification_log: la persona pidió no recibir más recordatorios de reseña de ESE evento (enlace del correo). */
export const REVIEW_REQUEST_OPTOUT_TYPE = 'review_request_optout'
export const NEXT_EVENT_INVITE_TYPE = 'next_event_invite'

export const RATING_LABELS = Object.freeze({ 1: 'Malo', 2: 'Regular', 3: 'Bueno', 4: 'Muy bueno', 5: 'Excelente' })
export const PUBLIC_COMMENT_MAX = 1000
export const PRIVATE_COMMENT_MAX = 2000
export const MAX_PHOTOS_PER_PERSON = 6
/** Videos de los asistentes: por persona y evento, peso (igual al límite del bucket) y duración (la valida el navegador). */
export const MAX_VIDEOS_PER_PERSON = 2
export const ATTENDEE_VIDEO_MAX_BYTES = 50 * 1024 * 1024
export const ATTENDEE_VIDEO_MAX_SECONDS = 60
/** Tipo de una fila de la galería de asistentes: 'photo' (también filas anteriores a la columna) o 'video'. */
export const mediaTypeOf = (row) => (row?.media_type === 'video' ? 'video' : 'photo')
// ---- Cadencia del correo "¿Cómo estuvo?" (hora de Chile) ----
/** Correos de reseña por persona y evento: el primero y dos recordatorios. */
export const REVIEW_REQUEST_STEPS = 3
/** Primer correo: 4 h después del término si la función termina de día; 8 h si termina de noche (se van a dormir). */
export const REVIEW_FIRST_DELAY_HOURS = Object.freeze({ day: 4, night: 8 })
/** "Termina de noche": desde las 21:00 hasta antes de las 08:00. */
export const REVIEW_NIGHT_HOURS = Object.freeze({ from: 21, until: 8 })
/**
 * Ventana de envío [from, until): ningún correo de reseña sale fuera de ella. Un correo que vencería antes se corre a
 * las 10:00 de ese día y uno que vencería después, a las 10:00 del día siguiente. La función programada corre a los
 * :20, así que en la práctica salen entre las 10:20 y las 22:20.
 */
export const REVIEW_SEND_HOURS = Object.freeze({ from: 10, until: 23 })
/** Recordatorios: el 2º, 2 días después del 1º; el 3º (último), 3 días después del 2º. */
export const REVIEW_REMINDER_GAP_HOURS = Object.freeze([48, 72])
/** El primer correo se manda hasta 72 h después del término (cubre ejecuciones perdidas de la función programada). */
export const REVIEW_REQUEST_WINDOW_HOURS = 72
/** Ningún recordatorio más de 10 días después del primer correo. */
export const REVIEW_REMINDER_MAX_DAYS = 10
/** Duración supuesta de una función sin hora de término (misma regla que la página del evento). */
export const DEFAULT_FUNCTION_HOURS = 3
export const REVIEW_TOKEN_TTL_DAYS = 90
/** Reseñas públicas que trae la página del evento (el resto con "Ver más"). */
export const PUBLIC_REVIEWS_PAGE = 12
export const PUBLIC_PHOTOS_MAX = 120

export const REWARD_LIMITS = Object.freeze({ minValue: 5, maxValue: 50, minDays: 7, maxDays: 365, defaultValue: 10, defaultDays: 60 })
export const REWARD_CODE_PREFIX = 'GRACIAS-'

export const INVITE_AUDIENCES = Object.freeze({
  all: 'Todos los asistentes',
  checked_in: 'Solo quienes ingresaron (check-in)',
  reviewers: 'Solo quienes calificaron',
  promoters: 'Solo quienes calificaron con 4 o 5 estrellas',
})
/** Invitaciones (envíos) por productora cada 24 h: evita que los asistentes reciban spam. */
export const MAX_INVITATIONS_PER_ORG_PER_DAY = 5

const clampInt = (value, min, max) => {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return null
  return Math.min(max, Math.max(min, n))
}

/**
 * Configuración de reseñas de un evento (events.review_settings). NULL o basura => valores por defecto:
 * correo activado, sin premio, fotos sin moderación previa y reseñas en la página solo cuando el evento terminó.
 * show_while_on_sale: la página muestra las reseñas de las funciones pasadas mientras quedan funciones a la venta
 * (una obra en cartelera, un taller con fechas).
 * @returns {{ enabled: boolean, reward: { value: number, valid_days: number } | null, moderate_photos: boolean, show_while_on_sale: boolean }}
 */
export function normalizeReviewSettings(raw) {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  let reward = null
  if (s.reward && typeof s.reward === 'object') {
    const value = clampInt(s.reward.value, REWARD_LIMITS.minValue, REWARD_LIMITS.maxValue)
    const days = clampInt(s.reward.valid_days ?? REWARD_LIMITS.defaultDays, REWARD_LIMITS.minDays, REWARD_LIMITS.maxDays)
    if (value != null && days != null) reward = { value, valid_days: days }
  }
  return { enabled: s.enabled !== false, reward, moderate_photos: s.moderate_photos === true, show_while_on_sale: s.show_while_on_sale === true }
}

/** Estrellas válidas (entero 1-5) o null. */
export function normalizeRating(value) {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null
}

/** Comentario: sin caracteres de control, espacios recortados, máximo 2 saltos seguidos, cortado a `max`. Vacío => null. */
export function normalizeComment(value, max) {
  if (typeof value !== 'string') return null
  const clean = value
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max)
    .trim()
  return clean || null
}

/** Nombre público de quien opina: nombre de pila + inicial del apellido ("María J."). Sin nombre => null. */
export function reviewDisplayName(firstName, lastName) {
  const first = String(firstName ?? '').trim().split(/\s+/)[0] || ''
  if (!first) return null
  const initial = String(lastName ?? '').trim().charAt(0)
  return `${first}${initial ? ` ${initial.toLocaleUpperCase('es-CL')}.` : ''}`.slice(0, 80)
}

/**
 * Resumen de calificaciones: { count, average (1 decimal, null sin reseñas), distribution: {1..5: n} }.
 * @param {Array<{ rating: number }>} rows
 */
export function summarizeRatings(rows) {
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  let sum = 0
  let count = 0
  for (const row of rows || []) {
    const r = normalizeRating(row?.rating)
    if (!r) continue
    distribution[r] += 1
    sum += r
    count += 1
  }
  return { count, average: count ? Math.round((sum / count) * 10) / 10 : null, distribution }
}

/**
 * Instante en que termina una función (fila de event_dates, hora local de Chile): end_time o, sin ella,
 * start_time + DEFAULT_FUNCTION_HOURS. Si end_time <= start_time termina después de medianoche. null sin fecha.
 * @param {{ date: string, start_time?: string | null, end_time?: string | null }} fn
 */
export function functionEndsAt(fn) {
  const date = String(fn?.date || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const start = zonedDateTimeToUtc(date, fn.start_time || '00:00')
  if (!start) return null
  if (!fn.end_time) return new Date(start.getTime() + DEFAULT_FUNCTION_HOURS * 3600_000)
  let end = zonedDateTimeToUtc(date, fn.end_time)
  if (!end) return new Date(start.getTime() + DEFAULT_FUNCTION_HOURS * 3600_000)
  if (end <= start) end = new Date(end.getTime() + 24 * 3600_000)
  return end
}

/** Instante en que empieza una función, o null. */
export function functionStartsAt(fn) {
  const date = String(fn?.date || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  return zonedDateTimeToUtc(date, fn.start_time || '00:00')
}

const toDate = (value) => {
  if (value == null || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}
const pad2 = (n) => String(n).padStart(2, '0')

/** Fecha (YYYY-MM-DD) y minutos desde la medianoche de un instante, en hora de Chile. */
export function chileClock(instant) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: EVENT_TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(toDate(instant) || new Date(NaN))
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) }
}

/** ¿Es hora de mandar correos de reseña? (dentro de REVIEW_SEND_HOURS) */
export function isReviewSendTime(now = new Date()) {
  const { minutes } = chileClock(now)
  return minutes >= REVIEW_SEND_HOURS.from * 60 && minutes < REVIEW_SEND_HOURS.until * 60
}

/** Corre un instante a la ventana de envío: antes de las 10:00 => 10:00 de ese día; desde las 23:00 => 10:00 del siguiente. */
export function clampToReviewSendWindow(instant) {
  const at = toDate(instant)
  if (!at) return null
  const { date, minutes } = chileClock(at)
  const opening = `${pad2(REVIEW_SEND_HOURS.from)}:00`
  if (minutes < REVIEW_SEND_HOURS.from * 60) return zonedDateTimeToUtc(date, opening)
  if (minutes >= REVIEW_SEND_HOURS.until * 60) return zonedDateTimeToUtc(addDays(date, 1), opening)
  return at
}

/** ¿La función termina de noche (REVIEW_NIGHT_HOURS)? Entonces la gente se va a dormir y el primer correo espera más. */
export function endsAtNight(endsAt) {
  const { minutes } = chileClock(endsAt)
  return minutes >= REVIEW_NIGHT_HOURS.from * 60 || minutes < REVIEW_NIGHT_HOURS.until * 60
}

/**
 * Cuándo sale el primer correo de reseña de una función que termina en `endsAt`: 4 h después si termina de día,
 * 8 h si termina de noche, corrido a la ventana de envío para que estén despiertos. Ejemplos (hora de Chile):
 * termina 13:00 => 17:00 · 18:00 => 22:00 · 20:00 => 10:00 del día siguiente · 23:00 => 10:00 · 02:00 => 10:00 ·
 * 05:00 => 13:00.
 */
export function firstReviewRequestAt(endsAt) {
  const end = toDate(endsAt)
  if (!end) return null
  const delay = endsAtNight(end) ? REVIEW_FIRST_DELAY_HOURS.night : REVIEW_FIRST_DELAY_HOURS.day
  return clampToReviewSendWindow(new Date(end.getTime() + delay * 3600_000))
}

/**
 * Cuándo corresponde el siguiente correo a quien ya recibió `sentCount` (el último en `lastSentAt`); null si ya
 * recibió los REVIEW_REQUEST_STEPS o no hay fecha.
 */
export function nextReviewReminderAt(sentCount, lastSentAt) {
  const gap = REVIEW_REMINDER_GAP_HOURS[Number(sentCount) - 1]
  const last = toDate(lastSentAt)
  if (!gap || !last) return null
  return clampToReviewSendWindow(new Date(last.getTime() + gap * 3600_000))
}

/**
 * Instante de término para la reseña: la función (event_dates) o, en eventos antiguos sin funciones, events.end_date.
 * @param {{ date?: string, start_time?: string | null, end_time?: string | null, end_date?: string | null }} fn
 */
const endOf = (fn) => (fn?.date ? functionEndsAt(fn) : toDate(fn?.end_date))

/**
 * Funciones cuyo PRIMER correo de reseña corresponde ahora: ya llegó su firstReviewRequestAt y terminaron hace menos
 * de REVIEW_REQUEST_WINDOW_HOURS (si la función programada estuvo caída, no se piden reseñas de eventos viejos).
 * @param {Array<any>} dates filas de event_dates (o { id, end_date } para eventos sin funciones)
 * @returns {Array<any>} las mismas filas con `ends_at` y `first_request_at` (Date)
 */
export function dueReviewFunctions(dates, now = new Date(), { windowHours = REVIEW_REQUEST_WINDOW_HOURS } = {}) {
  const earliest = now.getTime() - windowHours * 3600_000
  return (dates || [])
    .map((fn) => {
      const ends_at = endOf(fn)
      return { ...fn, ends_at, first_request_at: firstReviewRequestAt(ends_at) }
    })
    .filter((fn) => fn.ends_at && fn.first_request_at && fn.first_request_at.getTime() <= now.getTime() && fn.ends_at.getTime() > earliest)
}

/** La función que termina más tarde (la "última" del evento). */
export function lastFunctionOf(dates) {
  let last = null
  let lastEnd = -Infinity
  for (const fn of dates || []) {
    const end = functionEndsAt(fn)?.getTime()
    if (end != null && end > lastEnd) {
      last = fn
      lastEnd = end
    }
  }
  return last
}

/** Se puede reseñar cuando ya empezó alguna función del evento (o, sin funciones, cuando pasó start_date). */
export function reviewsOpen(event, dates, now = new Date()) {
  const starts = (dates || []).map(functionStartsAt).filter(Boolean)
  if (starts.length) return starts.some((s) => s.getTime() <= now.getTime())
  const start = event?.start_date ? new Date(event.start_date) : null
  return Boolean(start && !Number.isNaN(start.getTime()) && start.getTime() <= now.getTime())
}

/**
 * Código del premio: GRACIAS- + 6 caracteres sin ambiguos (sin 0/O, 1/I/L). Cabe en DISCOUNT_CODE_RE.
 * @param {(n: number) => number[]} [randomInts] solo para tests
 */
export function generateRewardCode(randomInts) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let values
  if (randomInts) values = randomInts(6)
  else {
    const buf = new Uint32Array(6)
    globalThis.crypto.getRandomValues(buf)
    values = Array.from(buf)
  }
  return REWARD_CODE_PREFIX + values.map((v) => alphabet[Math.abs(Number(v) || 0) % alphabet.length]).join('')
}

/** "10% de descuento" */
export const rewardLabel = (reward) => (reward ? `${reward.value}% de descuento` : '')

/**
 * Referencia de una compra para validar la asistencia: link o id de la orden (/order/<uuid>), link o id de la
 * entrada (/ticket/<uuid>) o el código del QR (64 hex).
 * @returns {{ kind: 'order' | 'ticket' | 'uuid', value: string } | { kind: 'qr', value: string } | null}
 */
export function parseAttendanceReference(input) {
  const raw = String(input ?? '').trim().slice(0, 500)
  if (!raw) return null
  const qr = /\b([0-9a-f]{64})\b/i.exec(raw)
  if (qr) return { kind: 'qr', value: qr[1].toLowerCase() }
  const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(raw)
  if (!uuid) return null
  const value = uuid[1].toLowerCase()
  if (/\/order\//i.test(raw)) return { kind: 'order', value }
  if (/\/ticket\//i.test(raw)) return { kind: 'ticket', value }
  return { kind: 'uuid', value }
}

/** Estados de event_attendees que cuentan como entrada vigente (NULL = activa, entradas antiguas). */
export const isLiveTicketStatus = (status) => {
  const s = status ?? 'active'
  return s === 'active' || s === 'validated'
}

/** Escapa %, _ y \ para un ilike exacto. */
export const escapeLike = (value) => String(value ?? '').replace(/[\\%_]/g, (c) => `\\${c}`)

/**
 * Asistencia de un email a un evento: titular de una entrada vigente o comprador de una orden pagada con
 * entradas vigentes. Devuelve el attendee (para nombre y notification_log) o null.
 * @returns {Promise<{ attendeeId: number | null, email: string, first_name: string | null, last_name: string | null, checkedIn: boolean } | null>}
 */
export async function findAttendanceByEmail(supabase, eventId, email) {
  const target = String(email || '').trim().toLowerCase()
  if (!target) return null
  const { data: people, error } = await supabase.from('attendees').select('id, first_name, last_name, email').ilike('email', escapeLike(target)).limit(20)
  if (error) throw error
  const ids = (people || []).map((p) => p.id)
  if (ids.length) {
    const { data: tickets, error: tError } = await supabase
      .from('event_attendees')
      .select('id, attendee_id, status, validated_at, event_orders ( buyer_first_name, buyer_last_name )')
      .eq('event_id', eventId)
      .in('attendee_id', ids)
      .limit(200)
    if (tError) throw tError
    const live = (tickets || []).filter((t) => isLiveTicketStatus(t.status))
    if (live.length) {
      const person = people.find((p) => String(p.id) === String(live[0].attendee_id)) || people[0]
      const order = Array.isArray(live[0].event_orders) ? live[0].event_orders[0] : live[0].event_orders
      const named = String(order?.buyer_first_name ?? '').trim() ? { first_name: order.buyer_first_name, last_name: order.buyer_last_name || null } : { first_name: person.first_name || null, last_name: person.last_name || null }
      return { attendeeId: Number(person.id), email: target, ...named, checkedIn: live.some((t) => t.status === 'validated' || t.validated_at) }
    }
  }
  // Comprador que compró para otros (las entradas quedaron a nombre de otro email)
  const { data: orders, error: oError } = await supabase
    .from('event_orders')
    .select('id, attendee_id, status, buyer_first_name, buyer_last_name')
    .eq('event_id', eventId)
    .eq('status', 'paid')
    .ilike('buyer_email', escapeLike(target))
    .limit(20)
  if (oError) throw oError
  for (const order of orders || []) {
    const { data: tickets, error: tError } = await supabase.from('event_attendees').select('id, status, validated_at').eq('event_order_id', order.id).limit(200)
    if (tError) throw tError
    const live = (tickets || []).filter((t) => isLiveTicketStatus(t.status))
    if (live.length) {
      return {
        attendeeId: order.attendee_id != null ? Number(order.attendee_id) : null,
        email: target,
        first_name: order.buyer_first_name || null,
        last_name: order.buyer_last_name || null,
        checkedIn: live.some((t) => t.status === 'validated' || t.validated_at),
      }
    }
  }
  // Asistente de un QR con correo propio (event_attendees.holder_email, migración 202610300100): recibe su entrada
  // y los correos de reseña, así que también puede calificar. No tiene fila en attendees (attendeeId null).
  const { data: held, error: hError } = await supabase
    .from('event_attendees')
    .select('id, status, validated_at, holder_name')
    .eq('event_id', eventId)
    .ilike('holder_email', escapeLike(target))
    .limit(200)
  if (hError && !['42703', 'PGRST204'].includes(String(hError.code || ''))) throw hError
  const liveHeld = (held || []).filter((t) => isLiveTicketStatus(t.status))
  if (liveHeld.length) {
    const named = liveHeld.find((t) => String(t.holder_name ?? '').trim())
    const [first, ...rest] = String(named?.holder_name ?? '').trim().split(/\s+/)
    return {
      attendeeId: null,
      email: target,
      first_name: first || null,
      last_name: rest.join(' ') || null,
      checkedIn: liveHeld.some((t) => t.status === 'validated' || t.validated_at),
    }
  }
  return null
}

/**
 * Asistencia a partir de una orden, una entrada o un QR (parseAttendanceReference). El link de la orden y el de
 * la entrada ya dan acceso a las entradas con QR, así que también sirven para calificar.
 * @returns {Promise<{ attendeeId: number | null, email: string, first_name: string | null, last_name: string | null, checkedIn: boolean, via: 'order' | 'ticket' } | null>}
 */
export async function findAttendanceByReference(supabase, eventId, ref) {
  if (!ref) return null
  const ticketCols = 'id, event_id, status, validated_at, event_order_id, attendee_id, attendees ( id, first_name, last_name, email ), event_orders ( buyer_first_name, buyer_last_name, buyer_email )'
  const fromTicket = (t, via) => {
    if (!t || String(t.event_id) !== String(eventId) || !isLiveTicketStatus(t.status)) return null
    const person = Array.isArray(t.attendees) ? t.attendees[0] : t.attendees
    const order = Array.isArray(t.event_orders) ? t.event_orders[0] : t.event_orders
    const email = String(person?.email || order?.buyer_email || '').trim().toLowerCase()
    if (!email) return null
    const named = String(order?.buyer_first_name ?? '').trim() && String(order?.buyer_email || '').toLowerCase() === email
      ? { first_name: order.buyer_first_name, last_name: order.buyer_last_name || null }
      : { first_name: person?.first_name || null, last_name: person?.last_name || null }
    return { attendeeId: person?.id != null ? Number(person.id) : t.attendee_id != null ? Number(t.attendee_id) : null, email, ...named, checkedIn: t.status === 'validated' || Boolean(t.validated_at), via }
  }

  if (ref.kind === 'qr') {
    const { data, error } = await supabase.from('event_attendees').select(ticketCols).eq('event_id', eventId).eq('qr_code', ref.value).maybeSingle()
    if (error) throw error
    return fromTicket(data, 'ticket')
  }

  if (ref.kind === 'order' || ref.kind === 'uuid') {
    const { data: order, error } = await supabase
      .from('event_orders')
      .select('id, event_id, status, attendee_id, buyer_first_name, buyer_last_name, buyer_email')
      .eq('id', ref.value)
      .maybeSingle()
    if (error) throw error
    if (order && String(order.event_id) === String(eventId) && order.status === 'paid') {
      const { data: tickets, error: tError } = await supabase.from('event_attendees').select('id, status, validated_at').eq('event_order_id', order.id).limit(200)
      if (tError) throw tError
      const live = (tickets || []).filter((t) => isLiveTicketStatus(t.status))
      const email = String(order.buyer_email || '').trim().toLowerCase()
      if (live.length && email) {
        return {
          attendeeId: order.attendee_id != null ? Number(order.attendee_id) : null,
          email,
          first_name: order.buyer_first_name || null,
          last_name: order.buyer_last_name || null,
          checkedIn: live.some((t) => t.status === 'validated' || t.validated_at),
          via: 'order',
        }
      }
      if (ref.kind === 'order') return null
    } else if (ref.kind === 'order') return null
  }

  const { data: ticket, error } = await supabase.from('event_attendees').select(ticketCols).eq('id', ref.value).maybeSingle()
  if (error) throw error
  return fromTicket(ticket, 'ticket')
}

/**
 * Filtra los destinatarios de una invitación al próximo evento.
 * @param {Array<{ id: number, email: string, checkedIn?: boolean }>} holders titulares del evento terminado (un registro por email)
 * @param {{ audience?: string, ratings?: Map<string, number>, optedOut?: Set<string>, alreadyInvited?: Set<string>, targetHolders?: Set<string> }} opts
 *   ratings: email => estrellas; optedOut / targetHolders: emails; alreadyInvited: attendee ids (string) ya invitados
 */
export function filterInviteRecipients(holders, { audience = 'all', ratings = new Map(), optedOut = new Set(), alreadyInvited = new Set(), targetHolders = new Set() } = {}) {
  return (holders || []).filter((h) => {
    const email = String(h?.email || '').toLowerCase()
    if (!email || optedOut.has(email) || targetHolders.has(email)) return false
    if (h.id != null && alreadyInvited.has(String(h.id))) return false
    if (audience === 'checked_in') return Boolean(h.checkedIn)
    if (audience === 'reviewers') return ratings.has(email)
    if (audience === 'promoters') return (ratings.get(email) || 0) >= 4
    return true
  })
}

/** Reseña tal como la ve el público (sin email ni comentario privado). */
export function publicReview(row) {
  return {
    id: row.id,
    name: row.display_name || 'Asistente',
    rating: Number(row.rating) || 0,
    comment: row.public_comment || null,
    created_at: row.created_at,
  }
}

/** Foto o video tal como lo ve el público (en un video, url es el archivo y thumb_url su póster). */
export function publicPhoto(row) {
  return {
    id: row.id,
    media_type: mediaTypeOf(row),
    url: row.url,
    thumb_url: row.thumb_url || null,
    width: row.width ?? null,
    height: row.height ?? null,
    duration: row.duration ?? null,
    name: row.display_name || null,
  }
}

/** Email parcialmente oculto para mostrar en pantalla ("se***@gmail.com"). */
export function maskEmail(email) {
  const [user, domain] = String(email || '').split('@')
  if (!user || !domain) return ''
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(1, Math.min(6, user.length - 2)))}@${domain}`
}
