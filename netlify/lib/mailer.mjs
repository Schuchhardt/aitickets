// Mailgun compartido por las funciones que envían correo (solo transaccional: entradas, avisos,
// verificación, respuestas a quien nos escribió). El correo comercial en frío NUNCA sale por aquí.
import FormData from 'form-data'
import Mailgun from 'mailgun.js'
import { LEGAL, legalLine } from './legal.mjs'

export const MAIL_DOMAIN = process.env.MAILGUN_DOMAIN || 'mg.aitickets.cl'
export const MAIL_FROM = process.env.MAIL_FROM || `AI Tickets <no-reply@${MAIL_DOMAIN}>`
export const SITE_URL = (process.env.SITE_URL || 'https://aitickets.cl').replace(/\/$/, '')

let client = null
export function getMailgun() {
  if (client) return client
  if (!process.env.MAILGUN_API_KEY) throw new Error('Falta MAILGUN_API_KEY')
  client = new Mailgun(FormData).client({ username: 'api', key: process.env.MAILGUN_API_KEY })
  return client
}

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
export function legalFooterHtml({ reason, unsubscribeUrl } = {}) {
  const unsub = unsubscribeUrl ? safeHttpUrl(unsubscribeUrl) : ''
  const linkStyle = 'color:#6b7280;text-decoration:underline'
  const parts = []
  if (reason) parts.push(`<p style="margin:0 0 6px 0">${esc(reason)}</p>`)
  if (unsub) {
    parts.push(`<p style="margin:0 0 6px 0"><a href="${esc(unsub)}" style="${linkStyle}">Darme de baja de estos correos</a></p>`)
  }
  parts.push(
    `<p style="margin:0 0 6px 0">¿Dudas? Escríbenos a <a href="mailto:${esc(LEGAL.supportEmail)}" style="${linkStyle}">${esc(LEGAL.supportEmail)}</a></p>`
  )
  parts.push(`<p style="margin:0 0 6px 0">${esc(legalLine())}</p>`)
  parts.push(
    `<p style="margin:0"><a href="${SITE_URL}/terms" style="${linkStyle}">Términos</a> · <a href="${SITE_URL}/privacy" style="${linkStyle}">Privacidad</a></p>`
  )
  return `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#6b7280;text-align:center">${parts.join('')}</div>`
}

/**
 * Versión en texto plano del pie legal.
 * @param {{ reason?: string, unsubscribeUrl?: string }} [opts]
 */
export function legalFooterText({ reason, unsubscribeUrl } = {}) {
  const unsub = unsubscribeUrl ? safeHttpUrl(unsubscribeUrl) : ''
  const lines = ['--']
  if (reason) lines.push(String(reason))
  if (unsub) lines.push(`Darme de baja: ${unsub}`)
  lines.push(`¿Dudas? Escríbenos a ${LEGAL.supportEmail}`)
  lines.push(legalLine())
  lines.push(`Términos: ${SITE_URL}/terms · Privacidad: ${SITE_URL}/privacy`)
  return lines.join('\n')
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

/**
 * Envía un correo transaccional por Mailgun.
 * No agrega el pie legal automáticamente: inclúyelo en `html` con legalFooterHtml().
 * @param {{
 *   to: string | string[], subject: string, html: string, text?: string,
 *   replyTo?: string, from?: string, bcc?: string | string[],
 *   headers?: Record<string, string>, tags?: string[],
 *   recipientVariables?: Record<string, Record<string, unknown>>,
 * }} opts
 * @returns {Promise<{ id: string | null }>}
 */
export async function sendEmail({ to, subject, html, text, replyTo, from, bcc, headers, tags, recipientVariables } = {}) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean)
  if (!recipients.length) throw new Error('sendEmail: falta destinatario')
  if (!subject) throw new Error('sendEmail: falta asunto')
  if (!html && !text) throw new Error('sendEmail: falta contenido')

  const data = {
    from: from || MAIL_FROM,
    to: recipients,
    subject: cleanHeaderValue(subject),
    text: text || stripHtml(html),
    'h:Reply-To': cleanHeaderValue(replyTo || LEGAL.supportEmail),
  }
  if (html) data.html = html
  const bccList = (Array.isArray(bcc) ? bcc : [bcc]).filter(Boolean)
  if (bccList.length) data.bcc = bccList
  for (const [name, value] of Object.entries(headers || {})) {
    const headerName = String(name).replace(/[^A-Za-z0-9-]/g, '')
    if (!headerName || value == null) continue
    data[`h:${headerName}`] = cleanHeaderValue(value)
  }
  const tagList = (tags || []).map((t) => String(t).slice(0, 128)).filter(Boolean).slice(0, 3)
  if (tagList.length) data['o:tag'] = tagList
  if (recipientVariables && Object.keys(recipientVariables).length) {
    data['recipient-variables'] = JSON.stringify(recipientVariables)
  }

  const result = await getMailgun().messages.create(MAIL_DOMAIN, data)
  return { id: result?.id || null }
}
