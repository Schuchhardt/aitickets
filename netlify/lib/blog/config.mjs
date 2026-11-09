// Configuración del blog automatizado (docs/specs/blog-seo.md). Todo por variables de entorno, con valores por defecto
// seguros: sin BLOG_ENABLED=true la función programada no hace nada (las corridas manuales del MCP sí funcionan).
import { DEFAULT_ANTHROPIC_MODEL } from '../assistant-llm.mjs'

const env = (name) => {
  const value = globalThis.process?.env?.[name]
  return typeof value === 'string' ? value.trim() : ''
}

const intEnv = (name, fallback, min, max) => {
  const n = Number.parseInt(env(name), 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

export const SITE_URL = () => (env('SITE_URL') || 'https://aitickets.cl').replace(/\/+$/, '')

/** La función programada genera, mide y refresca solo con BLOG_ENABLED=true (gasta créditos de IA). */
export const blogScheduleEnabled = () => env('BLOG_ENABLED').toLowerCase() === 'true'

/** false = los artículos quedan como borrador para revisarlos (get_blog_post / vista previa) antes de publicar. */
export const blogAutopublish = () => env('BLOG_AUTOPUBLISH').toLowerCase() !== 'false'

/** Artículos nuevos por semana (máx. 1 por día). Calidad antes que volumen: Google castiga el contenido a escala. */
export const blogPostsPerWeek = () => intEnv('BLOG_POSTS_PER_WEEK', 3, 0, 7)

/** Modelo que investiga y redacta. */
export const blogModel = () => env('BLOG_MODEL') || env('ANTHROPIC_MODEL') || DEFAULT_ANTHROPIC_MODEL

/** Modelo que clasifica keywords en lote (muchas llamadas cortas). */
export const blogFastModel = () => env('BLOG_MODEL_FAST') || env('ANTHROPIC_MODEL_FAST') || blogModel()

export const isAnthropicConfigured = () => Boolean(env('ANTHROPIC_API_KEY'))

/**
 * Credenciales OAuth de Google compartidas por Search Console y Google Ads (Keyword Planner): un solo consentimiento
 * del dueño con los scopes webmasters + adwords (scripts/google-oauth.mjs las obtiene).
 */
export const googleOAuthConfig = () => {
  const clientId = env('GOOGLE_OAUTH_CLIENT_ID')
  const clientSecret = env('GOOGLE_OAUTH_CLIENT_SECRET')
  const refreshToken = env('GOOGLE_OAUTH_REFRESH_TOKEN')
  return clientId && clientSecret && refreshToken ? { clientId, clientSecret, refreshToken } : null
}

/** Propiedad de Search Console: "sc-domain:aitickets.cl" (dominio) o "https://aitickets.cl/" (prefijo de URL). */
export const gscSiteUrl = () => env('GSC_SITE_URL')
export const isSearchConsoleConfigured = () => Boolean(googleOAuthConfig() && gscSiteUrl())

export const googleAdsConfig = () => {
  const developerToken = env('GOOGLE_ADS_DEVELOPER_TOKEN')
  const customerId = env('GOOGLE_ADS_CUSTOMER_ID').replace(/-/g, '')
  if (!googleOAuthConfig() || !developerToken || !customerId) return null
  return {
    developerToken,
    customerId,
    loginCustomerId: env('GOOGLE_ADS_LOGIN_CUSTOMER_ID').replace(/-/g, '') || null,
    // Google publica una versión mayor al mes y cada una dura ~1 año: subir cuando avise el correo de "sunset".
    apiVersion: env('GOOGLE_ADS_API_VERSION') || 'v25',
  }
}
export const isKeywordPlannerConfigured = () => Boolean(googleAdsConfig())

/** Autocompletado de Google (endpoint público no oficial): semillas long-tail sin credenciales. off lo apaga. */
export const isAutocompleteEnabled = () => env('BLOG_AUTOCOMPLETE').toLowerCase() !== 'off'

/** IndexNow (Bing, Yandex, Seznam…): avisa URLs nuevas al instante. La llave se sirve en /indexnow.txt. */
export const indexNowKey = () => {
  const key = env('INDEXNOW_KEY')
  return /^[A-Za-z0-9-]{8,128}$/.test(key) ? key : ''
}

/** Resumen para get_blog_overview: qué está listo y qué falta (sin valores). */
export function blogSetup() {
  return {
    schedule_enabled: blogScheduleEnabled(),
    autopublish: blogAutopublish(),
    posts_per_week: blogPostsPerWeek(),
    model: blogModel(),
    fast_model: blogFastModel(),
    anthropic: isAnthropicConfigured(),
    search_console: isSearchConsoleConfigured(),
    keyword_planner: isKeywordPlannerConfigured(),
    autocomplete: isAutocompleteEnabled(),
    indexnow: Boolean(indexNowKey()),
    missing: [
      !isAnthropicConfigured() && 'ANTHROPIC_API_KEY',
      !googleOAuthConfig() && 'GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN',
      googleOAuthConfig() && !gscSiteUrl() && 'GSC_SITE_URL',
      googleOAuthConfig() && !googleAdsConfig() && 'GOOGLE_ADS_DEVELOPER_TOKEN / GOOGLE_ADS_CUSTOMER_ID (Keyword Planner, opcional)',
    ].filter(Boolean),
  }
}
