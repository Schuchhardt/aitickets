// Mailgun compartido por las funciones que envían correo.
import FormData from 'form-data'
import Mailgun from 'mailgun.js'

export const MAIL_DOMAIN = process.env.MAILGUN_DOMAIN || 'mg.aitickets.cl'
export const MAIL_FROM = `AI Tickets <postmaster@${MAIL_DOMAIN}>`
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
