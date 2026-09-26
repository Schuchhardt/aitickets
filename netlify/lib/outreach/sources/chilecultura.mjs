// Fuente: API pública de Chile Cultura (Ministerio de las Culturas), sin autenticación.
// Verificada el 2026-09-26: GET https://chilecultura.gob.cl/api/v1.0/eventos/search?page=N
// → {total_count, page_count, next, results:[{id, free, name, institution, permalink, url, commune,
//    region, venue_name, start_date, end_date, main_discipline, ...}]}.
// Nota: el WAF del sitio responde 403 a User-Agents que contienen "bot"; para esta API usamos un
// User-Agent identificable con contacto (sin "bot"). El crawler de sitios de productores sí usa
// AITicketsBot y respeta robots.txt.
//
// Se toman solo eventos pagados (free=false), se agrupan por institución y el dominio del permalink es
// el sitio candidato. Si el permalink apunta a una ticketera o red social, se registra la ticketera y
// se descarta (no tenemos sitio propio que enriquecer).
import { isGovernmentOrEducationDomain, isOwnedSiteUrl, registrableDomain, ticketingPlatformOf } from '../domains.mjs'

export const key = 'chilecultura'
const API = 'https://chilecultura.gob.cl/api/v1.0/eventos/search'
const USER_AGENT = 'AITickets-Leads/1.0 (+https://aitickets.cl; contacto@aitickets.cl)'
const MAX_PAGES = 10

// Instituciones públicas o educativas: no son prospectos.
const PUBLIC_INSTITUTION_RE = /\b(universidad|municipal|municipalidad|ministerio|gobierno|seremi|museo|biblioteca|escuela|colegio|liceo|servicio nacional|corporaci[oó]n municipal|intendencia|delegaci[oó]n|fuerza a[eé]rea|ej[eé]rcito|armada|carabineros|junta de vecinos)\b/i

function isBetterEvent(candidate, current, today) {
  const c = candidate.date || ''
  const k = current.date || ''
  const cFuture = c >= today
  const kFuture = k >= today
  if (cFuture !== kFuture) return cFuture
  return cFuture ? c < k : c > k
}

async function fetchPage(page) {
  const res = await fetch(`${API}?page=${page}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Chile Cultura respondió ${res.status}`)
  return res.json()
}

/**
 * Descarga los eventos y devuelve candidatos {org_name, website, domain, city, categories, upcoming_event,
 * source_ref, current_ticketing}. No escribe en la BD (lo hace sources/index.mjs).
 */
export async function discover({ maxCandidates = 60 } = {}) {
  const today = new Date().toISOString().slice(0, 10)
  const byInstitution = new Map()
  const stats = { pages: 0, events: 0, paid: 0, noOwnSite: 0, publicInstitution: 0 }
  let page = 1
  let pageCount = 1
  do {
    const data = await fetchPage(page)
    stats.pages++
    pageCount = Math.min(Number(data?.page_count) || 1, MAX_PAGES)
    for (const ev of data?.results || []) {
      stats.events++
      if (ev?.free !== false || !ev.institution) continue
      stats.paid++
      const institution = String(ev.institution).trim()
      if (PUBLIC_INSTITUTION_RE.test(institution)) { stats.publicInstitution++; continue }
      const permalink = typeof ev.permalink === 'string' ? ev.permalink.trim() : ''
      const platform = permalink ? ticketingPlatformOf(permalink) : null
      if (!permalink || !isOwnedSiteUrl(permalink)) { stats.noOwnSite++; continue }
      const domain = registrableDomain(permalink)
      if (!domain || isGovernmentOrEducationDomain(domain)) { stats.publicInstitution++; continue }
      const upcoming = {
        name: String(ev.name || '').slice(0, 200),
        date: ev.start_date || null,
        end_date: ev.end_date || null,
        venue: ev.venue_name || null,
        url: permalink,
        source_url: ev.url || null,
        source: key,
      }
      const existing = byInstitution.get(domain)
      // Nos quedamos con el próximo evento de cada institución (el más cercano que aún no empieza).
      if (existing && !isBetterEvent(upcoming, existing.upcoming_event, today)) continue
      byInstitution.set(domain, {
        org_name: institution.slice(0, 200),
        website: new URL(permalink).origin,
        domain,
        city: ev.commune || null,
        categories: ev.main_discipline ? [String(ev.main_discipline)] : [],
        current_ticketing: platform,
        upcoming_event: upcoming,
        source_ref: { source: key, url: ev.url || permalink, event_id: ev.id, seen_at: new Date().toISOString() },
      })
    }
    page++
    if (page <= pageCount) await new Promise((r) => setTimeout(r, 1000))
  } while (page <= pageCount)
  return { candidates: [...byInstitution.values()].slice(0, maxCandidates), stats }
}
