// Tokens firmados de reseñas e invitaciones: base64url(JSON) + '.' + base64url(HMAC-SHA256). Solo servidor.
//
// - Reseña:   {p:'rv', e:eventId, m:email, v:vía, x:exp}. Da derecho a calificar y subir fotos de ESE evento como ESE
//   email. Llega en el correo de 24 h, en el correo "tu link para calificar" o al validar una orden/entrada en la
//   página del evento. Vence a los REVIEW_TOKEN_TTL_DAYS días. v: cómo se validó ('o' orden, 't' entrada,
//   sin v = correo).
// - Baja de invitaciones: {p:'io', o:organizationId, m:email}, sin vencimiento (el enlace de baja debe seguir
//   funcionando siempre, Ley 19.496 art. 28 B).
// - Baja del reporte semanal a productores: {p:'wr', u:userId} (public.users.id), sin vencimiento. Sirve para darse de
//   baja y para volver a suscribirse desde la misma página.
// Clave: REVIEW_TOKEN_SECRET o, si no existe, derivada de EMAIL_VERIFY_SECRET / INTERNAL_API_SECRET / service role
// con una etiqueta propia (un token de otro tipo nunca sirve aquí). Sin ninguna, sign* devuelve '' y verify* null.
import { tokenSigner } from './signed-token.mjs'
import { REVIEW_TOKEN_TTL_DAYS } from './reviews.mjs'

const { sign, verify } = tokenSigner('aitickets-review-token', ['REVIEW_TOKEN_SECRET', 'EMAIL_VERIFY_SECRET', 'INTERNAL_API_SECRET', 'SUPABASE_SERVICE_ROLE_KEY'])

const cleanEmail = (email) => String(email || '').trim().toLowerCase()
const VIA_CODES = { order: 'o', ticket: 't' }
const VIA_NAMES = { o: 'order', t: 'ticket' }

/**
 * Token de reseña de un evento para un email. '' si falta el secreto o los datos.
 * @param {{ eventId: number, email: string, via?: 'email_link' | 'order' | 'ticket' }} p
 */
export function signReviewToken({ eventId, email, via }, { ttlDays = REVIEW_TOKEN_TTL_DAYS, now = new Date() } = {}) {
  const id = Number(eventId)
  const m = cleanEmail(email)
  if (!Number.isSafeInteger(id) || id <= 0 || !m) return ''
  return sign({ p: 'rv', e: id, m, ...(VIA_CODES[via] ? { v: VIA_CODES[via] } : {}), x: Math.floor(now.getTime() / 1000) + Math.round(ttlDays * 86400) })
}

/** @returns {{ eventId: number, email: string, via: 'email_link' | 'order' | 'ticket' } | null} */
export function verifyReviewToken(token, { now = new Date() } = {}) {
  const payload = verify(token, 'rv', now)
  if (!payload || !Number.isSafeInteger(payload.e) || typeof payload.m !== 'string' || !payload.m) return null
  return { eventId: payload.e, email: payload.m, via: VIA_NAMES[payload.v] || 'email_link' }
}

/** Token del enlace de baja de las invitaciones de una productora. */
export function signInviteOptoutToken({ organizationId, email }) {
  const id = Number(organizationId)
  const m = cleanEmail(email)
  if (!Number.isSafeInteger(id) || id <= 0 || !m) return ''
  return sign({ p: 'io', o: id, m })
}

/** @returns {{ organizationId: number, email: string } | null} */
export function verifyInviteOptoutToken(token, { now = new Date() } = {}) {
  const payload = verify(token, 'io', now)
  if (!payload || !Number.isSafeInteger(payload.o) || typeof payload.m !== 'string' || !payload.m) return null
  return { organizationId: payload.o, email: payload.m }
}

/** Token del enlace de baja del reporte semanal de una persona del equipo de una productora. */
export function signWeeklyReportOptoutToken({ userId }) {
  const id = Number(userId)
  if (!Number.isSafeInteger(id) || id <= 0) return ''
  return sign({ p: 'wr', u: id })
}

/** @returns {{ userId: number } | null} */
export function verifyWeeklyReportOptoutToken(token, { now = new Date() } = {}) {
  const payload = verify(token, 'wr', now)
  if (!payload || !Number.isSafeInteger(payload.u) || payload.u <= 0) return null
  return { userId: payload.u }
}
