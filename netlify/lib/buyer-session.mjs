// Sesión de asistentes ("Mis entradas"): sin cuenta ni contraseña, con un link de acceso por correo.
//
// - Link de acceso {p:'bl', m:email, x:exp}: llega al correo del asistente (lo pide en /mis-entradas o desde la
//   página de su orden) y vence a los BUYER_LINK_TTL_MINUTES. Al abrirlo se crea la sesión.
// - Sesión {p:'bs', m:email, x:exp}: cookie HttpOnly BUYER_COOKIE por BUYER_SESSION_DAYS. Da acceso a las órdenes
//   de ese email en todos los eventos. Sin estado: se cierra borrando la cookie (o rotando el secreto).
// Nunca se crea una sesión solo por tener el link de UNA orden: ese link se comparte (y la inscripción gratis no
// verifica el email), así que daría acceso a las entradas de otra persona. Hace falta abrir el correo.
//
// Además de la cookie HttpOnly se guardan pistas sin datos personales (BUYER_HINT_COOKIE / PRODUCER_HINT_COOKIE,
// legibles por JS): las páginas estáticas (portada, landings) las miran para decidir si preguntar quién es
// (/api/auth/session) sin llamar a la API en cada visita anónima.
// Clave: BUYER_SESSION_SECRET o, si no existe, derivada de EMAIL_VERIFY_SECRET / INTERNAL_API_SECRET / service role.
import { tokenSigner } from './signed-token.mjs'

export const BUYER_COOKIE = 'ait_buyer'
export const BUYER_HINT_COOKIE = 'ait_b'
export const PRODUCER_HINT_COOKIE = 'ait_p'
export const BUYER_SESSION_DAYS = 90
export const BUYER_LINK_TTL_MINUTES = 60

const { sign, verify } = tokenSigner('aitickets-buyer-session', ['BUYER_SESSION_SECRET', 'EMAIL_VERIFY_SECRET', 'INTERNAL_API_SECRET', 'SUPABASE_SERVICE_ROLE_KEY'])

const cleanEmail = (email) => String(email || '').trim().toLowerCase()
const validEmail = (email) => email.length >= 3 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
const expIn = (now, seconds) => Math.floor(now.getTime() / 1000) + Math.round(seconds)

/** Token del link de acceso por correo. '' si falta el secreto o el email no es válido. */
export function signBuyerLink(email, { now = new Date(), ttlMinutes = BUYER_LINK_TTL_MINUTES } = {}) {
  const m = cleanEmail(email)
  return validEmail(m) ? sign({ p: 'bl', m, x: expIn(now, ttlMinutes * 60) }) : ''
}

/** @returns {{ email: string } | null} */
export function verifyBuyerLink(token, { now = new Date() } = {}) {
  const payload = verify(token, 'bl', now)
  return payload && typeof payload.m === 'string' && validEmail(payload.m) ? { email: payload.m } : null
}

/** Valor de la cookie de sesión. '' si falta el secreto o el email no es válido. */
export function signBuyerSession(email, { now = new Date(), days = BUYER_SESSION_DAYS } = {}) {
  const m = cleanEmail(email)
  return validEmail(m) ? sign({ p: 'bs', m, x: expIn(now, days * 86400) }) : ''
}

/** @returns {{ email: string } | null} */
export function verifyBuyerSession(token, { now = new Date() } = {}) {
  const payload = verify(token, 'bs', now)
  return payload && typeof payload.m === 'string' && validEmail(payload.m) ? { email: payload.m } : null
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const SAFE_NEXT_RE = new RegExp(`^/(mis-entradas|order/${UUID}|ticket/${UUID})$`, 'i')

/** Destino tras abrir el link de acceso: solo "Mis entradas" o una orden/entrada (nunca otro sitio). */
export const safeBuyerNext = (raw) => (typeof raw === 'string' && SAFE_NEXT_RE.test(raw) ? raw : '/mis-entradas')
