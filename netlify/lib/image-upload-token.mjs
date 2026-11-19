// Link para subir una imagen sin sesión (/subir-imagen/<token>, herramienta create_image_upload_link del MCP):
// base64url(JSON) + '.' + HMAC, con vencimiento corto. {p:'iu', o, e?, u, x}
//   o  organización dueña de la imagen
//   e  evento al que se aplica (obligatorio si u no es 'library')
//   u  qué se hace con la imagen: 'cover' (portada), 'mobile_cover' (foto para celular de la portada ancha) o
//      'library' (solo se aloja y se muestra su URL)
// Sirve para que el productor suba un archivo que tiene en su teléfono o computador cuando el asistente no tiene una
// URL pública ni puede mandar la imagen en base64. Quien tenga el link puede subir imágenes a ese destino hasta que
// venza: se entrega solo en la respuesta de la herramienta y no se guarda.
// Clave: IMAGE_UPLOAD_TOKEN_SECRET o, si no existe, derivada de EMAIL_VERIFY_SECRET / INTERNAL_API_SECRET / service
// role con su propia etiqueta. Sin ninguna, sign devuelve '' y verify null.
import { tokenSigner } from './signed-token.mjs'

const { sign, verify } = tokenSigner('aitickets-image-upload', ['IMAGE_UPLOAD_TOKEN_SECRET', 'EMAIL_VERIFY_SECRET', 'INTERNAL_API_SECRET', 'SUPABASE_SERVICE_ROLE_KEY'])

export const IMAGE_UPLOAD_USES = ['library', 'cover', 'mobile_cover']
export const IMAGE_UPLOAD_DEFAULT_MINUTES = 30
export const IMAGE_UPLOAD_MAX_MINUTES = 120

const positiveInt = (v) => Number.isInteger(v) && v > 0

/**
 * @param {{ orgId: number, eventId?: number|null, use: string, minutes?: number, now?: Date }} p
 * @returns {{ token: string, expiresAt: Date } | null} null si faltan datos o el secreto
 */
export function signImageUploadToken({ orgId, eventId = null, use, minutes = IMAGE_UPLOAD_DEFAULT_MINUTES, now = new Date() }) {
  if (!positiveInt(orgId) || !IMAGE_UPLOAD_USES.includes(use)) return null
  if (use !== 'library' && !positiveInt(eventId)) return null
  const mins = Math.min(IMAGE_UPLOAD_MAX_MINUTES, Math.max(1, Math.floor(Number(minutes) || IMAGE_UPLOAD_DEFAULT_MINUTES)))
  const x = Math.floor(now.getTime() / 1000) + mins * 60
  const payload = { p: 'iu', o: orgId, u: use, x }
  if (positiveInt(eventId)) payload.e = eventId
  const token = sign(payload)
  return token ? { token, expiresAt: new Date(x * 1000) } : null
}

/** @returns {{ orgId: number, eventId: number|null, use: 'library'|'cover'|'mobile_cover', expiresAt: Date } | null} */
export function verifyImageUploadToken(token, now = new Date()) {
  const payload = verify(token, 'iu', now)
  if (!payload || !positiveInt(payload.o) || !IMAGE_UPLOAD_USES.includes(payload.u) || typeof payload.x !== 'number') return null
  const eventId = payload.e === undefined ? null : payload.e
  if (eventId !== null && !positiveInt(eventId)) return null
  if (payload.u !== 'library' && eventId === null) return null
  return { orgId: payload.o, eventId, use: payload.u, expiresAt: new Date(payload.x * 1000) }
}
