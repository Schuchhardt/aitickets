// Proveedor de dominios propios: alias de dominio del sitio de Netlify (domain_aliases).
//
// Reglas:
//   * Antes de agregar el alias se exige el TXT de propiedad (_aitickets-verify.<host> = token del sitio):
//     que el DNS apunte a Netlify no prueba que el dominio sea del productor.
//   * Se verifica el DNS ANTES de agregar el alias: un alias con DNS roto hace fallar la renovación del
//     certificado Let's Encrypt que comparten TODOS los alias del sitio.
//   * domain_aliases solo se puede reemplazar completo (PATCH), así que se hace lectura-modificación-
//     escritura y se verifica releyendo; nunca se borran alias que no sean el del productor.
//   * Máximo SITES_MAX_NETLIFY_ALIASES (50 por defecto; Netlify recomienda ≤ 50 y el tope duro es 100).
//   * Un dominio activo que deja de apuntar a Netlify por más de 72 h se desconecta (se quita el alias).
//
// Seguridad: NETLIFY_AUTH_TOKEN puede modificar TODO el sitio de Netlify (dominios, deploys). Debe
// configurarse SOLO en el contexto Production (las deploy previews comparten el código no confiable).
import { checkDnsPointing, checkHttps, checkOwnershipTxt } from './dns.mjs'
import { dnsRecordsFor, maxNetlifyAliases, DOMAIN_DNS_LOST_MAX_HOURS } from './validate.mjs'

const API = 'https://api.netlify.com/api/v1'
const DEFAULT_SITE_ID = 'd00b677f-67cb-4336-999d-0dc681fb0879'
const API_TIMEOUT_MS = 10000
/** Cada cuánto se vuelve a pedir el certificado mientras está pendiente. */
const SSL_REQUEST_INTERVAL_MS = 30 * 60 * 1000

export class DomainProviderError extends Error {
  constructor(message, code, status) {
    super(message)
    this.name = 'DomainProviderError'
    this.code = code
    this.status = status
  }
}

function env(name) {
  const v = globalThis.process?.env?.[name]
  return typeof v === 'string' ? v.trim() : ''
}

function siteId() {
  return env('NETLIFY_SITE_ID') || DEFAULT_SITE_ID
}

async function netlifyApi(path, { method = 'GET', body } = {}) {
  const token = env('NETLIFY_AUTH_TOKEN')
  if (!token) throw new DomainProviderError('NETLIFY_AUTH_TOKEN no configurado', 'not_configured')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'AITickets-Domains/1.0',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await res.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = { raw: text.slice(0, 300) }
    }
    if (!res.ok) {
      const msg = data?.message || data?.error || `HTTP ${res.status}`
      throw new DomainProviderError(`Netlify API ${method} ${path}: ${msg}`, 'api_error', res.status)
    }
    return data
  } catch (err) {
    if (err instanceof DomainProviderError) throw err
    throw new DomainProviderError(`Netlify API ${method} ${path}: ${err?.message || err}`, 'network')
  } finally {
    clearTimeout(timer)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function readAliases() {
  const site = await netlifyApi(`/sites/${siteId()}`)
  const aliases = Array.isArray(site?.domain_aliases) ? site.domain_aliases.map((a) => String(a).toLowerCase()) : []
  return { aliases, customDomain: String(site?.custom_domain || '').toLowerCase() }
}

/** Agrega el alias conservando los existentes. Reintenta si una escritura concurrente lo pisó. */
export async function addAlias(hostname) {
  const host = hostname.toLowerCase()
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { aliases, customDomain } = await readAliases()
    if (host === customDomain || aliases.includes(host)) return { added: false, count: aliases.length }
    if (aliases.length >= maxNetlifyAliases()) {
      throw new DomainProviderError('Se alcanzó el límite de dominios propios', 'cap_reached')
    }
    const next = [...aliases, host]
    await netlifyApi(`/sites/${siteId()}`, { method: 'PATCH', body: { domain_aliases: next } })
    const after = await readAliases()
    const lost = aliases.filter((a) => !after.aliases.includes(a))
    if (after.aliases.includes(host) && !lost.length) return { added: true, count: after.aliases.length }
    if (lost.length) console.warn(`domains/netlify: escritura concurrente detectada (alias perdidos: ${lost.length}); reintentando`)
    await sleep(300 + Math.floor(Math.random() * 700))
  }
  throw new DomainProviderError('No se pudo agregar el alias (escrituras concurrentes)', 'conflict')
}

/** Quita solo este alias (no toca los demás). */
export async function removeAlias(hostname) {
  const host = hostname.toLowerCase()
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { aliases } = await readAliases()
    if (!aliases.includes(host)) return { removed: false }
    const next = aliases.filter((a) => a !== host)
    await netlifyApi(`/sites/${siteId()}`, { method: 'PATCH', body: { domain_aliases: next } })
    const after = await readAliases()
    const lost = next.filter((a) => !after.aliases.includes(a))
    if (!after.aliases.includes(host) && !lost.length) return { removed: true }
    await sleep(300 + Math.floor(Math.random() * 700))
  }
  throw new DomainProviderError('No se pudo quitar el alias (escrituras concurrentes)', 'conflict')
}

/** Pide a Netlify (re)emitir el certificado para incluir los alias nuevos. */
async function requestCertificate() {
  try {
    await netlifyApi(`/sites/${siteId()}/ssl`, { method: 'POST' })
    return true
  } catch (err) {
    // 422 típico: algún alias aún no apunta. Se reintenta en la próxima corrida.
    console.warn('domains/netlify: no se pudo pedir el certificado:', err?.message)
    return false
  }
}

const hoursBetween = (a, b) => Math.abs(b - a) / 3_600_000

export const netlifyProvider = {
  name: 'netlify',

  /**
   * Verifica el DNS y, solo si ya apunta, agrega el alias. Si no apunta, queda pending_dns (el cron
   * lo reintenta cada 15 min).
   */
  async addDomain(hostname, { token } = {}) {
    const records = dnsRecordsFor(hostname, 'netlify', token)
    const txt = await checkOwnershipTxt(hostname, token)
    if (!txt.ok) {
      return { providerId: null, status: 'pending_dns', records, error: txt.error, verification: { token, last_txt: txt.code } }
    }
    const dns = await checkDnsPointing(hostname, { providerName: 'netlify' })
    if (!dns.ok) {
      return { providerId: null, status: 'pending_dns', records, error: dns.error, verification: { token, last_txt: 'ok', last_dns: dns.code } }
    }
    const { added } = await addAlias(hostname) // puede lanzar cap_reached / conflict
    const now = new Date().toISOString()
    const certRequested = await requestCertificate()
    /** @type {Record<string, any>} */
    const verification = { token, owner_verified_at: now, attached_at: now, dns_ok_at: now, ssl_requested_at: certRequested ? now : null, last_txt: 'ok', last_dns: 'ok' }
    // El alias ya existía (lo agregó el dueño del sitio de Netlify u otro proceso): no es nuestro, nunca se quita
    if (!added) verification.alias_preexisting = true
    return {
      providerId: hostname,
      status: 'pending_ssl',
      records,
      error: null,
      verification,
    }
  },

  /**
   * Avanza el estado del dominio. Devuelve { status, error, verification, providerId? }.
   * `verification` es el jsonb domain_verification completo a guardar.
   */
  async checkDomain(site, now = new Date()) {
    const host = site.custom_domain
    const v = { ...(site.domain_verification || {}) }
    const nowIso = now.toISOString()
    const status = site.domain_status

    if (status === 'pending_provider' || status === 'pending_dns') {
      const txt = await checkOwnershipTxt(host, v.token)
      v.last_txt = txt.ok ? 'ok' : txt.code
      if (!txt.ok) return { status: 'pending_dns', error: txt.error, verification: v }
      if (!v.owner_verified_at) v.owner_verified_at = nowIso
      const dns = await checkDnsPointing(host, { providerName: 'netlify' })
      v.last_dns = dns.ok ? 'ok' : dns.code
      if (!dns.ok) return { status: 'pending_dns', error: dns.error, verification: v }
      try {
        const { added } = await addAlias(host)
        if (added) delete v.alias_preexisting
        else if (!v.attached_at && !v.alias_inherited) v.alias_preexisting = true
      } catch (err) {
        if (err?.code === 'cap_reached') {
          return {
            status: 'failed',
            error: 'Alcanzamos el límite de dominios propios por ahora. Te contactaremos para activarlo.',
            verification: v,
            alert: `Límite de alias de Netlify alcanzado (${maxNetlifyAliases()}): migrar a Cloudflare for SaaS`,
          }
        }
        console.error('domains/netlify: addAlias', err?.message)
        return { status: 'pending_dns', error: 'Tu DNS ya apunta bien. Estamos terminando la configuración.', verification: v }
      }
      v.attached_at = nowIso
      v.dns_ok_at = nowIso
      if (await requestCertificate()) v.ssl_requested_at = nowIso
      return { status: 'pending_ssl', error: null, verification: v, providerId: host }
    }

    if (status === 'pending_ssl') {
      const https = await checkHttps(host)
      if (https.ok) {
        delete v.dns_lost_at
        v.last_https = 'ok'
        return { status: 'active', error: null, verification: v }
      }
      v.last_https = https.code
      const dns = await checkDnsPointing(host, { providerName: 'netlify' })
      v.last_dns = dns.ok ? 'ok' : dns.code
      const lastReq = v.ssl_requested_at ? Date.parse(v.ssl_requested_at) : 0
      if (dns.ok && (!lastReq || now.getTime() - lastReq > SSL_REQUEST_INTERVAL_MS)) {
        if (await requestCertificate()) v.ssl_requested_at = nowIso
      }
      return {
        status: 'pending_ssl',
        error: dns.ok ? null : dns.error,
        verification: v,
      }
    }

    if (status === 'active') {
      const dns = await checkDnsPointing(host, { providerName: 'netlify' })
      v.last_dns = dns.ok ? 'ok' : dns.code
      if (dns.ok) {
        delete v.dns_lost_at
        return { status: 'active', error: null, verification: v }
      }
      // Fallo transitorio de consulta: no cuenta como "dejó de apuntar"
      if (dns.code === 'lookup_failed') return { status: 'active', error: null, verification: v }
      const lostAt = v.dns_lost_at ? Date.parse(v.dns_lost_at) : now.getTime()
      if (!v.dns_lost_at) v.dns_lost_at = nowIso
      if (hoursBetween(lostAt, now.getTime()) >= DOMAIN_DNS_LOST_MAX_HOURS) {
        await removeAlias(host)
        v.detached_at = nowIso
        return {
          status: 'failed',
          error: `El dominio dejó de apuntar a AI Tickets por más de ${DOMAIN_DNS_LOST_MAX_HOURS} horas y lo desconectamos. Revisa el DNS y vuelve a conectarlo.`,
          verification: v,
        }
      }
      return { status: 'active', error: dns.error, verification: v }
    }

    return { status, error: site.domain_error || null, verification: v }
  },

  async removeDomain(site) {
    // Solo alias que agregó AI Tickets (el llamador ya lo filtra con aliasAttachedByUs; doble resguardo)
    if (!site?.custom_domain) return
    const v = site.domain_verification || {}
    if (!v.attached_at || v.alias_preexisting) return
    await removeAlias(site.custom_domain)
  },
}
