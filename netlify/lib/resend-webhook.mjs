// Webhook de Resend (firmado con Svix): verificación de la firma y aplicación de los eventos de entrega.
// Lo usa src/pages/api/webhooks/resend.ts. Formato: https://docs.svix.com/receiving/verifying-payloads/how-manual
//   - headers svix-id, svix-timestamp (segundos Unix), svix-signature ("v1,<base64> v1,<base64>…", uno por secreto)
//   - firma = base64(HMAC-SHA256(secreto, `${svix-id}.${svix-timestamp}.${cuerpo crudo}`))
//   - secreto "whsec_<base64>" (Resend > Webhooks > Signing secret): la clave son los bytes del base64.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { applyProviderEvent } from './email-log.mjs'

/** Ventana de tolerancia del timestamp (anti-replay), en segundos, hacia atrás y hacia adelante. */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60

function secretKey(secret) {
  const raw = String(secret || '').trim()
  if (!raw) return null
  const b64 = raw.startsWith('whsec_') ? raw.slice('whsec_'.length) : raw
  const key = Buffer.from(b64, 'base64')
  return key.length ? key : null
}

/** Firma v1 (base64) de un mensaje. Exportada para los tests. */
export function signWebhookPayload(secret, id, timestamp, body) {
  const key = secretKey(secret)
  if (!key) throw new Error('secreto de webhook inválido')
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
}

/**
 * Verifica la firma de un webhook de Svix/Resend.
 * @param {{ secret: string, id: string | null, timestamp: string | null, signature: string | null, body: string, now?: number }} input
 * @returns {{ ok: true } | { ok: false, reason: 'missing_headers' | 'bad_secret' | 'stale_timestamp' | 'bad_signature' }}
 */
export function verifyWebhookSignature({ secret, id, timestamp, signature, body, now = Date.now() }) {
  if (!id || !timestamp || !signature) return { ok: false, reason: 'missing_headers' }
  const key = secretKey(secret)
  if (!key) return { ok: false, reason: 'bad_secret' }
  const ts = Number(timestamp)
  if (!/^\d{1,12}$/.test(String(timestamp)) || !Number.isFinite(ts) || Math.abs(now / 1000 - ts) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'stale_timestamp' }
  }
  const expected = Buffer.from(createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64'))
  for (const part of String(signature).split(' ')) {
    const [version, sig] = part.split(',')
    if (version !== 'v1' || !sig) continue
    const given = Buffer.from(sig)
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true }
  }
  return { ok: false, reason: 'bad_signature' }
}

/**
 * Aplica un evento ya verificado. Devuelve lo que hizo (para el log y para decidir el aviso a Slack).
 * Resend informa por correo (email_id), no por destinatario: el correo de entradas lleva copia oculta al productor,
 * así que un rebote de esa copia también marcaría el correo como rebotado (raro; el motivo queda en error).
 * @param {any} supabase
 * @param {any} payload cuerpo JSON de Resend: { type, created_at, data: { email_id, to, bounce?, … } }
 * @param {string} svixId id del mensaje (deduplica reintentos de Svix)
 */
export async function handleResendEvent(supabase, payload, svixId) {
  const type = String(payload?.type || '')
  const data = payload?.data || {}
  const messageId = typeof data.email_id === 'string' ? data.email_id : null
  const result = await applyProviderEvent(supabase, { messageId, type, at: payload?.created_at || data.created_at || null, eventId: svixId || null, data })
  return { type, messageId, ...result }
}
