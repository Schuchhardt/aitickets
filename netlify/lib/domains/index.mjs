// Dominios propios de los sitios de productores (aitickets_sites.custom_domain).
//
// Proveedor según DOMAIN_PROVIDER = netlify | cloudflare | none. Sin DOMAIN_PROVIDER: netlify si hay
// NETLIFY_AUTH_TOKEN, si no none (la solicitud queda pending_provider y se avisa por Slack).
//
// Interfaz de proveedor:
//   { name,
//     addDomain(hostname, { siteSlug }) → { providerId, status, records, error, verification },
//     checkDomain(site, now) → { status, error, verification, providerId?, alert? },
//     removeDomain(site) }
//
// Propiedad: cada (sitio, dominio) tiene un token (domainVerifyToken) que el productor publica como TXT en
// _aitickets-verify.<host>. Sin ese TXT el dominio nunca pasa de pending_dns (no se agrega el alias).
// Una reserva que no prosperó (failed, pendiente vencida, o pendiente cuyo dueño real publicó SU TXT)
// no bloquea a otro sitio: requestSiteDomain la libera.
//
// Máquina de estados (domain_status):
//   none → pending_provider (sin proveedor) | pending_dns → pending_ssl → active
//   pending_provider por más de 30 días → failed
//   pending_dns / pending_ssl por más de 7 días → failed
//   active sin DNS por más de 72 h → failed (alias quitado)
//   DELETE → removing → none
//
// Lo usan las rutas del dashboard (src/pages/api/sites/domain.ts) y el cron check-custom-domains.
// Todas las funciones reciben el cliente Supabase (service role) y un sitio YA autorizado por el llamador.
import { notifySlack } from '../slack.mjs'
import { sendEmail, isValidEmail, SITE_URL } from '../mailer.mjs'
import { renderDomainActiveEmail, renderDomainFailedEmail } from '../emails/index.mjs'
import { netlifyProvider, DomainProviderError } from './netlify.mjs'
import { cloudflareProvider } from './cloudflare.mjs'
import { noneProvider } from './none.mjs'
import { checkOwnershipTxt } from './dns.mjs'
import {
  normalizeDomainInput,
  dnsRecordsFor,
  DOMAIN_PENDING_MAX_DAYS,
  DOMAIN_PROVIDER_QUEUE_MAX_DAYS,
  PENDING_DOMAIN_STATUSES,
  domainVerifyToken,
  verificationTxtHost,
  verificationTxtValue,
} from './validate.mjs'

export { normalizeDomainInput, dnsRecordsFor, DomainProviderError, PENDING_DOMAIN_STATUSES, domainVerifyToken }
export { isApexDomain, cnameTargetFor, registrableDomain, NETLIFY_APEX_IP } from './validate.mjs'

export const SITE_DOMAIN_COLUMNS =
  'id, organization_id, slug, contact_email, custom_domain, domain_status, domain_provider, domain_provider_id, domain_verification, domain_error, domain_requested_at, domain_checked_at, domain_verified_at'

function env(name) {
  const v = globalThis.process?.env?.[name]
  return typeof v === 'string' ? v.trim() : ''
}

/** Proveedor configurado. Nunca lanza. */
export function getDomainProvider() {
  const requested = env('DOMAIN_PROVIDER').toLowerCase()
  const hasNetlifyToken = !!env('NETLIFY_AUTH_TOKEN')
  if (requested === 'none') return noneProvider
  if (requested === 'cloudflare') return cloudflareProvider
  if (requested === 'netlify') {
    if (!hasNetlifyToken) {
      console.warn('domains: DOMAIN_PROVIDER=netlify sin NETLIFY_AUTH_TOKEN; se usa "none"')
      return noneProvider
    }
    return netlifyProvider
  }
  return hasNetlifyToken ? netlifyProvider : noneProvider
}

/** Proveedor con el que se conectó el dominio (para quitarlo), si sigue configurado. */
function providerForSite(site) {
  const current = getDomainProvider()
  if (!site?.domain_provider || site.domain_provider === current.name) return current
  if (site.domain_provider === 'netlify' && env('NETLIFY_AUTH_TOKEN')) return netlifyProvider
  return current
}

function mainHosts() {
  return env('MAIN_HOSTS')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
}

/** Registros DNS para mostrar (los guardados o recalculados). */
export function recordsForSite(site) {
  if (!site?.custom_domain) return []
  const providerName = site.domain_provider && site.domain_provider !== 'none' ? site.domain_provider : 'netlify'
  const token = site?.domain_verification?.token
  if (token) return dnsRecordsFor(site.custom_domain, providerName, token)
  const saved = site?.domain_verification?.records
  if (Array.isArray(saved) && saved.length) return saved
  return dnsRecordsFor(site.custom_domain, providerName)
}

const DAY_MS = 86_400_000

/**
 * ¿La reserva de `other` sobre el dominio puede liberarse para el sitio que lo pide?
 * Nunca si está activa, esperando SSL (ya probó propiedad y tiene alias) o desconectándose.
 */
async function releasableReservation(other, hostname, requesterToken, now = Date.now()) {
  const status = other.domain_status
  if (status === 'failed' || status === 'none') return { ok: true, reason: status }
  if (status !== 'pending_dns' && status !== 'pending_provider') return { ok: false }
  const requestedAt = other.domain_requested_at ? Date.parse(other.domain_requested_at) : 0
  const maxDays = status === 'pending_provider' ? DOMAIN_PROVIDER_QUEUE_MAX_DAYS : DOMAIN_PENDING_MAX_DAYS
  if (!requestedAt || now - requestedAt > maxDays * DAY_MS) return { ok: true, reason: 'expired' }
  // Reserva reciente: se libera solo si quien la pide ya publicó SU TXT (prueba de propiedad)
  const txt = await checkOwnershipTxt(hostname, requesterToken)
  return txt.ok ? { ok: true, reason: 'owner_txt' } : { ok: false }
}

/** Libera la reserva de otro sitio (condicional: solo si sigue igual que cuando se leyó). */
async function releaseReservation(supabase, other, hostname) {
  const { data, error } = await supabase
    .from('aitickets_sites')
    .update({
      custom_domain: null,
      domain_status: 'none',
      domain_provider: null,
      domain_provider_id: null,
      domain_verification: null,
      domain_error: null,
      domain_requested_at: null,
      domain_checked_at: null,
      domain_verified_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', other.id)
    .eq('custom_domain', hostname)
    .eq('domain_status', other.domain_status)
    .select('id')
    .maybeSingle()
  if (error) {
    console.error('domains: error liberando reserva', error.message)
    return false
  }
  return !!data
}

/** Vista del dominio para el dashboard (sin datos internos del proveedor). */
export function domainView(site) {
  if (!site?.custom_domain) return { domain: null, status: 'none', records: [], error: null }
  const v = site.domain_verification || {}
  return {
    domain: site.custom_domain,
    status: site.domain_status,
    records: recordsForSite(site),
    error: site.domain_error || null,
    requestedAt: site.domain_requested_at || null,
    checkedAt: site.domain_checked_at || null,
    verifiedAt: site.domain_verified_at || null,
    dnsLostAt: v.dns_lost_at || null,
    url: site.domain_status === 'active' ? `https://${site.custom_domain}` : null,
  }
}

/**
 * ¿AI Tickets agregó el alias de este dominio en el proveedor (y sigue puesto)? Solo entonces se puede
 * quitar: un dominio en pending_dns/pending_provider nunca pasó por addAlias, y un alias que ya existía
 * antes (alias_preexisting) pertenece al dueño del sitio de Netlify. Quitarlo sin esta verificación
 * permitiría a un productor dar de baja cualquier alias del sitio pidiéndolo y desconectándolo.
 */
export function aliasAttachedByUs(site) {
  const v = site?.domain_verification || {}
  return !!v.attached_at && !v.alias_preexisting && !v.detached_at
}

async function updateSite(supabase, site, patch, { expectStatus } = {}) {
  let query = supabase
    .from('aitickets_sites')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', site.id)
    .eq('organization_id', site.organization_id)
  if (expectStatus) query = query.eq('domain_status', expectStatus)
  if (site.custom_domain && expectStatus) query = query.eq('custom_domain', site.custom_domain)
  return query.select(SITE_DOMAIN_COLUMNS).maybeSingle()
}

/**
 * El productor pide conectar un dominio.
 * @returns {Promise<{ ok: true, site: any } | { ok: false, httpStatus: number, error: string }>}
 */
export async function requestSiteDomain(supabase, site, rawDomain) {
  const parsed = normalizeDomainInput(rawDomain)
  if (!parsed.ok) return { ok: false, httpStatus: 400, error: parsed.error }
  const hostname = parsed.hostname
  if (mainHosts().includes(hostname)) {
    return { ok: false, httpStatus: 400, error: 'Ese dominio pertenece a AI Tickets. Usa un dominio de tu productora.' }
  }

  const current = site.custom_domain
  if (current && site.domain_status !== 'none') {
    if (current !== hostname) {
      return { ok: false, httpStatus: 409, error: `Primero desconecta el dominio actual (${current}).` }
    }
    if (site.domain_status !== 'failed') return { ok: true, site }
    // Mismo dominio fallido: reintentar desde cero
  }

  const token = domainVerifyToken(site.id, hostname)
  const { data: taken, error: takenError } = await supabase
    .from('aitickets_sites')
    .select('id, slug, custom_domain, domain_status, domain_requested_at, domain_verification')
    .eq('custom_domain', hostname)
    .neq('id', site.id)
    .limit(1)
  if (takenError) {
    console.error('domains: error verificando dominio', takenError.message)
    return { ok: false, httpStatus: 500, error: 'No pudimos verificar el dominio. Intenta de nuevo.' }
  }
  // Si la reserva liberada ya tenía el alias agregado por nosotros, el alias se hereda (sigue siendo nuestro)
  let inheritedAttach = false
  if (taken?.length) {
    const other = taken[0]
    inheritedAttach = aliasAttachedByUs(other)
    const release = await releasableReservation(other, hostname, token)
    if (!release.ok) {
      const pendingOther = other.domain_status === 'pending_dns' || other.domain_status === 'pending_provider'
      return {
        ok: false,
        httpStatus: 409,
        error: pendingOther
          ? `Otro sitio pidió este dominio y aún no lo verifica. Si el dominio es tuyo, crea un registro TXT en ${verificationTxtHost(hostname)} con el valor ${verificationTxtValue(token)} y vuelve a intentarlo.`
          : 'Ese dominio ya está conectado a otro sitio.',
      }
    }
    if (!(await releaseReservation(supabase, other, hostname))) {
      return { ok: false, httpStatus: 409, error: 'Ese dominio ya está conectado a otro sitio.' }
    }
    await notifySlack(`🌐 Reserva de ${hostname} liberada del sitio /o/${other.slug} (${other.domain_status}, ${release.reason}) para /o/${site.slug}`)
  }

  const provider = getDomainProvider()
  const nowIso = new Date().toISOString()
  const records = dnsRecordsFor(hostname, provider.name === 'cloudflare' ? 'cloudflare' : 'netlify', token)

  // 1) Reservar el dominio en la BD (UNIQUE) antes de llamar al proveedor
  const { data: reserved, error: reserveError } = await updateSite(supabase, site, {
    custom_domain: hostname,
    domain_status: 'pending_dns',
    domain_provider: provider.name,
    domain_provider_id: null,
    domain_verification: { token, records },
    domain_error: null,
    domain_requested_at: nowIso,
    domain_checked_at: null,
    domain_verified_at: null,
  })
  if (reserveError) {
    if (reserveError.code === '23505') return { ok: false, httpStatus: 409, error: 'Ese dominio ya está conectado a otro sitio.' }
    if (reserveError.code === '23514') return { ok: false, httpStatus: 400, error: 'El dominio no es válido.' }
    console.error('domains: error guardando dominio', reserveError.message)
    return { ok: false, httpStatus: 500, error: 'No pudimos guardar el dominio. Intenta de nuevo.' }
  }
  if (!reserved) return { ok: false, httpStatus: 404, error: 'Sitio no encontrado.' }

  // 2) Proveedor (verifica DNS antes de agregar el alias)
  let result
  try {
    result = await provider.addDomain(hostname, { siteSlug: site.slug, token })
  } catch (err) {
    if (err?.code === 'cap_reached') {
      await notifySlack(`⚠️ Límite de dominios propios alcanzado al conectar ${hostname} (sitio /o/${site.slug}). Migrar a Cloudflare for SaaS.`)
      result = {
        providerId: null,
        status: 'failed',
        records,
        error: 'Alcanzamos el límite de dominios propios por ahora. Te contactaremos para activarlo.',
        verification: {},
      }
    } else {
      console.error('domains: addDomain', err?.message || err)
      result = {
        providerId: null,
        status: 'pending_dns',
        records,
        error: 'Estamos terminando la configuración. Lo reintentaremos automáticamente.',
        verification: {},
      }
    }
  }

  const verification = { ...(result.verification || {}), token, records: result.records || records }
  if (inheritedAttach) {
    delete verification.alias_preexisting
    verification.alias_inherited = true
  }
  const { data: updated, error: updateError } = await updateSite(
    supabase,
    reserved,
    {
      domain_status: result.status,
      domain_provider_id: result.providerId || null,
      domain_verification: verification,
      domain_error: result.error || null,
      domain_checked_at: new Date().toISOString(),
    },
    { expectStatus: 'pending_dns' }
  )
  if (updateError) console.error('domains: error actualizando estado', updateError.message)
  return { ok: true, site: updated || { ...reserved, domain_status: result.status, domain_error: result.error || null } }
}

/**
 * Refresca el estado del dominio con el proveedor (lo llama el cron y el GET del dashboard).
 * Notifica por correo y Slack al pasar a active o failed (solo quien logró el cambio de estado).
 * @param {{ minIntervalMs?: number, now?: Date }} [opts]
 * @returns {Promise<{ site: any, changed: boolean, from: string, to: string }>}
 */
export async function refreshSiteDomain(supabase, site, { minIntervalMs = 0, now = new Date() } = {}) {
  const from = site?.domain_status || 'none'
  const unchanged = { site, changed: false, from, to: from }
  if (!site?.custom_domain || from === 'none' || from === 'failed') return unchanged
  if (from === 'removing') {
    const res = await removeSiteDomain(supabase, site)
    return { site: res.site || site, changed: res.ok, from, to: res.ok ? 'none' : 'removing' }
  }

  const provider = getDomainProvider()
  if (from === 'pending_provider' && (provider.name === 'none' || provider.name === 'cloudflare')) {
    // Sin proveedor la solicitud espera, pero no para siempre (no debe reservar el dominio indefinidamente)
    const requestedAt = site.domain_requested_at ? Date.parse(site.domain_requested_at) : 0
    if (requestedAt && now.getTime() - requestedAt <= DOMAIN_PROVIDER_QUEUE_MAX_DAYS * DAY_MS) return unchanged
    const { data: expired, error: expireError } = await updateSite(
      supabase,
      site,
      {
        domain_status: 'failed',
        domain_error: `No pudimos activar tu dominio en ${DOMAIN_PROVIDER_QUEUE_MAX_DAYS} días. Vuelve a conectarlo o escríbenos.`,
        domain_checked_at: now.toISOString(),
      },
      { expectStatus: from }
    )
    if (expireError || !expired) return unchanged
    await notifyDomainFailed(supabase, expired)
    return { site: expired, changed: true, from, to: 'failed' }
  }

  // Solicitudes anteriores al TXT de propiedad: asignarles su token (quedan en pending_dns hasta publicarlo)
  if (PENDING_DOMAIN_STATUSES.includes(from) && !site.domain_verification?.token) {
    site = { ...site, domain_verification: { ...(site.domain_verification || {}), token: domainVerifyToken(site.id, site.custom_domain) } }
  }
  if (minIntervalMs && site.domain_checked_at && now.getTime() - Date.parse(site.domain_checked_at) < minIntervalMs) {
    return unchanged
  }

  let result
  try {
    result = await provider.checkDomain(site, now)
  } catch (err) {
    console.error(`domains: checkDomain ${site.custom_domain}`, err?.message || err)
    result = { status: from, error: site.domain_error || null, verification: site.domain_verification || {} }
  }

  const verification = { ...(result.verification || {}) }
  if (!verification.token && site.domain_verification?.token) verification.token = site.domain_verification.token
  verification.records = recordsForSite({ ...site, domain_verification: verification })
  let status = result.status || from
  let error = result.error ?? null

  // Pendiente por más de 7 días → failed (quitando el alias si ya estaba agregado)
  // (el plazo corre desde que hay proveedor: al salir de pending_provider se reinicia)
  const fromProviderQueue = from === 'pending_provider'
  const requestedAt = site.domain_requested_at && !fromProviderQueue ? Date.parse(site.domain_requested_at) : now.getTime()
  const expired = now.getTime() - requestedAt > DOMAIN_PENDING_MAX_DAYS * DAY_MS
  if (expired && (status === 'pending_dns' || status === 'pending_ssl')) {
    if (aliasAttachedByUs({ domain_verification: verification })) {
      try {
        await providerForSite(site).removeDomain(site)
        verification.detached_at = now.toISOString()
      } catch (err) {
        console.error(`domains: no se pudo quitar ${site.custom_domain} tras 7 días`, err?.message)
      }
    }
    status = 'failed'
    error = `No pudimos verificar tu dominio en ${DOMAIN_PENDING_MAX_DAYS} días. Revisa el DNS y vuelve a conectarlo.`
  }

  /** @type {Record<string, any>} */
  const patch = {
    domain_status: status,
    domain_error: error,
    domain_verification: verification,
    domain_checked_at: now.toISOString(),
  }
  if (provider.name !== 'none' && site.domain_provider !== provider.name && status !== from) patch.domain_provider = provider.name
  if (fromProviderQueue && status !== from) patch.domain_requested_at = now.toISOString()
  if (result.providerId) patch.domain_provider_id = result.providerId
  if (status === 'active' && from !== 'active') patch.domain_verified_at = now.toISOString()

  const { data: updated, error: updateError } = await updateSite(supabase, site, patch, { expectStatus: from })
  if (updateError) {
    console.error('domains: error guardando estado', updateError.message)
    return unchanged
  }
  if (!updated) return unchanged // otro proceso cambió el estado primero

  const changed = status !== from
  if (changed && status === 'active') await notifyDomainActive(supabase, updated)
  if (changed && status === 'failed') await notifyDomainFailed(supabase, updated)
  if (result.alert) await notifySlack(`⚠️ ${result.alert} (dominio ${site.custom_domain})`)
  return { site: updated, changed, from, to: status }
}

/**
 * Desconecta el dominio: quita el alias en el proveedor y limpia las columnas. Si el proveedor falla,
 * queda en 'removing' (no se sirve) y el cron lo reintenta.
 * @returns {Promise<{ ok: boolean, site?: any, error?: string }>}
 */
export async function removeSiteDomain(supabase, site) {
  if (!site?.custom_domain) return { ok: true, site }
  if (site.domain_status !== 'removing') {
    const { data, error } = await updateSite(supabase, site, { domain_status: 'removing' })
    if (error || !data) {
      console.error('domains: no se pudo marcar removing', error?.message)
      return { ok: false, error: 'No pudimos desconectar el dominio. Intenta de nuevo.' }
    }
    site = data
  }
  try {
    // Solo se quita el alias si lo agregó AI Tickets; si no (pending_dns, alias previo del dueño del
    // sitio de Netlify, o ya desconectado), basta con limpiar la fila.
    if (aliasAttachedByUs(site)) await providerForSite(site).removeDomain(site)
  } catch (err) {
    console.error(`domains: removeDomain ${site.custom_domain}`, err?.message || err)
    return { ok: false, site, error: 'Estamos desconectando tu dominio. Lo terminaremos automáticamente.' }
  }
  const { data: cleared, error: clearError } = await updateSite(supabase, site, {
    custom_domain: null,
    domain_status: 'none',
    domain_provider: null,
    domain_provider_id: null,
    domain_verification: null,
    domain_error: null,
    domain_requested_at: null,
    domain_checked_at: null,
    domain_verified_at: null,
  })
  if (clearError) {
    console.error('domains: error limpiando dominio', clearError.message)
    return { ok: false, site, error: 'No pudimos desconectar el dominio. Intenta de nuevo.' }
  }
  return { ok: true, site: cleared }
}

// Solo direcciones probadas: organizations.email_verified_for (enlace de verificación del registro) o el
// contact_email del sitio (se guarda tras abrir su enlace de confirmación). Nunca organizations.email,
// que se edita sin verificar.
async function producerRecipient(supabase, site) {
  let { data: org, error } = await supabase
    .from('organizations')
    .select('public_name, email_verified_for')
    .eq('id', site.organization_id)
    .maybeSingle()
  if (error && /email_verified_for/.test(error.message || '')) {
    ;({ data: org } = await supabase.from('organizations').select('public_name').eq('id', site.organization_id).maybeSingle())
  }
  const to = [org?.email_verified_for, site.contact_email].find((e) => e && isValidEmail(e)) || null
  return { to, orgName: org?.public_name || site.slug }
}

async function notifyDomainActive(supabase, site) {
  const host = site.custom_domain
  await notifySlack(`✅ Dominio activo: https://${host} → sitio /o/${site.slug}`)
  try {
    const { to, orgName } = await producerRecipient(supabase, site)
    if (!to) return
    const email = await renderDomainActiveEmail({ host, orgName, dashboardUrl: `${SITE_URL}/dashboard/sitio` })
    await sendEmail({ to, subject: email.subject, html: email.html, text: email.text, tags: ['site-domain'] })
  } catch (err) {
    console.error('domains: no se pudo enviar el correo de dominio activo', err?.message)
  }
}

async function notifyDomainFailed(supabase, site) {
  const host = site.custom_domain
  await notifySlack(`❌ Dominio fallido: ${host} (sitio /o/${site.slug}): ${site.domain_error || 'sin detalle'}`)
  try {
    const { to, orgName } = await producerRecipient(supabase, site)
    if (!to) return
    const email = await renderDomainFailedEmail({
      host,
      orgName,
      error: site.domain_error || 'No pudimos verificar tu dominio.',
      siteUrl: `${SITE_URL}/o/${encodeURIComponent(site.slug || '')}`,
      dashboardUrl: `${SITE_URL}/dashboard/sitio`,
    })
    await sendEmail({ to, subject: email.subject, html: email.html, text: email.text, tags: ['site-domain'] })
  } catch (err) {
    console.error('domains: no se pudo enviar el correo de dominio fallido', err?.message)
  }
}
