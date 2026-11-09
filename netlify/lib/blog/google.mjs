// Clientes mínimos de Google para el blog (sin googleapis: tres endpoints REST y un token OAuth).
//
// - OAuth: un refresh token del dueño con los scopes webmasters + adwords (scripts/google-oauth.mjs) da el access
//   token para Search Console y Google Ads. Se cachea en memoria hasta un minuto antes de vencer.
// - Search Console: searchAnalytics.query (consultas, páginas, posiciones) y sitemaps.submit (reenviar el sitemap
//   tras publicar). Docs: https://developers.google.com/webmaster-tools/v1/api_reference_index
// - Google Ads, Keyword Planner: KeywordPlanIdeaService.GenerateKeywordIdeas con Chile (geoTargetConstants/2152) y
//   español (languageConstants/1003). Requiere developer token con acceso Basic (el de prueba solo sirve con cuentas
//   de prueba). Docs: https://developers.google.com/google-ads/api/docs/keyword-planning/generate-keyword-ideas
//
// Nada se registra con valores de credenciales: los errores llevan solo el mensaje de Google.
import { googleAdsConfig, googleOAuthConfig, gscSiteUrl } from './config.mjs'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GSC_BASE = 'https://www.googleapis.com/webmasters/v3'
const ADS_BASE = 'https://googleads.googleapis.com'
const TIMEOUT_MS = 30_000

export const CHILE_GEO_TARGET = 'geoTargetConstants/2152'
export const SPANISH_LANGUAGE = 'languageConstants/1003'
/** GenerateKeywordIdeas acepta hasta 20 semillas por llamada. */
export const MAX_PLANNER_SEEDS = 20

export class GoogleApiError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = 'GoogleApiError'
    this.status = status
  }
}

let cachedToken = null

export function _resetGoogleTokenCache() {
  cachedToken = null
}

export async function googleAccessToken({ fetchImpl = fetch, now = Date.now } = {}) {
  const cfg = googleOAuthConfig()
  if (!cfg) throw new GoogleApiError('Faltan GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET o GOOGLE_OAUTH_REFRESH_TOKEN')
  if (cachedToken && cachedToken.expiresAt > now() + 60_000) return cachedToken.token
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    // invalid_grant = el refresh token venció o se revocó (app OAuth en modo "Testing": vencen a los 7 días)
    throw new GoogleApiError(`OAuth de Google: ${data.error_description || data.error || `HTTP ${res.status}`}`, res.status)
  }
  cachedToken = { token: data.access_token, expiresAt: now() + (Number(data.expires_in) || 3600) * 1000 }
  return cachedToken.token
}

function googleErrorMessage(data, status) {
  const err = data?.error
  if (!err) return `HTTP ${status}`
  const adsDetail = err.details?.flatMap?.((d) => d?.errors || [])?.map((e) => e?.message).filter(Boolean)
  return [err.message || err.status || `HTTP ${status}`, ...(adsDetail || [])].join(' · ').slice(0, 500)
}

async function googleFetch(url, { method = 'GET', body, headers = {}, fetchImpl = fetch } = {}) {
  const token = await googleAccessToken({ fetchImpl })
  const res = await fetchImpl(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!res.ok) throw new GoogleApiError(googleErrorMessage(data, res.status), res.status)
  return data
}

const siteSegment = () => {
  const site = gscSiteUrl()
  if (!site) throw new GoogleApiError('Falta GSC_SITE_URL (p. ej. sc-domain:aitickets.cl)')
  return encodeURIComponent(site)
}

/** Fechas de Search Console: los datos llegan con ~2-3 días de atraso; ventana de `days` que termina hace 3 días. */
export function gscWindow(days = 28, now = new Date()) {
  const end = new Date(now.getTime() - 3 * 86400_000)
  const start = new Date(end.getTime() - (days - 1) * 86400_000)
  const ymd = (d) => d.toISOString().slice(0, 10)
  return { startDate: ymd(start), endDate: ymd(end) }
}

/**
 * searchAnalytics.query paginado. Devuelve [{keys, clicks, impressions, ctr, position}].
 * @param {{dimensions: string[], startDate: string, endDate: string, filters?: object[], maxRows?: number, pageSize?: number, fetchImpl?: typeof fetch}} q
 */
export async function searchAnalytics({ dimensions, startDate, endDate, filters = [], maxRows = 5000, pageSize = Math.min(25000, maxRows), fetchImpl = fetch }) {
  const rows = []
  for (let startRow = 0; startRow < maxRows; startRow += pageSize) {
    const data = await googleFetch(`${GSC_BASE}/sites/${siteSegment()}/searchAnalytics/query`, {
      method: 'POST',
      fetchImpl,
      body: {
        startDate,
        endDate,
        dimensions,
        type: 'web',
        rowLimit: pageSize,
        startRow,
        ...(filters.length ? { dimensionFilterGroups: [{ groupType: 'and', filters }] } : {}),
      },
    })
    const page = data?.rows || []
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows
}

/** Reenvía el sitemap a Search Console (sitemaps.submit). Requiere el scope webmasters (no el de solo lectura). */
export async function submitSitemap(sitemapUrl, { fetchImpl = fetch } = {}) {
  await googleFetch(`${GSC_BASE}/sites/${siteSegment()}/sitemaps/${encodeURIComponent(sitemapUrl)}`, { method: 'PUT', fetchImpl })
  return true
}

const int = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : null
}

/**
 * Ideas de Keyword Planner para hasta 20 semillas, en Chile y en español, solo búsqueda de Google.
 * Devuelve [{keyword, searches, competition, competition_index, high_bid_micros}].
 */
export async function keywordIdeas(seeds, { pageSize = 300, fetchImpl = fetch } = {}) {
  const cfg = googleAdsConfig()
  if (!cfg) throw new GoogleApiError('Keyword Planner sin configurar (GOOGLE_ADS_DEVELOPER_TOKEN y GOOGLE_ADS_CUSTOMER_ID)')
  const keywords = [...new Set(seeds.map((s) => String(s).trim()).filter(Boolean))].slice(0, MAX_PLANNER_SEEDS)
  if (!keywords.length) return []
  const data = await googleFetch(`${ADS_BASE}/${cfg.apiVersion}/customers/${cfg.customerId}:generateKeywordIdeas`, {
    method: 'POST',
    fetchImpl,
    headers: { 'developer-token': cfg.developerToken, ...(cfg.loginCustomerId ? { 'login-customer-id': cfg.loginCustomerId } : {}) },
    body: {
      language: SPANISH_LANGUAGE,
      geoTargetConstants: [CHILE_GEO_TARGET],
      keywordPlanNetwork: 'GOOGLE_SEARCH',
      includeAdultKeywords: false,
      pageSize,
      keywordSeed: { keywords },
    },
  })
  return (data?.results || [])
    .map((r) => ({
      keyword: String(r.text || '').trim(),
      searches: int(r.keywordIdeaMetrics?.avgMonthlySearches),
      competition: r.keywordIdeaMetrics?.competition || null,
      competition_index: int(r.keywordIdeaMetrics?.competitionIndex),
      high_bid_micros: int(r.keywordIdeaMetrics?.highTopOfPageBidMicros),
    }))
    .filter((r) => r.keyword)
}
