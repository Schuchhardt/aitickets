// Tokens firmados de reseñas e invitaciones: base64url(JSON) + '.' + base64url(HMAC-SHA256). Solo servidor.
//
// - Reseña:   {p:'rv', e:eventId, m:email, v:vía, x:exp}. Da derecho a calificar y subir fotos de ESE evento como ESE
//   email. Llega en el correo de 24 h, en el correo "tu link para calificar" o al validar una orden/entrada en la
//   página del evento. Vence a los REVIEW_TOKEN_TTL_DAYS días. v: cómo se validó ('o' orden, 't' entrada,
//   sin v = correo).
// - Baja de invitaciones: {p:'io', o:organizationId, m:email}, sin vencimiento (el enlace de baja debe seguir
//   funcionando siempre, Ley 19.496 art. 28 B).
// Clave: REVIEW_TOKEN_SECRET o, si no existe, derivada de EMAIL_VERIFY_SECRET / INTERNAL_API_SECRET / service role
// con una etiqueta propia (un token de otro tipo nunca sirve aquí). Sin ninguna, sign* devuelve '' y verify* null.
import { createHmac, timingSafeEqual } from 'node:crypto'

import { REVIEW_TOKEN_TTL_DAYS } from './reviews.mjs'

const MAX_TOKEN_LENGTH = 1024

const env = (name) => {
  const value = globalThis.process?.env?.[name]
  return typeof value === 'string' ? value.trim() : ''
}

function signingKey() {
  const base = env('REVIEW_TOKEN_SECRET') || env('EMAIL_VERIFY_SECRET') || env('INTERNAL_API_SECRET') || env('SUPABASE_SERVICE_ROLE_KEY')
  return base ? createHmac('sha256', 'aitickets-review-token').update(base).digest() : null
}

function sign(payload) {
  const key = signingKey()
  if (!key) return ''
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`
}

function verify(token, purpose, now) {
  const key = signingKey()
  if (!key || typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH) return null
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const expected = createHmac('sha256', key).update(parts[0]).digest()
  const received = Buffer.from(parts[1], 'base64url')
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null
  let payload
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object' || payload.p !== purpose) return null
  if (payload.x !== undefined && (typeof payload.x !== 'number' || payload.x * 1000 < now.getTime())) return null
  return payload
}

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
