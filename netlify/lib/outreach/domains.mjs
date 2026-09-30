// Utilidades de dominios y correos para el outreach (sin dependencias; seguro para tests).

/** Dominios de correo gratuito: nunca se usan como clave de organización ni se suprimen por dominio. */
export const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.cl', 'hotmail.es', 'outlook.com', 'outlook.cl',
  'outlook.es', 'live.com', 'live.cl', 'msn.com', 'yahoo.com', 'yahoo.es', 'yahoo.cl', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'zoho.com',
  'mail.com', 'vtr.net', 'terra.cl', 'entelchile.net', 'yandex.com',
])

/** Plataformas de venta de entradas: si el enlace del evento apunta aquí, sirve como señal de "current_ticketing". */
export const TICKETING_HOSTS = {
  'ticketplus.cl': 'ticketplus',
  'puntoticket.com': 'puntoticket',
  'passline.com': 'passline',
  'welcu.com': 'welcu',
  'eventbrite.com': 'eventbrite',
  'eventbrite.cl': 'eventbrite',
  'joinnus.com': 'joinnus',
  'ticketmaster.cl': 'ticketmaster',
  'portaltickets.cl': 'portaltickets',
  'tickethoy.cl': 'tickethoy',
  'eticket.cl': 'eticket',
  'daleticket.cl': 'daleticket',
  'feriaticket.cl': 'feriaticket',
  'sympla.com.br': 'sympla',
  'ticketea.com': 'ticketea',
  'aitickets.cl': 'aitickets',
}

/** Hosts que nunca son el sitio propio de un productor (redes sociales, acortadores, hosting genérico). */
const NON_OWNED_HOSTS = [
  'instagram.com', 'facebook.com', 'fb.com', 'fb.me', 'twitter.com', 'x.com', 'tiktok.com', 'youtube.com',
  'youtu.be', 'linkedin.com', 'linktr.ee', 'bit.ly', 'wa.me', 'whatsapp.com', 'google.com', 'forms.gle',
  'goo.gl', 'drive.google.com', 'docs.google.com', 'sites.google.com', 'spotify.com', 'chilecultura.gob.cl',
  'wixsite.com', 'blogspot.com', 'wordpress.com', 'webador.es', 'webador.com', 'jimdosite.com', 'canva.site',
  'my.canva.site', 'carrd.co', 'notion.site',
]

/** Sufijos de segundo nivel comunes en LatAm/ES donde el dominio registrable tiene 3 etiquetas. */
const SECOND_LEVEL = new Set([
  'com.ar', 'com.br', 'com.mx', 'com.pe', 'com.co', 'com.uy', 'com.py', 'com.bo', 'com.ec', 'com.ve',
  'com.es', 'org.ar', 'org.mx', 'org.pe', 'org.co', 'gob.cl', 'gob.ar', 'gob.mx', 'gob.pe', 'gov.co',
  'edu.ar', 'edu.pe', 'edu.co', 'co.uk', 'org.uk', 'com.au', 'net.ar', 'net.pe',
])

export function normalizeHost(input) {
  if (!input) return ''
  let raw = String(input).trim().toLowerCase()
  if (!raw) return ''
  if (!/^[a-z]+:\/\//.test(raw)) raw = `http://${raw}`
  try {
    const host = new URL(raw).hostname.replace(/\.$/, '')
    if (!host || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':')) return ''
    return host
  } catch {
    return ''
  }
}

/** Dominio registrable aproximado: "www.teatro.cl" → "teatro.cl"; "x.gam.com.ar" → "gam.com.ar". */
export function registrableDomain(input) {
  const host = normalizeHost(input)
  if (!host) return ''
  const parts = host.split('.')
  if (parts.length <= 2) return host
  const lastTwo = parts.slice(-2).join('.')
  return SECOND_LEVEL.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo
}

function hostMatches(host, list) {
  return list.some((d) => host === d || host.endsWith(`.${d}`))
}

/** Plataforma de ticketing del enlace, o null. */
export function ticketingPlatformOf(url) {
  const host = normalizeHost(url)
  if (!host) return null
  for (const [domain, name] of Object.entries(TICKETING_HOSTS)) {
    if (host === domain || host.endsWith(`.${domain}`)) return name
  }
  return null
}

/**
 * Hosts que NUNCA se visitan (ni fetch, ni Firecrawl scrape/crawl, ni navegador): están detrás de un
 * desafío anti-bots (Cloudflare "cf-mitigated: challenge") y visitarlos sería evadir esa protección.
 * De ellos solo se usan títulos/snippets/URLs que devuelve un buscador (ver docs/runbooks/passline-leads.md).
 */
export const NEVER_FETCH_HOSTS = ['passline.com']

/** true si la URL (o host) pertenece a un dominio que nunca se visita (passline.com y subdominios). */
export function isNeverFetchUrl(url) {
  const host = normalizeHost(url)
  if (!host) return false
  return hostMatches(host, NEVER_FETCH_HOSTS)
}

/** true si el enlace puede ser el sitio propio de un productor (no red social, ticketera ni hosting genérico). */
export function isOwnedSiteUrl(url) {
  const host = normalizeHost(url)
  if (!host) return false
  if (ticketingPlatformOf(url)) return false
  if (hostMatches(host, NON_OWNED_HOSTS)) return false
  return true
}

export function isGovernmentOrEducationDomain(domain) {
  const d = String(domain || '').toLowerCase()
  return /(^|\.)(gob|gov|mil|edu)\.[a-z]{2}$/.test(d) || /\.(gov|edu|mil)$/.test(d) || /(^|\.)(uchile|puc|uc|usach|udec|uv|ufro|uach)\.cl$/.test(d)
}

export const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i

export function normalizeEmail(email) {
  const e = String(email || '').trim().toLowerCase()
  if (!e || e.length > 254 || !EMAIL_RE.test(e)) return ''
  return e
}

export function emailDomain(email) {
  const e = normalizeEmail(email)
  return e ? e.split('@')[1] : ''
}

export function isFreeMailDomain(domain) {
  return FREE_MAIL_DOMAINS.has(String(domain || '').toLowerCase())
}

/** Dominio que se guarda en aitickets_leads.domain: NULL (null) para correo gratuito. */
export function leadDomainFor({ website, email } = {}) {
  const fromSite = website && isOwnedSiteUrl(website) ? registrableDomain(website) : ''
  if (fromSite && !isFreeMailDomain(fromSite)) return fromSite
  const fromEmail = registrableDomain(emailDomain(email))
  if (fromEmail && !isFreeMailDomain(fromEmail)) return fromEmail
  return null
}

const ROLE_LOCAL_PARTS = [
  'contacto', 'contact', 'hola', 'hello', 'info', 'informaciones', 'produccion', 'producción', 'ventas',
  'prensa', 'comunicaciones', 'eventos', 'booking', 'reservas', 'administracion', 'admin', 'gerencia',
  'programacion', 'cultura', 'teatro', 'boleteria', 'taquilla', 'comercial', 'marketing', 'office',
]

export function isRoleAddress(email) {
  const local = normalizeEmail(email).split('@')[0] || ''
  return ROLE_LOCAL_PARTS.some((r) => local === r || local.startsWith(`${r}.`) || local.startsWith(`${r}_`) || local.startsWith(`${r}-`))
}

/** Direcciones que nunca se contactan (no-reply, abuse, etc.). */
export function isBlockedLocalPart(email) {
  const local = normalizeEmail(email).split('@')[0] || ''
  return /^(no-?reply|noreply|donotreply|mailer-daemon|postmaster|abuse|webmaster|privacy|privacidad|legal|dpo|unsubscribe|bounce)/.test(local)
}
