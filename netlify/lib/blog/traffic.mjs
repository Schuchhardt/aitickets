// De dónde llega un lector del blog (aitickets_blog_visits.source). Función pura: la usa /api/blog/visit al registrar
// la visita y los tests. Orden: utm (campaña nuestra) > referrer conocido > mismo sitio > otro sitio > directo.

const SEARCH = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|yahoo\.com|ecosia\.org|search\.brave\.com|yandex\.[a-z.]+|baidu\.com|startpage\.com|qwant\.com)$/i
const AI = /(^|\.)(chatgpt\.com|chat\.openai\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|bard\.google\.com|copilot\.microsoft\.com|you\.com|phind\.com|meta\.ai|deepseek\.com|chat\.mistral\.ai|grok\.com)$/i
const SOCIAL = /(^|\.)(facebook\.com|fb\.com|instagram\.com|l\.instagram\.com|t\.co|twitter\.com|x\.com|linkedin\.com|lnkd\.in|whatsapp\.com|wa\.me|tiktok\.com|youtube\.com|youtu\.be|reddit\.com|pinterest\.[a-z.]+|threads\.net|telegram\.org|t\.me)$/i
const AI_UTM = /^(chatgpt(\.com)?|openai|perplexity|claude|gemini|copilot)$/i

const hostOf = (url) => {
  try {
    return new URL(url).host.toLowerCase().replace(/:\d+$/, '')
  } catch {
    return ''
  }
}

/** visit: { referrer, utmSource, utmMedium, siteHost } → 'search' | 'ai' | 'social' | 'campaign' | 'internal' | 'referral' | 'direct'. */
export function classifyBlogSource({ referrer = '', utmSource = '', utmMedium = '', siteHost = '' } = {}) {
  const source = String(utmSource || '').trim()
  const medium = String(utmMedium || '').trim().toLowerCase()
  // ChatGPT y otros asistentes agregan ?utm_source=chatgpt.com a los links que citan
  if (AI_UTM.test(source)) return 'ai'
  if (source) return medium === 'organic' ? 'search' : 'campaign'
  const host = hostOf(referrer)
  if (!host) return 'direct'
  if (AI.test(host)) return 'ai'
  if (SEARCH.test(host)) return 'search'
  if (SOCIAL.test(host)) return 'social'
  const site = String(siteHost || '').toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '')
  if (site && (host === site || host.endsWith(`.${site}`) || host.replace(/^www\./, '') === site)) return 'internal'
  return 'referral'
}

export const BLOG_SOURCES = ['search', 'ai', 'social', 'campaign', 'internal', 'referral', 'direct']

/** signup_ref que el artículo deja en la atribución del registro de productores (organizations.signup_ref). */
export const blogSignupRef = (slug) => `blog_${slug}`
