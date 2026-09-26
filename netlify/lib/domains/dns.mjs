// Verificación de DNS y HTTPS de dominios propios (node:dns + fetch). Nunca lanza.
import { Resolver } from 'node:dns/promises'
import {
  NETLIFY_APEX_IP,
  NETLIFY_EXTRA_CNAME_TARGETS,
  cnameTargetFor,
  verificationTxtHost,
  verificationTxtValue,
} from './validate.mjs'

const DNS_TIMEOUT_MS = 4000
const HTTPS_TIMEOUT_MS = 8000
const MAX_CNAME_HOPS = 5

// Resolutores públicos: evitan cachés locales largas y ven el cambio del productor antes.
function makeResolver() {
  const resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 2 })
  try {
    resolver.setServers(['1.1.1.1', '8.8.8.8'])
  } catch {
    /* entorno sin permiso para fijar servidores: usa los del sistema */
  }
  return resolver
}

async function tryResolve(fn) {
  try {
    return { records: await fn(), code: null }
  } catch (err) {
    return { records: [], code: err?.code || 'ERROR' }
  }
}

const norm = (h) => String(h || '').toLowerCase().replace(/\.$/, '')

// Rangos de proxy de Cloudflare más comunes: si el productor dejó la "nube naranja" activada.
const CLOUDFLARE_PREFIXES = ['104.16.', '104.17.', '104.18.', '104.19.', '104.20.', '104.21.', '172.64.', '172.65.', '172.66.', '172.67.', '188.114.']

/**
 * ¿El dominio apunta a nuestro sitio? CNAME (siguiendo la cadena) al destino, o A = IP de Netlify.
 * @returns {Promise<{ ok: boolean, via: 'cname'|'a'|null, cname: string[], a: string[], code: string|null, error: string|null }>}
 */
export async function checkDnsPointing(hostname, { providerName = 'netlify' } = {}) {
  const target = cnameTargetFor(providerName)
  const accepted = new Set([target, ...NETLIFY_EXTRA_CNAME_TARGETS].map(norm))
  const resolver = makeResolver()

  const chain = []
  let current = norm(hostname)
  for (let hop = 0; hop < MAX_CNAME_HOPS; hop++) {
    const { records } = await tryResolve(() => resolver.resolveCname(current))
    if (!records.length) break
    const next = norm(records[0])
    chain.push(next)
    if (accepted.has(next)) {
      return { ok: true, via: 'cname', cname: chain, a: [], code: null, error: null }
    }
    current = next
  }

  const { records: a, code } = await tryResolve(() => resolver.resolve4(norm(hostname)))
  if (!chain.length && a.length && a.every((ip) => ip === NETLIFY_APEX_IP)) {
    return { ok: true, via: 'a', cname: chain, a, code: null, error: null }
  }

  let error
  let resultCode
  if (!chain.length && a.includes(NETLIFY_APEX_IP)) {
    resultCode = 'mixed_a'
    error = `Además de ${NETLIFY_APEX_IP} hay otros registros A (${a.filter((ip) => ip !== NETLIFY_APEX_IP).slice(0, 2).join(', ')}). Bórralos.`
  } else if (chain.length) {
    resultCode = 'wrong_target'
    error = `El registro CNAME apunta a ${chain[0]} y debe apuntar a ${target}.`
  } else if (a.length) {
    const proxied = a.some((ip) => CLOUDFLARE_PREFIXES.some((p) => ip.startsWith(p)))
    resultCode = proxied ? 'proxied' : 'wrong_target'
    error = proxied
      ? 'Tu dominio pasa por el proxy de Cloudflare. Deja el registro en "Solo DNS" (nube gris).'
      : `El dominio apunta a ${a.slice(0, 2).join(', ')}. Revisa el registro indicado.`
  } else if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NXDOMAIN') {
    resultCode = 'not_found'
    error = 'Todavía no encontramos el registro DNS. Los cambios pueden tardar desde minutos hasta algunas horas.'
  } else {
    resultCode = 'lookup_failed'
    error = 'No pudimos consultar el DNS en este momento. Volveremos a intentarlo.'
  }
  return { ok: false, via: null, cname: chain, a, code: resultCode, error }
}

/**
 * ¿Está publicado el TXT de propiedad (_aitickets-verify.<host> = aitickets-verify=<token>)?
 * Sin esto no se agrega el alias: apuntar a la IP/CNAME compartidos de Netlify no prueba propiedad
 * (miles de sitios ajenos apuntan ahí, incluidos dominios "colgando" de sitios borrados).
 * @returns {Promise<{ ok: boolean, code: string|null, error: string|null }>}
 */
export async function checkOwnershipTxt(hostname, token) {
  if (!token) {
    return { ok: false, code: 'no_token', error: 'Falta el código de verificación del dominio. Desconéctalo y vuelve a conectarlo.' }
  }
  const txtHost = verificationTxtHost(norm(hostname))
  const expected = verificationTxtValue(token)
  const { records, code } = await tryResolve(() => makeResolver().resolveTxt(txtHost))
  const values = records.map((chunks) => (Array.isArray(chunks) ? chunks.join('') : String(chunks)).trim())
  if (values.includes(expected)) return { ok: true, code: null, error: null }
  if (values.some((v) => v.startsWith('aitickets-verify='))) {
    return { ok: false, code: 'txt_mismatch', error: `El registro TXT ${txtHost} tiene otro código. Debe ser ${expected}.` }
  }
  if (code && code !== 'ENOTFOUND' && code !== 'ENODATA' && code !== 'NXDOMAIN') {
    return { ok: false, code: 'lookup_failed', error: 'No pudimos consultar el DNS en este momento. Volveremos a intentarlo.' }
  }
  return {
    ok: false,
    code: 'txt_missing',
    error: `Falta el registro TXT ${txtHost} con el valor ${expected}. Los cambios pueden tardar desde minutos hasta algunas horas.`,
  }
}

/**
 * ¿El dominio responde por HTTPS con un certificado válido y desde Netlify?
 * @returns {Promise<{ ok: boolean, code: string|null, status?: number }>}
 */
export async function checkHttps(hostname) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTTPS_TIMEOUT_MS)
  try {
    const res = await fetch(`https://${norm(hostname)}/`, {
      method: 'HEAD',
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'user-agent': 'AITickets-DomainCheck/1.0' },
    })
    // Respondió con TLS válido. Confirmar que es Netlify (y no el hosting anterior del productor).
    const fromNetlify = !!res.headers.get('x-nf-request-id') || /netlify/i.test(res.headers.get('server') || '')
    return fromNetlify ? { ok: true, code: null, status: res.status } : { ok: false, code: 'not_netlify', status: res.status }
  } catch (err) {
    const cause = err?.cause?.code || err?.code || err?.name || 'ERROR'
    return { ok: false, code: /CERT|SSL|TLS|ERR_TLS|UNABLE_TO_VERIFY|SELF_SIGNED|ALTNAME/i.test(String(cause)) ? 'cert' : String(cause) }
  } finally {
    clearTimeout(timer)
  }
}
