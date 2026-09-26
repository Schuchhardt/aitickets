// Tokens firmados del outreach: base64url(JSON payload) + '.' + base64url(HMAC-SHA256).
// Fuente única: src/lib/lead-token.ts re-exporta este archivo (no reimplementar el algoritmo).
//
// - Baja (unsubscribe): {p:'u', l:leadId, e:email}, secreto OUTREACH_UNSUB_SECRET, sin vencimiento
//   (la ley exige que el enlace de baja siga funcionando).
// - Registro (lead):    {p:'l', l:leadId, exp}, secreto LEAD_TOKEN_SECRET, 30 días.
// - Aprobación (Slack): {p:'a', m:messageId, exp}, secreto LEAD_TOKEN_SECRET, 7 días.
// - Confirmación /web-gratis (doble opt-in): {p:'c', i:pendingId, e:email, exp}, LEAD_TOKEN_SECRET, 72 h.
// El campo `p` (propósito) va dentro de lo firmado: un token de un tipo nunca sirve para otro.
// Sin secreto configurado, sign* devuelve '' y verify* devuelve null (falla cerrado).
import { createHmac, timingSafeEqual } from 'node:crypto'

const LEAD_TOKEN_TTL_S = 30 * 24 * 60 * 60
const APPROVE_TOKEN_TTL_S = 7 * 24 * 60 * 60
const INBOUND_CONFIRM_TTL_S = 72 * 60 * 60
const MAX_TOKEN_LENGTH = 2048

function env(name) {
  const value = globalThis.process?.env?.[name]
  return typeof value === 'string' ? value.trim() : ''
}

function b64url(input) {
  return Buffer.from(input).toString('base64url')
}

function sign(payload, secret) {
  if (!secret) return ''
  const body = b64url(JSON.stringify(payload))
  const mac = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${mac}`
}

function verify(token, secret, purpose) {
  if (!secret || typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH) return null
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const [body, mac] = parts
  const expected = createHmac('sha256', secret).update(body).digest()
  let received
  try {
    received = Buffer.from(mac, 'base64url')
  } catch {
    return null
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null
  let payload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object' || payload.p !== purpose) return null
  if (payload.exp !== undefined) {
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null
  }
  return payload
}

const nowS = () => Math.floor(Date.now() / 1000)

/** Token de baja para el enlace List-Unsubscribe y el pie del correo. */
export function signUnsubToken(leadId, email) {
  return sign({ p: 'u', l: String(leadId || ''), e: String(email || '').toLowerCase() }, env('OUTREACH_UNSUB_SECRET'))
}

/** @returns {{leadId: string, email: string} | null} */
export function verifyUnsubToken(token) {
  const payload = verify(token, env('OUTREACH_UNSUB_SECRET'), 'u')
  if (!payload || typeof payload.e !== 'string' || !payload.e) return null
  return { leadId: String(payload.l || ''), email: payload.e }
}

/** Token del enlace mágico de registro (/organizadores/registro?lead=...). 30 días. */
export function signLeadToken(leadId, ttlSeconds = LEAD_TOKEN_TTL_S) {
  if (!leadId) return ''
  return sign({ p: 'l', l: String(leadId), exp: nowS() + ttlSeconds }, env('LEAD_TOKEN_SECRET'))
}

/** @returns {{leadId: string} | null} */
export function verifyLeadToken(token) {
  const payload = verify(token, env('LEAD_TOKEN_SECRET'), 'l')
  if (!payload || typeof payload.l !== 'string' || !payload.l) return null
  return { leadId: payload.l }
}

/** Token para la página de aprobación/rechazo de un borrador desde Slack. 7 días. */
export function signApproveToken(messageId, ttlSeconds = APPROVE_TOKEN_TTL_S) {
  if (!messageId) return ''
  return sign({ p: 'a', m: String(messageId), exp: nowS() + ttlSeconds }, env('LEAD_TOKEN_SECRET'))
}

/** @returns {{messageId: string} | null} */
export function verifyApproveToken(token) {
  const payload = verify(token, env('LEAD_TOKEN_SECRET'), 'a')
  if (!payload || typeof payload.m !== 'string' || !payload.m) return null
  return { messageId: payload.m }
}

/** Token del enlace de confirmación que se envía al correo ingresado en /web-gratis (doble opt-in). 72 h. */
export function signInboundConfirmToken(pendingId, email, ttlSeconds = INBOUND_CONFIRM_TTL_S) {
  if (!pendingId || !email) return ''
  return sign({ p: 'c', i: String(pendingId), e: String(email).toLowerCase(), exp: nowS() + ttlSeconds }, env('LEAD_TOKEN_SECRET'))
}

/** @returns {{pendingId: string, email: string} | null} */
export function verifyInboundConfirmToken(token) {
  const payload = verify(token, env('LEAD_TOKEN_SECRET'), 'c')
  if (!payload || typeof payload.i !== 'string' || !payload.i || typeof payload.e !== 'string' || !payload.e) return null
  return { pendingId: payload.i, email: payload.e }
}

/** Comparación de secretos en tiempo constante (webhook ?k=). */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''))
  const y = Buffer.from(String(b ?? ''))
  if (!x.length || x.length !== y.length) return false
  return timingSafeEqual(x, y)
}
