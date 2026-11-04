// Visitas que no son de personas (event_visits.is_bot + bot_reason). Las usa la ingesta (src/lib/eventPage.ts,
// recordEventVisit) y el marcado retroactivo (scripts/mark-bot-visits.mjs). La analítica (visitas, conversión, fuentes,
// ubicaciones, hora pico, reportes) las excluye; no se borran.
//
// La visita la registra el navegador al cargar la página (/api/events/visit), así que solo llegan los bots que ejecutan
// JavaScript. Varios NO se anuncian en el user-agent: el escáner de links de Meta (vista previa en Instagram, Facebook y
// WhatsApp) usa UAs de navegador o de la app de Instagram, pero sale de sus datacenters (Prineville, Oregón, entre
// otros). Por eso, además del UA, se mira la ubicación. Netlify no entrega el ASN, así que no hay regla por ASN/IP.
//
// Razones (bot_reason): ua:<grupo>, geo:meta-datacenter, dev:<origen>.

/**
 * [grupo, patrón] sobre el user-agent. El genérico exige "bot"/"crawler"/"spider" como palabra (no "CUBOT_X30"), o la
 * convención de los bots de firmar con su URL o correo ("+https://…", "+bot@…").
 */
export const BOT_UA_RULES = [
  ['meta', /facebookexternalhit|facebot|meta-externalagent|meta-externalfetcher|facebookcatalog/i],
  ['messaging', /whatsapp|twitterbot|slackbot|telegrambot|discordbot|linkedinbot|skypeuripreview|pinterestbot|redditbot|applebot|embedly|iframely|vkshare/i],
  ['search', /googlebot|google-inspectiontool|google-read-aloud|googleother|adsbot-google|mediapartners-google|storebot-google|bingbot|bingpreview|yandex(?:bot|images)|baiduspider|duckduckbot|slurp|petalbot|seznambot/i],
  ['ai', /gptbot|chatgpt-user|oai-searchbot|claudebot|claude-user|claude-searchbot|claude-web|anthropic-ai|perplexity(?:bot|-user)|bytespider|ccbot|amazonbot|google-extended|cohere-ai|meta-externalagent/i],
  ['headless', /headless|phantomjs|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix/i],
  ['tool', /^(?:curl|wget|python|go-http-client|node-fetch|undici|axios|okhttp|java\/|libwww-perl|httpclient|postmanruntime|insomnia)|aiohttp|python-requests|httpx|\b(?:scanner|exposure-audit|security-audit|uptimerobot|pingdom|statuscake|site24x7)\b|\[ip:[\d.:a-f]+\]/i],
  // Firmas de escáneres con UA de navegador: iOS 13.2.3 (2019) desde datacenters de todo el mundo, y Chrome de escritorio
  // de versión < 100 (se actualiza solo; hasta Windows 7 quedó en la 109, así que en 2026 no lo usa una persona)
  ['scanner', /iPhone OS 13_2_3 like Mac OS X\).*Version\/13\.0\.3|\((?:Windows NT|Macintosh)[^)]*\)[^]*?\bChrome\/(?:[1-9]|[1-9]\d)\.\d/i],
  ['generic', /(?:bot|crawler|spider)(?:[/;\s)]|$)|\+https?:\/\/|\+[\w.-]+@[\w.-]+/i],
]

/**
 * Ciudades de datacenters de Meta (geo de Netlify): desde ahí no navega una persona; es el escáner de links que arma
 * la vista previa al compartir el link en Instagram, Facebook o WhatsApp. Solo pueblos chicos dedicados a datacenters
 * (no Fort Worth, Mesa ni Kansas City, donde sí vive gente que puede comprar).
 */
export const META_DATACENTER_CITIES = {
  US: ['prineville', 'forest city', 'altoona', 'los lunas', 'papillion', 'eagle mountain', 'sandston', 'stanton springs', 'gallatin', 'new albany', 'dekalb'],
  IE: ['clonee'],
  SE: ['lulea', 'luleå'],
  DK: ['odense'],
}

const LOCAL_HOST = /^(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|[\w-]+\.local|[\w-]+\.localhost|[\w-]+\.test)$/i
/** Deploy previews y branch deploys de Netlify (deploy-preview-12--sitio.netlify.app): comparten la BD de producción. */
const PREVIEW_HOST = /--[\w-]+\.netlify\.app$/i

const hostOf = (url) => {
  try {
    return new URL(String(url)).hostname
  } catch {
    return null
  }
}

/** ¿Es un host de desarrollo local o de un deploy preview? */
export function isDevHost(host) {
  if (!host) return false
  const h = String(host).replace(/:\d+$/, '')
  return LOCAL_HOST.test(h) || PREVIEW_HOST.test(h)
}

/**
 * Razón por la que una visita no es de una persona, o null si lo es.
 * visit: { user_agent, city, country, referrer, host? (host del sitio donde se registró la visita) }
 */
export function botReason(visit = {}) {
  const ua = String(visit.user_agent ?? '').trim()
  const country = String(visit.country ?? '').trim()
  const city = String(visit.city ?? '').trim()
  // Datos de prueba: astro/netlify dev en local escriben en la BD de producción (comparten .env), igual que los deploy
  // previews; netlify dev además inventa la ubicación ("Mock City")
  if (/^mock$/i.test(country) || /^mock city$/i.test(city)) return 'dev:mock-geo'
  if (isDevHost(visit.host)) return 'dev:host'
  if (isDevHost(hostOf(visit.referrer))) return 'dev:referrer'
  if (!ua) return 'ua:empty'
  for (const [group, re] of BOT_UA_RULES) if (re.test(ua)) return `ua:${group}`
  const cities = META_DATACENTER_CITIES[country.toUpperCase()]
  if (cities && cities.includes(city.toLowerCase())) return 'geo:meta-datacenter'
  return null
}
