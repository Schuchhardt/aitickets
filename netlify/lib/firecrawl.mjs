// Cliente mínimo de Firecrawl: SOLO búsqueda web (títulos, snippets y URLs del buscador).
//
// Regla dura: passline.com (y cualquier dominio de NEVER_FETCH_HOSTS) está detrás de un desafío anti-bots
// de Cloudflare. Nunca se pide a Firecrawl que visite esas páginas (scrape/crawl/map/extract, ni
// scrapeOptions en la búsqueda): este módulo lanza antes de salir a la red si alguien lo intenta.
// La búsqueda en sí no visita las páginas de los resultados: devuelve lo que indexó el buscador.
//
// Docs: https://docs.firecrawl.dev/api-reference/endpoint/search (POST /v2/search).
import { isNeverFetchUrl } from './outreach/domains.mjs'

const API_BASE = 'https://api.firecrawl.dev'
const SEARCH_PATH = '/v2/search'
const REQUEST_TIMEOUT_MS = 30_000
/** Estimación conservadora si la respuesta no trae creditsUsed (2 créditos por cada 10 resultados). */
const estimateCredits = (limit) => Math.max(1, Math.ceil(limit / 10)) * 2

export class FirecrawlBudgetError extends Error {
  constructor(message) {
    super(message)
    this.name = 'FirecrawlBudgetError'
  }
}

export class FirecrawlForbiddenTargetError extends Error {
  constructor(message) {
    super(message)
    this.name = 'FirecrawlForbiddenTargetError'
  }
}

/** Presupuesto de créditos para una corrida (se pasa entre llamadas). */
export function createFirecrawlBudget(credits = 150) {
  return { limit: Math.max(0, Number(credits) || 0), used: 0, calls: 0 }
}

function collectUrls(value, out = []) {
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value) || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(value)) out.push(value)
  } else if (Array.isArray(value)) {
    for (const v of value) collectUrls(v, out)
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectUrls(v, out)
  }
  return out
}

/**
 * Guardia: lanza FirecrawlForbiddenTargetError si la llamada haría que Firecrawl visite passline.com.
 * - Cualquier endpoint distinto de /search (scrape, crawl, map, extract, batch...) con una URL de passline.
 * - /search con scrapeOptions (eso visitaría cada resultado, incluidos los de passline).
 */
export function assertNoForbiddenFetch(path, body = {}) {
  const isSearch = /\/search$/.test(path)
  if (isSearch) {
    if (body && body.scrapeOptions) {
      throw new FirecrawlForbiddenTargetError('firecrawl: scrapeOptions no se permite en la búsqueda (visitaría páginas de passline)')
    }
    return
  }
  const bad = collectUrls(body).find((u) => isNeverFetchUrl(u))
  if (bad) throw new FirecrawlForbiddenTargetError(`firecrawl: prohibido visitar ${bad} (protegido por anti-bots)`)
  // Este cliente no usa otros endpoints; si alguien los agrega, deben pasar por esta guardia.
  throw new FirecrawlForbiddenTargetError(`firecrawl: endpoint ${path} no habilitado en este cliente`)
}

/**
 * Búsqueda web. Devuelve [{url, title, description}].
 * @param {string} query
 * `lang` se acepta por compatibilidad pero /v2/search no tiene ese parámetro: el idioma se sesga con
 * country/location y con la consulta en español.
 * @param {{limit?: number, country?: string, lang?: string, budget?: ReturnType<typeof createFirecrawlBudget>, fetchImpl?: typeof fetch}} opts
 */
export async function search(query, { limit = 10, country = 'cl', budget, fetchImpl } = {}) {
  const apiKey = (process.env.FIRECRAWL_API_KEY || '').trim()
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY no configurada')
  const q = String(query || '').trim().slice(0, 500)
  if (!q) return []
  const n = Math.min(20, Math.max(1, Number(limit) || 10))
  const estimate = estimateCredits(n)
  if (budget && budget.used + estimate > budget.limit) throw new FirecrawlBudgetError('firecrawl_run_credit_cap')

  const body = {
    query: q,
    limit: n,
    sources: ['web'],
    country: String(country || 'cl').toUpperCase(),
    location: 'Chile',
    timeout: REQUEST_TIMEOUT_MS - 5_000,
  }
  assertNoForbiddenFetch(SEARCH_PATH, body)

  const doFetch = fetchImpl || fetch
  const res = await doFetch(`${API_BASE}${SEARCH_PATH}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  let payload = null
  try {
    payload = await res.json()
  } catch { /* cuerpo no JSON */ }
  if (budget) {
    budget.calls += 1
    budget.used += Number.isFinite(payload?.creditsUsed) ? payload.creditsUsed : estimate
  }
  if (!res.ok || payload?.success === false) {
    const msg = payload?.error || payload?.message || `HTTP ${res.status}`
    throw new Error(`firecrawl search: ${String(msg).slice(0, 200)}`)
  }
  return parseSearchResponse(payload)
}

/** Normaliza la respuesta (v2: data.web[]; v1: data[]) a [{url, title, description}]. */
export function parseSearchResponse(payload) {
  const list = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.data?.web) ? payload.data.web : []
  const out = []
  for (const r of list) {
    const url = typeof r?.url === 'string' ? r.url : r?.metadata?.url
    if (!url) continue
    out.push({
      url,
      title: String(r.title || r.metadata?.title || '').slice(0, 300),
      description: String(r.description || r.snippet || '').slice(0, 1000),
    })
  }
  return out
}
