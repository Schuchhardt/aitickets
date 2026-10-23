// Reseñas de eventos (migración 202610220100): fuente única de las reglas. La usan la función programada
// send-review-requests, las rutas /api/reviews* y /api/events/reviews, la cola de invitaciones
// (scheduled-messages.mjs), la API de productores y los componentes Vue (constantes y etiquetas).
// Sin dependencias de Node: también se importa desde el navegador. Las funciones con BD reciben el cliente de
// Supabase (service role) como parámetro.
//
// Reglas (pedido del dueño, oct 2026):
//   * 24 h después de que termina cada función se manda "¿Cómo estuvo?" a quienes tenían entradas para ella; las
//     entradas "cualquier función" (event_date_id NULL) solo después de la última función. Un correo por persona
//     y evento (notification_log type 'review_request'), nunca a quien ya calificó.
//   * Una reseña por persona (email) y evento: 1 a 5 estrellas, comentario público (página del evento) y privado
//     (solo la productora). Calificar de nuevo la actualiza.
//   * Premio opcional por calificar (events.review_settings.reward): un código de un solo uso, % de descuento en
//     cualquier evento de la misma productora, con vencimiento. Lo financia la productora (descuento sobre su
//     subtotal, igual que cualquier código), por eso es opcional y lo configura ella.
//   * Fotos: hasta MAX_PHOTOS_PER_PERSON por persona y evento; visibles al tiro salvo que la productora pida
//     revisarlas antes (moderate_photos). La productora puede ocultar comentarios y fotos.
//   * Invitaciones al próximo evento: a los asistentes de un evento terminado, sin quienes se dieron de baja de
//     esa productora, sin quienes ya tienen entradas para el evento al que se invita y sin repetir invitación.
import { zonedDateTimeToUtc } from './dates.mjs'

export const REVIEWS_TABLE = 'aitickets_event_reviews'
export const REVIEW_PHOTOS_TABLE = 'aitickets_event_review_photos'
export const OPTOUTS_TABLE = 'aitickets_org_email_optouts'

export const REVIEW_REQUEST_TYPE = 'review_request'
export const NEXT_EVENT_INVITE_TYPE = 'next_event_invite'

export const RATING_LABELS = Object.freeze({ 1: 'Malo', 2: 'Regular', 3: 'Bueno', 4: 'Muy bueno', 5: 'Excelente' })
export const PUBLIC_COMMENT_MAX = 1000
export const PRIVATE_COMMENT_MAX = 2000
export const MAX_PHOTOS_PER_PERSON = 6
/** Cuánto después del término de una función se pide la reseña, y hasta cuándo (si la función programada no corrió). */
export const REVIEW_REQUEST_DELAY_HOURS = 24
export const REVIEW_REQUEST_WINDOW_HOURS = 72
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
 * correo activado, sin premio, fotos sin moderación previa.
 * @returns {{ enabled: boolean, reward: { value: number, valid_days: number } | null, moderate_photos: boolean }}
 */
export function normalizeReviewSettings(raw) {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  let reward = null
  if (s.reward && typeof s.reward === 'object') {
    const value = clampInt(s.reward.value, REWARD_LIMITS.minValue, REWARD_LIMITS.maxValue)
    const days = clampInt(s.reward.valid_days ?? REWARD_LIMITS.defaultDays, REWARD_LIMITS.minDays, REWARD_LIMITS.maxDays)
    if (value != null && days != null) reward = { value, valid_days: days }
  }
  return { enabled: s.enabled !== false, reward, moderate_photos: s.moderate_photos === true }
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

/**
 * Funciones cuya reseña corresponde pedir ahora: terminaron hace entre DELAY y WINDOW horas.
 * @param {Array<any>} dates filas de event_dates
 * @returns {Array<any>} las mismas filas con `ends_at` (Date)
 */
export function dueReviewFunctions(dates, now = new Date(), { delayHours = REVIEW_REQUEST_DELAY_HOURS, windowHours = REVIEW_REQUEST_WINDOW_HOURS } = {}) {
  const latest = now.getTime() - delayHours * 3600_000
  const earliest = now.getTime() - windowHours * 3600_000
  return (dates || [])
    .map((fn) => ({ ...fn, ends_at: functionEndsAt(fn) }))
    .filter((fn) => fn.ends_at && fn.ends_at.getTime() <= latest && fn.ends_at.getTime() > earliest)
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

/** Foto tal como la ve el público. */
export function publicPhoto(row) {
  return {
    id: row.id,
    url: row.url,
    thumb_url: row.thumb_url || null,
    width: row.width ?? null,
    height: row.height ?? null,
    name: row.display_name || null,
  }
}

/** Email parcialmente oculto para mostrar en pantalla ("se***@gmail.com"). */
export function maskEmail(email) {
  const [user, domain] = String(email || '').split('@')
  if (!user || !domain) return ''
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(1, Math.min(6, user.length - 2)))}@${domain}`
}
