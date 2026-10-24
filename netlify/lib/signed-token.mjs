// Tokens firmados sin estado: base64url(JSON) + '.' + base64url(HMAC-SHA256). Solo servidor.
// Cada tipo de token deriva su propia clave con una etiqueta (un token de un tipo nunca sirve para otro) y lleva
// su propósito en `p`; `x` (opcional) es el vencimiento en segundos Unix.
import { createHmac, timingSafeEqual } from 'node:crypto'

const MAX_TOKEN_LENGTH = 1024

const env = (name) => {
  const value = globalThis.process?.env?.[name]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * @param {string} label etiqueta de la clave (p. ej. 'aitickets-review-token')
 * @param {string[]} secretNames variables de entorno a probar en orden; la primera con valor es la base de la clave
 * @returns {{ sign: (payload: object) => string, verify: (token: string, purpose: string, now?: Date) => any | null }}
 *   sign devuelve '' y verify null si no hay ningún secreto configurado.
 */
export function tokenSigner(label, secretNames) {
  const signingKey = () => {
    const base = secretNames.map(env).find(Boolean)
    return base ? createHmac('sha256', label).update(base).digest() : null
  }

  function sign(payload) {
    const key = signingKey()
    if (!key) return ''
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
    return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`
  }

  function verify(token, purpose, now = new Date()) {
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

  return { sign, verify }
}
