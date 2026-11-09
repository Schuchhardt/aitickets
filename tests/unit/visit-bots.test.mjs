// Detección de visitas que no son de personas (netlify/lib/visit-bots.mjs). Los casos salen de event_visits de
// producción (evento 134 "Concierto de Primavera" y otros), revisados a mano el 04-11-2026.
import { describe, expect, it } from 'vitest'
import { botReason, isDevHost } from '../../netlify/lib/visit-bots.mjs'

const v = (user_agent, extra = {}) => ({ user_agent, country: 'CL', city: 'Santiago', referrer: null, ...extra })

describe('bots por user-agent', () => {
  it.each([
    ['meta', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
    ['meta', 'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)'],
    ['meta', 'Mozilla/5.0 (compatible; Facebot)'],
    ['messaging', 'WhatsApp/2.23.20.0'],
    ['messaging', 'Twitterbot/1.0'],
    ['messaging', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
    ['messaging', 'TelegramBot (like TwitterBot)'],
    ['messaging', 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'],
    ['messaging', 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)'],
    ['search', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
    ['search', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
    ['search', 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36 (compatible; Google-Read-Aloud; +https://support.google.com/webmasters/answer/1061943)'],
    ['ai', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +claude-user@anthropic.com)'],
    ['ai', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot'],
    ['headless', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36'],
    ['tool', 'curl/8.7.1'],
    ['tool', 'Python/3.10 aiohttp/3.10.10'],
    ['tool', 'authorized-exposure-audit/6'],
    ['tool', 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 [ip:93.41.125.186]'],
    ['scanner', 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1'],
    ['scanner', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.75 Safari/537.36'],
    ['scanner', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.103 Safari/537.36'],
  ])('%s: %s', (group, ua) => {
    expect(botReason(v(ua))).toBe(`ua:${group}`)
  })

  it('sin user-agent es bot', () => {
    expect(botReason(v(''))).toBe('ua:empty')
  })
})

describe('personas (no se marcan)', () => {
  it.each([
    'Instagram 453.0.0.55.79 Android (33/13; 420dpi; 1080x2400; samsung; SM-A515F; a51; exynos9611; es_US; 1100455531)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 452.0.1.39.54 (iPhone14,5; iOS 18_7; es_LA)',
    // iOS 26 congela el UA en "iPhone OS 18_x" con Safari 26: es normal
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
    // Android viejo con Chrome < 100 sí existe (no se actualiza): la regla de versión es solo para escritorio
    'Mozilla/5.0 (Linux; Android 9; SM-J600G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.105 Mobile Safari/537.36',
    // Marca de teléfono con "bot" en el nombre
    'Mozilla/5.0 (Linux; Android 11; CUBOT_X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 12; M2101K6G Build/SKQ1.210908.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/151.0.7922.199 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/500.0.0.0;]',
  ])('%s', (ua) => {
    expect(botReason(v(ua))).toBeNull()
  })

  it('visitas desde el extranjero que no son datacenters de Meta siguen contando', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1'
    expect(botReason(v(iphone, { country: 'US', city: 'Dallas' }))).toBeNull()
    expect(botReason(v(iphone, { country: 'MX', city: 'Mexico City' }))).toBeNull()
    expect(botReason(v(iphone, { country: 'US', city: 'Fort Worth' }))).toBeNull()
  })
})

describe('escáner de links de Meta desde sus datacenters', () => {
  it('Prineville, Forest City y Clonee con UA de navegador o de la app de Instagram (evento 134)', () => {
    expect(botReason(v('Instagram 453.0.0.55.79 Android (33/13; 420dpi; 1080x2400; samsung; SM-A515F)', { country: 'US', city: 'Prineville', referrer: 'http://m.facebook.com' }))).toBe('geo:meta-datacenter')
    expect(botReason(v('Mozilla/5.0 (Windows NT 10.0; WOW64; rv:58.0) Gecko/20100101 Firefox/59.0', { country: 'US', city: 'Prineville', referrer: 'https://www.facebook.com/' }))).toBe('geo:meta-datacenter')
    expect(botReason(v('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36', { country: 'US', city: 'Forest City' }))).toBe('geo:meta-datacenter')
    expect(botReason(v('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36', { country: 'IE', city: 'Clonee' }))).toBe('geo:meta-datacenter')
  })
  it('la ciudad tiene que calzar con el país', () => {
    expect(botReason(v('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36', { country: 'CL', city: 'Prineville' }))).toBeNull()
  })
})

describe('desarrollo y deploy previews (comparten la BD de producción)', () => {
  const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36'
  it('"Mock City" (geo simulado de netlify dev)', () => {
    expect(botReason(v(chrome, { country: 'mock', city: 'Mock City' }))).toBe('dev:mock-geo')
    expect(botReason(v(chrome, { country: 'CL', city: 'Mock City' }))).toBe('dev:mock-geo')
  })
  it('registrada desde localhost o un deploy preview, o con referrer local', () => {
    expect(botReason(v(chrome, { host: 'localhost:4321' }))).toBe('dev:host')
    expect(botReason(v(chrome, { host: 'deploy-preview-69--aitickets.netlify.app' }))).toBe('dev:host')
    expect(botReason(v(chrome, { referrer: 'http://localhost:4400/eventos/concierto-de-primavera' }))).toBe('dev:referrer')
    expect(botReason(v(chrome, { host: 'aitickets.cl', referrer: 'https://www.instagram.com/' }))).toBeNull()
    expect(botReason(v(chrome, { host: 'entradas.productora.cl' }))).toBeNull()
  })
  it('isDevHost', () => {
    expect(['localhost', '127.0.0.1:8888', 'mi-mac.local', 'aitickets.test', 'branch-x--aitickets.netlify.app'].every(isDevHost)).toBe(true)
    expect(['aitickets.cl', 'www.aitickets.cl', 'aitickets.netlify.app', null].some(isDevHost)).toBe(false)
  })
})
