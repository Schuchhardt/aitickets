// Exportación de leads de Passline a CSV (para contactar a mano desde Gmail).
import { emailDomain, isFreeMailDomain, leadDomainFor, normalizeEmail, registrableDomain } from '../outreach/domains.mjs'

export const CSV_COLUMNS = Object.freeze([
  'prioridad', 'nombre', 'tipo', 'ciudad', 'eventos_passline', 'ultimo_evento', 'fecha_ultimo_evento',
  'url_evento_passline', 'web', 'instagram', 'email', 'whatsapp', 'fuentes', 'estado', 'notas',
])

const ICP_TOP = ['stand_up', 'comedia', 'teatro']
const ICP_MID = ['musica']
const DAY = 86_400_000

function dateOnlyMs(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(String(value))) return null
  const ms = Date.parse(`${String(value).slice(0, 10)}T12:00:00Z`)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Puntaje 0-100 = recencia (40) + frecuencia (30) + categoría ICP (30).
 * - Recencia: evento próximo en ≤60 días = 40; más lejano = 25; pasado ≤30 días = 25; ≤90 días = 10.
 *   Sin fecha: visto en la búsqueda en los últimos 14 días = 20.
 * - Frecuencia: 5 por evento distinto en Passline (máx. 6 eventos).
 * - ICP: stand-up/comedia/teatro = 30; música en vivo = 15; otro = 5.
 */
export function leadPriority(lead, now = new Date()) {
  const today = dateOnlyMs(now.toISOString())
  let recency = 0
  const eventMs = dateOnlyMs(lead.last_passline_event?.date)
  if (eventMs != null) {
    const days = Math.round((eventMs - today) / DAY)
    if (days >= 0) recency = days <= 60 ? 40 : 25
    else if (days >= -30) recency = 25
    else if (days >= -90) recency = 10
  } else if (lead.last_seen_event_at && now.getTime() - Date.parse(lead.last_seen_event_at) <= 14 * DAY) {
    recency = 20
  }
  const frequency = Math.min(Number(lead.events_on_passline) || 0, 6) * 5
  const cats = Array.isArray(lead.categories) ? lead.categories : []
  const icp = cats.some((c) => ICP_TOP.includes(c)) ? 30 : cats.some((c) => ICP_MID.includes(c)) ? 15 : 5
  return Math.min(100, recency + frequency + icp)
}

export function csvCell(value) {
  if (value === null || value === undefined) return ''
  let s = Array.isArray(value) ? value.join(' | ') : String(value)
  // Evita inyección de fórmulas al abrir el CSV en Sheets/Excel.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const TYPE_LABEL = { producer: 'productora', venue: 'recinto' }

/** Fila del CSV a partir de una fila de aitickets_leads (o de un lead del plan de dry-run). */
export function leadToCsvRow(lead, now = new Date()) {
  const ev = lead.last_passline_event || {}
  const sources = new Set()
  for (const s of Array.isArray(lead.contact_sources) ? lead.contact_sources : []) if (s?.url) sources.add(s.url)
  if (lead.email_source_url) sources.add(lead.email_source_url)
  const notes = [lead.notes, lead.categories?.length ? `categorías: ${lead.categories.join(', ')}` : null].filter(Boolean).join(' · ')
  return {
    prioridad: leadPriority(lead, now),
    nombre: lead.org_name || '',
    tipo: TYPE_LABEL[lead.lead_type] || lead.lead_type || '',
    ciudad: lead.city || '',
    eventos_passline: Number(lead.events_on_passline) || 0,
    ultimo_evento: ev.title || '',
    fecha_ultimo_evento: ev.date || '',
    url_evento_passline: ev.url || '',
    web: lead.website || '',
    instagram: lead.instagram ? `https://www.instagram.com/${lead.instagram}/` : '',
    email: lead.email || '',
    whatsapp: lead.whatsapp ? `+${String(lead.whatsapp).replace(/\D/g, '')}` : '',
    fuentes: [...sources],
    estado: lead.status || '',
    notas: notes,
  }
}

/** CSV completo (encabezado + filas ordenadas por prioridad descendente). */
export function buildLeadsCsv(leads, now = new Date()) {
  const rows = (leads || []).map((l) => leadToCsvRow(l, now))
  rows.sort((a, b) => b.prioridad - a.prioridad || b.eventos_passline - a.eventos_passline || a.nombre.localeCompare(b.nombre, 'es'))
  const lines = [CSV_COLUMNS.join(',')]
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => csvCell(r[c])).join(','))
  return `${lines.join('\n')}\n`
}

export const HIDDEN_STATUSES = Object.freeze(['suppressed', 'invalid'])

function leadContactKeys(lead) {
  const email = normalizeEmail(lead.email) || null
  const domain = (lead.domain || leadDomainFor({ website: lead.website, email }) || '').toLowerCase() || null
  return { email, domain }
}

/**
 * Segundo filtro antes de escribir el CSV (se contacta a mano: cualquier error aquí es un correo no deseado).
 * Quita un lead si:
 *   - su status es suppressed/invalid;
 *   - su dominio o correo está en aitickets_suppressions (`suppressions`: filas {email, domain});
 *   - otro lead (`otherLeads`: filas {id, name_key, domain, email, status}) con status distinto de 'invalid' ya
 *     tiene ese dominio o correo (está en outreach automático, contactado, perdido o convertido).
 * Devuelve {leads, skipped: [{org_name, reason}]}.
 */
export function filterExportableLeads(leads, { suppressions = [], otherLeads = [] } = {}) {
  const supEmails = new Set()
  const supDomains = new Set()
  for (const r of suppressions) {
    const e = normalizeEmail(r?.email)
    if (e) supEmails.add(e)
    else if (r?.domain) supDomains.add(String(r.domain).toLowerCase())
  }
  const byDomain = new Map()
  const byEmail = new Map()
  for (const o of otherLeads) {
    if (!o || o.status === 'invalid') continue
    if (o.domain) byDomain.set(String(o.domain).toLowerCase(), [...(byDomain.get(String(o.domain).toLowerCase()) || []), o])
    const e = normalizeEmail(o.email)
    if (e) byEmail.set(e, [...(byEmail.get(e) || []), o])
  }
  const isOther = (lead) => (o) => o.id !== lead.id && !(lead.name_key && o.name_key === lead.name_key)
  const out = []
  const skipped = []
  for (const lead of leads || []) {
    const { email, domain } = leadContactKeys(lead)
    const emailDom = email ? registrableDomain(emailDomain(email)) : ''
    let reason = null
    if (HIDDEN_STATUSES.includes(lead.status)) reason = `estado ${lead.status}`
    else if (email && supEmails.has(email)) reason = 'correo en lista de supresión'
    else if (domain && supDomains.has(domain)) reason = 'dominio en lista de supresión'
    else if (emailDom && !isFreeMailDomain(emailDom) && supDomains.has(emailDom)) reason = 'dominio del correo en lista de supresión'
    else {
      const dup = (domain && (byDomain.get(domain) || []).find(isOther(lead))) || (email && (byEmail.get(email) || []).find(isOther(lead)))
      if (dup) reason = `ya existe otro lead con ese dominio/correo (${dup.status})`
    }
    if (reason) skipped.push({ org_name: lead.org_name || '', reason })
    else out.push(lead)
  }
  return { leads: out, skipped }
}
