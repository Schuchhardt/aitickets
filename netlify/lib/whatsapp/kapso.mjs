// Cliente mínimo de Kapso (WhatsApp Cloud API vía https://api.kapso.ai/meta/whatsapp) para el bot de WhatsApp.
// Docs: https://docs.kapso.ai/docs/platform/webhooks/overview y /docs/whatsapp/send-messages/text
//
// Variables de entorno:
//   KAPSO_API_KEY           API key del proyecto (Integrations → API keys)
//   KAPSO_PHONE_NUMBER_ID   phone_number_id del número conectado; el webhook ignora otros números
//   KAPSO_WEBHOOK_SECRET    secret_key del webhook de WhatsApp (firma HMAC-SHA256 hex en X-Webhook-Signature)
//   KAPSO_API_BASE          opcional (por defecto https://api.kapso.ai/meta/whatsapp/v24.0)
import { createHmac, timingSafeEqual } from 'node:crypto'

const DEFAULT_API_BASE = 'https://api.kapso.ai/meta/whatsapp/v24.0'
export const WHATSAPP_TEXT_LIMIT = 4096

export function getKapsoConfig() {
  return {
    apiKey: (process.env.KAPSO_API_KEY || '').trim(),
    phoneNumberId: (process.env.KAPSO_PHONE_NUMBER_ID || '').trim(),
    webhookSecret: (process.env.KAPSO_WEBHOOK_SECRET || '').trim(),
    apiBase: (process.env.KAPSO_API_BASE || DEFAULT_API_BASE).trim().replace(/\/+$/, ''),
  }
}

/** Verifica X-Webhook-Signature (HMAC-SHA256 hex del cuerpo exacto) en tiempo constante. */
export function verifyKapsoSignature(rawBody, signature, secret) {
  if (!secret || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest()
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'))
}

/**
 * Markdown simple (lo que suele escribir el modelo) → formato de WhatsApp.
 * **negrita** → *negrita*, [texto](url) → "texto: url", títulos "# x" → *x*, viñetas "* " → "• ".
 */
export function toWhatsAppText(markdown) {
  return String(markdown || '')
    .replace(/\r\n/g, '\n')
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '_$1_')
    .replace(/^\s*[*-]\s+/gm, '• ')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => (label.trim() === url ? url : `${label.trim()}: ${url}`))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Corta un texto largo en trozos ≤ limit, prefiriendo saltos de párrafo o de línea. */
export function splitForWhatsApp(text, limit = WHATSAPP_TEXT_LIMIT) {
  const parts = []
  let rest = String(text || '').trim()
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n\n', limit)
    if (cut < limit / 2) cut = rest.lastIndexOf('\n', limit)
    if (cut < limit / 2) cut = rest.lastIndexOf(' ', limit)
    if (cut < limit / 2) cut = limit
    parts.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) parts.push(rest)
  return parts
}

async function kapsoPost(cfg, body) {
  if (!cfg.apiKey || !cfg.phoneNumberId) throw new Error('kapso_not_configured')
  const res = await fetch(`${cfg.apiBase}/${encodeURIComponent(cfg.phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { 'X-API-Key': cfg.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    signal: AbortSignal.timeout(15_000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = data?.error?.message || data?.message || res.statusText
    throw new Error(`kapso_http_${res.status}: ${String(detail).slice(0, 200)}`)
  }
  return data
}

/** Destinatario: teléfono (to) si existe; si no, el BSUID (recipient). */
export function recipientFields({ phone, bsuid }) {
  if (phone) return { to: String(phone).replace(/\D/g, '') }
  if (bsuid) return { recipient_type: 'individual', recipient: String(bsuid) }
  throw new Error('kapso_no_recipient')
}

/** Envía un texto (ya en formato WhatsApp). Devuelve el wamid. */
export async function sendWhatsAppText({ phone, bsuid, body }, cfg = getKapsoConfig()) {
  const data = await kapsoPost(cfg, {
    ...recipientFields({ phone, bsuid }),
    type: 'text',
    text: { body: String(body).slice(0, WHATSAPP_TEXT_LIMIT), preview_url: true },
  })
  return data?.messages?.[0]?.id || null
}

/** Marca un mensaje entrante como leído y muestra "escribiendo…" (~25 s o hasta la respuesta). Nunca lanza. */
export async function markReadWithTyping(wamid, cfg = getKapsoConfig()) {
  if (!wamid) return
  try {
    await kapsoPost(cfg, { status: 'read', message_id: wamid, typing_indicator: { type: 'text' } })
  } catch (err) {
    console.warn('[kapso] markRead:', err?.message)
  }
}

/** Texto de un mensaje entrante: texto, respuesta de botón/lista, transcripción de audio o representación de Kapso. */
export function inboundText(message) {
  if (!message || typeof message !== 'object') return ''
  const k = message.kapso || {}
  const text =
    message.text?.body ||
    message.interactive?.button_reply?.title ||
    message.interactive?.list_reply?.title ||
    message.button?.text ||
    k.transcript?.text ||
    message.image?.caption ||
    message.document?.caption ||
    message.video?.caption ||
    ''
  if (text) return String(text).trim()
  if (message.type === 'location' && message.location) {
    const l = message.location
    return `[Ubicación compartida: ${[l.name, l.address].filter(Boolean).join(', ') || `${l.latitude}, ${l.longitude}`}]`
  }
  return message.type ? `[${message.type} sin texto]` : ''
}
