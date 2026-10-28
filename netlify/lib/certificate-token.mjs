// Link del certificado de asistencia (/certificado/<token>): base64url(JSON) + '.' + HMAC, sin vencimiento (un
// certificado se descarga cuando se necesita, a veces meses después). {p:'ct', t:[ids], n?, h?}
//   t  entradas (event_attendees.id sin guiones): una, o las de un mismo correo (quien compró para su equipo sin
//      nombre por entrada recibe un solo link con un certificado por página)
//   n  mínimo de funciones con ingreso para un pase de varias funciones (el que eligió el productor al enviar)
//   h  horas que dice el certificado, si el productor las fijó (si no, la suma de las funciones a las que fue)
// El certificado se vuelve a calcular en cada descarga: si la entrada se anuló, el link deja de servir.
// Clave: CERTIFICATE_TOKEN_SECRET o, si no existe, derivada de EMAIL_VERIFY_SECRET / INTERNAL_API_SECRET / service
// role con su propia etiqueta. Sin ninguna, sign devuelve '' y verify null.
import { tokenSigner } from './signed-token.mjs'

const { sign, verify } = tokenSigner('aitickets-certificate-token', ['CERTIFICATE_TOKEN_SECRET', 'EMAIL_VERIFY_SECRET', 'INTERNAL_API_SECRET', 'SUPABASE_SERVICE_ROLE_KEY'])

/** Máximo de certificados en un link (el token tiene un largo máximo). */
export const MAX_TICKETS_PER_TOKEN = 15

const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i
const compact = (id) => String(id).replace(/-/g, '').toLowerCase()
const expand = (hex) => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`

/**
 * @param {{ ticketIds: string[], minSessions?: number|null, hours?: number|null }} p
 * @returns {string} '' si faltan datos o el secreto
 */
export function signCertificateToken({ ticketIds, minSessions = null, hours = null }) {
  const ids = [...new Set((ticketIds || []).filter((id) => UUID_RE.test(String(id))).map(compact))]
  if (!ids.length || ids.length > MAX_TICKETS_PER_TOKEN) return ''
  const payload = { p: 'ct', t: ids }
  if (Number.isInteger(minSessions) && minSessions > 1) payload.n = minSessions
  if (Number.isFinite(hours) && hours > 0) payload.h = Math.round(hours * 10) / 10
  return sign(payload)
}

/** @returns {{ ticketIds: string[], minSessions: number, hours: number|null } | null} */
export function verifyCertificateToken(token) {
  const payload = verify(token, 'ct')
  if (!payload || !Array.isArray(payload.t) || !payload.t.length || payload.t.length > MAX_TICKETS_PER_TOKEN) return null
  if (!payload.t.every((id) => typeof id === 'string' && /^[0-9a-f]{32}$/.test(id))) return null
  return {
    ticketIds: payload.t.map(expand),
    minSessions: Number.isInteger(payload.n) && payload.n > 1 ? payload.n : 1,
    hours: Number.isFinite(payload.h) && payload.h > 0 ? payload.h : null,
  }
}
