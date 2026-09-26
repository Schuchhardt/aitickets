// Validación y normalización de dominios propios de productores (sin dependencias ni red; seguro para tests).
import { isIP } from 'node:net'
import { createHmac } from 'node:crypto'

/** IP del balanceador de Netlify para dominios raíz (apex) con DNS externo. */
export const NETLIFY_APEX_IP = '75.2.60.5'
/** Destinos CNAME aceptados además de SITES_CNAME_TARGET (ALIAS/ANAME de Netlify para apex). */
export const NETLIFY_EXTRA_CNAME_TARGETS = ['apex-loadbalancer.netlify.com']

/** Sufijos de segundo nivel donde el dominio registrable tiene 3 etiquetas ("productora.com.ar"). */
const SECOND_LEVEL = new Set([
  'com.ar', 'com.br', 'com.mx', 'com.pe', 'com.co', 'com.uy', 'com.py', 'com.bo', 'com.ec', 'com.ve',
  'com.es', 'org.ar', 'org.mx', 'org.pe', 'org.co', 'gob.cl', 'gob.ar', 'gob.mx', 'gob.pe', 'gov.co',
  'edu.ar', 'edu.pe', 'edu.co', 'co.uk', 'org.uk', 'com.au', 'net.ar', 'net.pe', 'net.co',
])

/** Hosts de plataformas que nunca pueden ser el dominio propio de un productor. */
const BLOCKED_SUFFIXES = [
  'netlify.app', 'netlify.com', 'netlify.live', 'vercel.app', 'vercel.com', 'pages.dev', 'workers.dev',
  'github.io', 'herokuapp.com', 'supabase.co', 'supabase.in', 'localhost', 'local', 'internal', 'test',
  'example', 'invalid', 'example.com', 'example.org', 'example.net',
]

function env(name) {
  const v = globalThis.process?.env?.[name]
  return typeof v === 'string' ? v.trim() : ''
}

/** Dominio raíz de la plataforma (aitickets.cl por defecto). */
export function sitesRootDomain() {
  return (env('SITES_ROOT_DOMAIN') || 'aitickets.cl').toLowerCase()
}

/** Límite de dominios propios (alias de Netlify recomienda máx. 50 por sitio). */
export function maxNetlifyAliases() {
  const n = Number.parseInt(env('SITES_MAX_NETLIFY_ALIASES') || '50', 10)
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100) : 50
}

/** Destino CNAME que el productor debe configurar. */
export function cnameTargetFor(providerName) {
  const custom = env('SITES_CNAME_TARGET').toLowerCase().replace(/\.$/, '')
  if (custom) return custom
  return providerName === 'cloudflare' ? `sites.${sitesRootDomain()}` : 'aitickets.netlify.app'
}

/** Dominio registrable aproximado: "entradas.productora.cl" → "productora.cl". */
export function registrableDomain(hostname) {
  const parts = String(hostname || '').split('.').filter(Boolean)
  if (parts.length <= 2) return parts.join('.')
  const lastTwo = parts.slice(-2).join('.')
  return SECOND_LEVEL.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo
}

/** true si el host es el dominio raíz (apex), p. ej. "productora.cl" (no "www.productora.cl"). */
export function isApexDomain(hostname) {
  return registrableDomain(hostname) === hostname
}

/**
 * Normaliza lo que escribe el productor ("https://Entradas.Ñandú.cl/eventos" → "entradas.xn--and-6ma2c.cl")
 * y rechaza lo que no puede ser un dominio propio.
 * @returns {{ ok: true, hostname: string, apex: boolean } | { ok: false, error: string }}
 */
export function normalizeDomainInput(input) {
  let raw = String(input ?? '').trim().toLowerCase()
  if (!raw) return { ok: false, error: 'Escribe tu dominio, por ejemplo entradas.tuproductora.cl.' }
  if (raw.length > 300) return { ok: false, error: 'El dominio es demasiado largo.' }
  raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  if (/[\s@]/.test(raw)) return { ok: false, error: 'Escribe solo el dominio, sin espacios ni correos.' }

  let hostname
  try {
    // WHATWG URL convierte a minúsculas y a punycode (IDN) y elimina ruta, puerto y query
    const url = new URL(`https://${raw}`)
    if (url.username || url.password) return { ok: false, error: 'Escribe solo el dominio.' }
    hostname = url.hostname.replace(/\.$/, '')
  } catch {
    return { ok: false, error: 'El dominio no es válido.' }
  }

  if (!hostname || hostname.length > 253) return { ok: false, error: 'El dominio no es válido.' }
  if (hostname.startsWith('[') || isIP(hostname)) {
    return { ok: false, error: 'Usa un dominio, no una dirección IP.' }
  }
  const labels = hostname.split('.')
  if (labels.length < 2) return { ok: false, error: 'El dominio debe incluir la extensión, por ejemplo .cl o .com.' }
  const labelRe = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/
  if (!labels.every((l) => labelRe.test(l))) return { ok: false, error: 'El dominio tiene caracteres no válidos.' }
  const tld = labels[labels.length - 1]
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld)) return { ok: false, error: 'La extensión del dominio no es válida.' }
  if (hostname.startsWith('*')) return { ok: false, error: 'No se aceptan dominios comodín.' }

  const root = sitesRootDomain()
  const own = new Set([root, 'aitickets.cl'])
  for (const d of own) {
    if (hostname === d || hostname.endsWith(`.${d}`)) {
      return { ok: false, error: 'Ese dominio pertenece a AI Tickets. Usa un dominio de tu productora.' }
    }
  }
  if (BLOCKED_SUFFIXES.some((s) => hostname === s || hostname.endsWith(`.${s}`))) {
    return { ok: false, error: 'Ese dominio no se puede conectar. Usa un dominio propio de tu productora.' }
  }
  if (SECOND_LEVEL.has(hostname)) return { ok: false, error: 'El dominio no es válido.' }

  return { ok: true, hostname, apex: isApexDomain(hostname) }
}

/** Prefijo del registro TXT de propiedad: _aitickets-verify.<host>. */
export const DOMAIN_VERIFY_TXT_PREFIX = '_aitickets-verify'

/** Host del registro TXT de propiedad. */
export function verificationTxtHost(hostname) {
  return `${DOMAIN_VERIFY_TXT_PREFIX}.${hostname}`
}

/** Valor esperado del registro TXT de propiedad. */
export function verificationTxtValue(token) {
  return `aitickets-verify=${token}`
}

/**
 * Token de propiedad del dominio, determinístico por (sitio, dominio): el mismo sitio ve siempre el mismo
 * TXT (aunque vuelva a pedir el dominio) y el TXT de un sitio nunca sirve para otro. La prueba de
 * propiedad es que quien controla el DNS lo publicó; el secreto solo evita que se calcule desde afuera.
 */
export function domainVerifyToken(siteId, hostname) {
  const key = env('DOMAIN_VERIFY_SECRET') || env('INTERNAL_API_SECRET') || 'aitickets-domain-verify'
  return createHmac('sha256', `aitickets-domain-verify|${key}`)
    .update(`${siteId}|${String(hostname || '').toLowerCase()}`)
    .digest('hex')
    .slice(0, 32)
}

/**
 * Registros DNS que el productor debe crear en su proveedor de DNS.
 * Subdominio (recomendado): CNAME al destino. Apex: A a la IP de Netlify (o ALIAS/ANAME si su DNS lo permite).
 * Con `token`, se agrega el TXT de propiedad (_aitickets-verify.<host>), obligatorio para activar.
 * @returns {{ type: string, name: string, value: string, host: string, note?: string }[]}
 */
export function dnsRecordsFor(hostname, providerName = 'netlify', token = null) {
  const records = pointingRecordsFor(hostname, providerName)
  if (token) {
    const zone = registrableDomain(hostname)
    const name = hostname === zone ? DOMAIN_VERIFY_TXT_PREFIX : `${DOMAIN_VERIFY_TXT_PREFIX}.${hostname.slice(0, -(zone.length + 1))}`
    records.push({
      type: 'TXT',
      name,
      value: verificationTxtValue(token),
      host: verificationTxtHost(hostname),
      note: 'Prueba que el dominio es tuyo. No lo borres mientras uses el dominio.',
    })
  }
  return records
}

function pointingRecordsFor(hostname, providerName) {
  const target = cnameTargetFor(providerName)
  const zone = registrableDomain(hostname)
  const name = hostname === zone ? '@' : hostname.slice(0, -(zone.length + 1))
  if (hostname === zone) {
    if (providerName === 'cloudflare') {
      return [
        {
          type: 'CNAME',
          name: '@',
          value: target,
          host: hostname,
          note: 'Solo si tu DNS permite CNAME/ALIAS en la raíz. Si no, usa www o entradas.',
        },
      ]
    }
    return [
      { type: 'A', name: '@', value: NETLIFY_APEX_IP, host: hostname, note: 'Borra otros registros A o AAAA de la raíz.' },
    ]
  }
  return [{ type: 'CNAME', name, value: target, host: hostname }]
}

/** Estados en que el dominio aún se está conectando. */
export const PENDING_DOMAIN_STATUSES = ['pending_provider', 'pending_dns', 'pending_ssl']
/** Días que esperamos la configuración antes de marcar el dominio como fallido. */
export const DOMAIN_PENDING_MAX_DAYS = 7
/** Días que una solicitud puede esperar sin proveedor configurado (pending_provider) antes de fallar. */
export const DOMAIN_PROVIDER_QUEUE_MAX_DAYS = 30
/** Horas que toleramos que un dominio activo deje de apuntar antes de desconectarlo. */
export const DOMAIN_DNS_LOST_MAX_HOURS = 72
