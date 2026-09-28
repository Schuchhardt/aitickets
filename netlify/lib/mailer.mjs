// Correo transaccional por Resend (entradas, avisos, verificación, respuestas a quien nos escribió),
// compartido por las funciones y las rutas de Astro. El correo comercial en frío NUNCA sale por aquí.
import { LEGAL } from './legal.mjs'

const env = (name) => globalThis.process?.env?.[name]
// Dominio verificado en Resend (región sa-east-1)
export const MAIL_DOMAIN = env('RESEND_DOMAIN') || 'email.aitickets.cl'
export const MAIL_FROM = env('MAIL_FROM') || `AI Tickets <no-reply@${MAIL_DOMAIN}>`
export const SITE_URL = (env('SITE_URL') || 'https://aitickets.cl').replace(/\/$/, '')

const RESEND_API = 'https://api.resend.com'
const BATCH_LIMIT = 100 // máximo de correos por llamada a /emails/batch

/** Nombre seguro para un encabezado To: (sin caracteres que rompan el formato "Nombre <email>"). */
export function formatRecipient(name, email) {
  const safeName = String(name || '').replace(/[<>",;\r\n]/g, ' ').replace(/\s+/g, ' ').trim()
  return safeName ? `${safeName} <${email}>` : email
}

export const EMAIL_RE = /^[^\s@<>(),;:"\[\]]+@[^\s@<>(),;:"\[\]]+\.[^\s@<>(),;:"\[\]]{2,}$/

export function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email)
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function safeHttpUrl(url) {
  try {
    const parsed = new URL(String(url))
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : ''
  } catch {
    return ''
  }
}

/**
 * Pie legal para correos HTML: operador (Chanium LLC), contacto, enlaces a términos/privacidad
 * y, si corresponde, el motivo del envío y un enlace para darse de baja.
 * @param {{ reason?: string, unsubscribeUrl?: string }} [opts]
 */
export function legalFooterHtml({ unsubscribeUrl } = {}) {
  const unsub = unsubscribeUrl ? safeHttpUrl(unsubscribeUrl) : ''
  const link = unsub ? ` · <a href="${esc(unsub)}" style="color:#9ca3af;text-decoration:underline">Darme de baja</a>` : ''
  return `<div style="margin-top:20px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:16px;color:#9ca3af;text-align:center">${esc(LEGAL.brand)} · ${esc(LEGAL.entity)}${link}</div>`
}

/**
 * Versión en texto plano del pie mínimo.
 * @param {{ unsubscribeUrl?: string }} [opts]
 */
export function legalFooterText({ unsubscribeUrl } = {}) {
  const unsub = unsubscribeUrl ? safeHttpUrl(unsubscribeUrl) : ''
  return ['--', `${LEGAL.brand} · ${LEGAL.entity}`, unsub ? `Darme de baja: ${unsub}` : ''].filter(Boolean).join('\n')
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(br|\/p|\/div|\/h\d|\/li|\/tr)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
}

function cleanHeaderValue(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim()
}

function resendKey() {
  const key = env('RESEND_API_KEY')
  if (!key) throw new Error('Falta RESEND_API_KEY')
  return key
}

async function resendRequest(path, payload, idempotencyKey) {
  const headers = { Authorization: `Bearer ${resendKey()}`, 'Content-Type': 'application/json' }
  if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey).slice(0, 256)
  const res = await fetch(`${RESEND_API}${path}`, { method: 'POST', headers, body: JSON.stringify(payload) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${body?.message || body?.name || 'error'}`.slice(0, 300))
  }
  return body
}

/** Reemplaza %recipient.clave% (formato heredado) con los valores del destinatario. */
function applyRecipientVars(value, vars) {
  if (!value || !vars) return value
  return String(value).replace(/%recipient\.([A-Za-z0-9_]+)%/g, (_, key) => (vars[key] == null ? '' : String(vars[key])))
}

const emailOf = (recipient) => {
  const match = String(recipient).match(/<([^>]+)>\s*$/)
  return (match ? match[1] : String(recipient)).trim().toLowerCase()
}

/**
 * Envía un correo transaccional por Resend.
 * No agrega el pie legal automáticamente: inclúyelo en `html` con legalFooterHtml().
 * Con `recipientVariables` (clave = email) se envía un correo individual por destinatario,
 * reemplazando %recipient.clave% en asunto y contenido (vía /emails/batch).
 * @param {{
 *   to: string | string[], subject: string, html: string, text?: string,
 *   replyTo?: string, from?: string, bcc?: string | string[],
 *   headers?: Record<string, string>, tags?: string[],
 *   recipientVariables?: Record<string, Record<string, unknown>>,
 *   attachments?: Array<{ filename: string, content: Buffer | string, contentType?: string }>,
 *   idempotencyKey?: string,
 * }} opts
 * @returns {Promise<{ id: string | null, ids?: string[] }>}
 */
export async function sendEmail({ to, subject, html, text, replyTo, from, bcc, headers, tags, recipientVariables, attachments, idempotencyKey } = {}) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean)
  if (!recipients.length) throw new Error('sendEmail: falta destinatario')
  if (!subject) throw new Error('sendEmail: falta asunto')
  if (!html && !text) throw new Error('sendEmail: falta contenido')

  const base = {
    from: from || MAIL_FROM,
    reply_to: cleanHeaderValue(replyTo || LEGAL.supportEmail),
  }
  const bccList = (Array.isArray(bcc) ? bcc : [bcc]).filter(Boolean)
  const extraHeaders = {}
  for (const [name, value] of Object.entries(headers || {})) {
    const headerName = String(name).replace(/[^A-Za-z0-9-]/g, '')
    if (headerName && value != null) extraHeaders[headerName] = cleanHeaderValue(value)
  }
  if (Object.keys(extraHeaders).length) base.headers = extraHeaders
  // Resend: etiquetas con nombre/valor [A-Za-z0-9_-]
  const tagList = (tags || []).map((t) => String(t).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256)).filter(Boolean).slice(0, 3)
  if (tagList.length) base.tags = tagList.map((t, i) => ({ name: `tag${i + 1}`, value: t }))
  const files = (attachments || []).filter((a) => a?.filename && a?.content != null).map((a) => ({
    filename: a.filename,
    content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : Buffer.from(String(a.content), 'utf-8').toString('base64'),
    ...(a.contentType ? { content_type: a.contentType } : {}),
  }))
  if (files.length) base.attachments = files

  const plain = text || stripHtml(html)

  if (recipientVariables && Object.keys(recipientVariables).length) {
    // Un correo por destinatario (nadie ve a los demás); /emails/batch no admite adjuntos
    const ids = []
    for (let i = 0; i < recipients.length; i += BATCH_LIMIT) {
      const chunk = recipients.slice(i, i + BATCH_LIMIT)
      const payload = chunk.map((recipient) => {
        const vars = recipientVariables[emailOf(recipient)] || recipientVariables[recipient] || {}
        const { attachments: _omit, ...rest } = base
        return {
          ...rest,
          to: [recipient],
          subject: cleanHeaderValue(applyRecipientVars(subject, vars)),
          ...(html ? { html: applyRecipientVars(html, vars) } : {}),
          text: applyRecipientVars(plain, vars),
        }
      })
      const result = await resendRequest('/emails/batch', payload, idempotencyKey ? `${idempotencyKey}-${i}` : undefined)
      for (const item of result?.data || []) if (item?.id) ids.push(item.id)
    }
    return { id: ids[0] || null, ids }
  }

  const payload = {
    ...base,
    to: recipients,
    subject: cleanHeaderValue(subject),
    text: plain,
    ...(html ? { html } : {}),
    ...(bccList.length ? { bcc: bccList } : {}),
  }
  const result = await resendRequest('/emails', payload, idempotencyKey)
  return { id: result?.id || null }
}
