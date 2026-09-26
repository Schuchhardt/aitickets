// Fuentes con consentimiento: formulario de /web-gratis (inbound_form) e importación CSV (csv_import).
import { emailDomain, isFreeMailDomain, isOwnedSiteUrl, normalizeEmail, registrableDomain } from '../domains.mjs'

const clip = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)

// ---------- doble opt-in ----------
// El formulario NO verifica el correo: cualquiera puede escribir el de un tercero. Por eso el envío solo
// guarda una solicitud pendiente (aitickets_outreach_events type 'inbound_pending') y se manda un enlace
// firmado al correo ingresado. El consentimiento, el lead y el token de registro se aplican SOLO cuando
// la persona confirma desde su bandeja (confirmInboundPending).

const PENDING_TYPE = 'inbound_pending'
const CONFIRMED_TYPE = 'inbound_confirmed'

/** Guarda la solicitud del formulario sin tocar ningún lead. Devuelve el id de la solicitud. */
export async function createInboundPending(supabase, form) {
  const e = normalizeEmail(form?.email)
  if (!e) throw new Error('email_invalid')
  const payload = {
    email: e,
    orgName: clip(form.orgName, 200),
    contactName: clip(form.contactName, 120),
    phone: clip(form.phone, 40),
    website: clip(form.website, 300),
    city: clip(form.city, 120),
    eventName: clip(form.eventName, 200),
    message: clip(form.message, 1000),
    ip: form.ip || null,
    submitted_at: new Date().toISOString(),
  }
  const { data, error } = await supabase.from('aitickets_outreach_events').insert({ type: PENDING_TYPE, payload }).select('id').single()
  if (error) throw new Error(`inbound pending: ${error.message}`)
  return String(data.id)
}

/**
 * Aplica una solicitud confirmada desde el enlace del correo (idempotente).
 * @returns {Promise<{leadId: string, created: boolean, domainConflict: boolean, alreadyConfirmed?: boolean} | null>}
 *   null si la solicitud no existe o no corresponde al email del token.
 */
export async function confirmInboundPending(supabase, { pendingId, email }) {
  const e = normalizeEmail(email)
  if (!e || !pendingId) return null
  const { data: row, error } = await supabase.from('aitickets_outreach_events').select('id, type, payload').eq('id', pendingId).maybeSingle()
  if (error) throw new Error(`inbound pending: ${error.message}`)
  if (!row || normalizeEmail(row.payload?.email) !== e) return null
  if (row.type === CONFIRMED_TYPE) {
    const { data: lead } = await supabase.from('aitickets_leads').select('id').eq('email', e).maybeSingle()
    return lead ? { leadId: lead.id, created: false, domainConflict: false, alreadyConfirmed: true } : null
  }
  if (row.type !== PENDING_TYPE) return null
  // Reclamo atómico: dos clics simultáneos no aplican la solicitud dos veces.
  const { data: claimed, error: claimErr } = await supabase
    .from('aitickets_outreach_events')
    .update({ type: CONFIRMED_TYPE, payload: { ...row.payload, confirmed_at: new Date().toISOString() } })
    .eq('id', row.id)
    .eq('type', PENDING_TYPE)
    .select('id')
  if (claimErr) throw new Error(`inbound confirm: ${claimErr.message}`)
  if (!claimed?.length) return confirmInboundPending(supabase, { pendingId, email })
  try {
    return await createInboundLead(supabase, { ...row.payload, email: e })
  } catch (err) {
    // Se libera para que un nuevo clic lo reintente.
    await supabase.from('aitickets_outreach_events').update({ type: PENDING_TYPE, payload: row.payload }).eq('id', row.id)
    throw err
  }
}

/**
 * Crea (o actualiza) un lead desde el formulario /web-gratis, SOLO después de que la persona confirmó su
 * correo (confirmInboundPending). Pidió que la contactemos:
 * consent_at = ahora, lawful_basis = 'consent', status = 'interested' (no entra a la secuencia en frío).
 * Nunca cambia el estado de un lead 'converted' ni 'suppressed' (la supresión solo se levanta a mano).
 *
 * Seguridad: el sitio web que escribe la persona NO está verificado. Por eso:
 * - Solo se reutiliza un lead existente si su email es EXACTAMENTE el enviado (nunca por dominio): así no
 *   se marca consentimiento en el registro de un tercero ni se devuelve un token para un lead ajeno.
 * - El dominio solo se asigna al lead nuevo si coincide con el dominio corporativo del correo (o si no se
 *   indicó sitio). Si otro lead ya tiene ese dominio se crea un lead separado sin dominio y se marca
 *   domainConflict para revisión humana.
 * Devuelve {leadId, created, domainConflict}. leadId siempre corresponde a un lead con email === el enviado.
 */
export async function createInboundLead(supabase, { orgName, contactName, email, phone, website, city, eventName, message, ip }) {
  const e = normalizeEmail(email)
  if (!e) throw new Error('email_invalid')
  const site = website && isOwnedSiteUrl(website) ? String(website).trim() : null
  const siteDomain = site ? registrableDomain(site) : ''
  const mailDomain = registrableDomain(emailDomain(e))
  const corporateMail = mailDomain && !isFreeMailDomain(mailDomain) ? mailDomain : ''
  // Dominio "respaldado" por el correo: el del correo corporativo, y solo si el sitio (si lo hay) coincide.
  const claimedDomain = corporateMail && (!siteDomain || siteDomain === corporateMail) ? corporateMail : null
  const now = new Date().toISOString()
  const ref = { source: 'inbound_form', seen_at: now, contact_name: clip(contactName, 120), phone: clip(phone, 40), message: clip(message, 1000), ip_hash: ip || null, website: site ? clip(site, 300) : null }
  const info = {
    org_name: clip(orgName, 200),
    website: site ? (/^https?:\/\//i.test(site) ? site : `https://${site}`) : null,
    city: clip(city, 120),
    upcoming_event: clip(eventName, 200) ? { name: clip(eventName, 200), source: 'inbound_form' } : null,
  }
  const consent = { consent_at: now, lawful_basis: 'consent', status: 'interested', next_action_at: null, updated_at: now }

  const { data: existing, error: findErr } = await supabase
    .from('aitickets_leads')
    .select('id, source_refs, status, org_name, website, city, upcoming_event')
    .eq('email', e)
    .maybeSingle()
  if (findErr) throw new Error(`lead lookup: ${findErr.message}`)
  if (existing) {
    const refs = Array.isArray(existing.source_refs) ? existing.source_refs : []
    const patch = { ...consent, source_refs: [...refs, ref].slice(-20) }
    if (existing.status === 'converted' || existing.status === 'suppressed') delete patch.status
    // Datos de la organización: solo se completan los vacíos (el formulario no está verificado).
    for (const [k, v] of Object.entries(info)) if (v !== null && (existing[k] === null || existing[k] === undefined || existing[k] === '')) patch[k] = v
    const { error } = await supabase.from('aitickets_leads').update(patch).eq('id', existing.id)
    if (error) throw new Error(`lead update: ${error.message}`)
    return { leadId: existing.id, created: false, domainConflict: false }
  }

  let domain = claimedDomain
  let domainConflict = false
  const conflictDomain = claimedDomain || siteDomain || null
  if (conflictDomain) {
    const { data: other } = await supabase.from('aitickets_leads').select('id').eq('domain', conflictDomain).limit(1).maybeSingle()
    if (other) {
      domainConflict = true
      domain = null
      ref.domain_conflict_lead_id = other.id
    }
  }
  const { data, error } = await supabase
    .from('aitickets_leads')
    .insert({ ...info, ...consent, email: e, email_type: 'personal', email_source_url: 'inbound_form', email_found_at: now, domain, source: 'inbound_form', source_refs: [ref] })
    .select('id')
    .single()
  if (error) throw new Error(`lead insert: ${error.message}`)
  return { leadId: data.id, created: true, domainConflict }
}

/** Parser CSV mínimo (comillas dobles, comas, saltos de línea dentro de comillas). */
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const s = String(text || '').replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',' || ch === ';') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((f) => f.trim())) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some((f) => f.trim())) rows.push(row)
  if (!rows.length) return []
  const header = rows[0].map((h) => h.trim().toLowerCase())
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])))
}

/**
 * Normaliza una fila CSV a candidato. Columnas: org_name, website, email?, city?, country?, source_url
 * (obligatoria: dónde se encontró el dato), event_name?, event_date?, event_venue?.
 * Devuelve {candidate} o {error}.
 */
export function csvRowToCandidate(r) {
  const sourceUrl = clip(r.source_url, 500)
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) return { error: 'source_url obligatoria (http/https)' }
  const website = clip(r.website, 300)
  if (!website || !isOwnedSiteUrl(website)) return { error: 'website propio obligatorio' }
  const domain = registrableDomain(website)
  const country = (clip(r.country, 2) || 'CL').toUpperCase()
  return {
    candidate: {
      org_name: clip(r.org_name, 200),
      website: /^https?:\/\//i.test(website) ? website : `https://${website}`,
      domain,
      email: normalizeEmail(r.email) || null,
      email_source_url: sourceUrl,
      city: clip(r.city, 120),
      country: /^[A-Z]{2}$/.test(country) ? country : 'CL',
      upcoming_event: clip(r.event_name, 200)
        ? { name: clip(r.event_name, 200), date: clip(r.event_date, 10), venue: clip(r.event_venue, 200), source: 'csv_import' }
        : null,
      source_ref: { source: 'csv_import', url: sourceUrl, seen_at: new Date().toISOString() },
    },
  }
}
