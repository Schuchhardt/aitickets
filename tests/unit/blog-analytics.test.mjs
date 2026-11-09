// Analítica del blog (netlify/lib/blog/analytics.mjs, traffic.mjs, summary.mjs): fuentes de tráfico, rendimiento por
// artículo y tema, cuota por rendimiento en el generador, resumen de corridas para Slack, /api/blog/visit y las
// herramientas del MCP de admin (get_blog_run, get_blog_analytics, list_blog_posts por lectores).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { classifyBlogSource, blogSignupRef } from '../../netlify/lib/blog/traffic.mjs'
import { performanceDigest, performanceRecommendations, postValue, topicPerformanceMultipliers } from '../../netlify/lib/blog/analytics.mjs'
import { digestLines, runSummary } from '../../netlify/lib/blog/summary.mjs'
import { pickKeyword } from '../../netlify/lib/blog/posts.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e) }))

const NOW = Date.parse('2026-11-09T12:00:00Z')
const daysAgo = (d) => new Date(NOW - d * 86400_000).toISOString()

describe('fuente del lector', () => {
  const c = (referrer, extra = {}) => classifyBlogSource({ referrer, siteHost: 'aitickets.cl', ...extra })
  it('buscadores, asistentes de IA, redes, mismo sitio, otros y directo', () => {
    expect(c('https://www.google.cl/')).toBe('search')
    expect(c('https://www.bing.com/search?q=x')).toBe('search')
    expect(c('https://chatgpt.com/')).toBe('ai')
    expect(c('https://www.perplexity.ai/search/x')).toBe('ai')
    expect(c('https://gemini.google.com/app')).toBe('ai')
    expect(c('https://l.instagram.com/?u=x')).toBe('social')
    expect(c('https://t.co/abc')).toBe('social')
    expect(c('https://aitickets.cl/blog')).toBe('internal')
    expect(c('https://www.aitickets.cl/guias')).toBe('internal')
    expect(c('https://emol.com/nota')).toBe('referral')
    expect(c('')).toBe('direct')
    expect(c('no es url')).toBe('direct')
  })
  it('utm manda sobre el referrer; ChatGPT marca sus links con utm_source', () => {
    expect(c('https://www.google.cl/', { utmSource: 'newsletter', utmMedium: 'email' })).toBe('campaign')
    expect(c('', { utmSource: 'chatgpt.com' })).toBe('ai')
    expect(c('', { utmSource: 'google', utmMedium: 'organic' })).toBe('search')
  })
  it('el registro queda atribuido como blog_<slug>', () => {
    expect(blogSignupRef('llenar-discoteca')).toBe('blog_llenar-discoteca')
  })
})

describe('rendimiento por tema', () => {
  const post = (id, topic, visitors, cta = 0, signups = 0, age = 30) => ({ id, topic_id: topic, status: 'published', age_days: age, visitors, cta_visitors: cta, signups, value: postValue({ visitors, cta_visitors: cta, signups }) })

  it('valor = lectores + 10×CTA + 50×registros', () => {
    expect(postValue({ visitors: 100, cta_visitors: 3, signups: 1 })).toBe(180)
  })

  it('el tema que rinde más sube su cuota y el que rinde menos la baja, dentro de 0,6-1,6', () => {
    const m = topicPerformanceMultipliers([post(1, 1, 400, 10), post(2, 1, 300, 8), post(3, 2, 20), post(4, 2, 10), post(5, 3, 100)])
    expect(m.get(1)).toBeGreaterThan(1.2)
    expect(m.get(2)).toBe(0.6)
    expect(m.has(3)).toBe(false) // un solo artículo: no mueve su cuota
  })

  it('artículos nuevos (menos de 14 días) no cuentan; sin datos no hay multiplicadores', () => {
    expect(topicPerformanceMultipliers([post(1, 1, 500, 0, 0, 3), post(2, 1, 500, 0, 0, 5)]).size).toBe(0)
    expect(topicPerformanceMultipliers([]).size).toBe(0)
  })

  it('sugiere arreglar títulos con CTR bajo y cierres que no convierten', () => {
    const recs = performanceRecommendations([
      { ...post(1, 1, 10), title: 'A', gsc: { impressions: 900, clicks: 5, ctr: 0.0056, position: 7 } },
      { ...post(2, 1, 120, 0), title: 'B', cta_rate: 0, gsc: null },
      { ...post(3, 1, 1, 0, 0, 60), title: 'C', gsc: { impressions: 3, clicks: 0, ctr: 0, position: 40 } },
    ])
    expect(recs.map((r) => [r.post_id, r.kind])).toEqual([
      [1, 'low_ctr'],
      [2, 'low_cta'],
      [3, 'no_traction'],
    ])
  })
})

function statsDb({ stats = [], posts, topics, keywords = [], runs = [] } = {}) {
  return createFakeSupabase({
    tables: {
      aitickets_blog_topics: topics || [
        { id: 1, slug: 'discotecas', name: 'Discotecas', weight: 5, active: true },
        { id: 2, slug: 'teatro', name: 'Teatro', weight: 5, active: true },
      ],
      aitickets_blog_posts: posts || [
        { id: 1, slug: 'llenar-discoteca', title: 'Cómo llenar una discoteca', status: 'published', topic_id: 1, published_at: daysAgo(40), created_at: daysAgo(40), gsc_updated_at: daysAgo(1), gsc_clicks: 30, gsc_impressions: 900, gsc_ctr: 0.033, gsc_position: 6.2 },
        { id: 2, slug: 'rrpp-discoteca', title: 'RRPP para discotecas', status: 'published', topic_id: 1, published_at: daysAgo(30), created_at: daysAgo(30) },
        { id: 3, slug: 'difundir-obra', title: 'Cómo difundir una obra', status: 'published', topic_id: 2, published_at: daysAgo(35), created_at: daysAgo(35) },
        { id: 4, slug: 'precio-obra', title: 'Precio de una obra', status: 'published', topic_id: 2, published_at: daysAgo(25), created_at: daysAgo(25) },
        { id: 5, slug: 'borrador', title: 'Borrador', status: 'draft', topic_id: 2, published_at: null, created_at: daysAgo(2) },
      ],
      aitickets_blog_keywords: keywords,
      aitickets_blog_runs: runs,
    },
    rpc: {
      aitickets_blog_post_stats: () => stats,
      aitickets_blog_daily: () => [{ day: '2026-11-08', views: 12, visitors: 10, cta_clicks: 2 }],
    },
  })
}

const STATS = [
  { post_id: 1, views: 300, visitors: 250, cta_clicks: 14, cta_visitors: 12, search_visitors: 200, ai_visitors: 10, social_visitors: 20, direct_visitors: 20, signups: 2 },
  { post_id: 2, views: 150, visitors: 120, cta_clicks: 5, cta_visitors: 5, search_visitors: 100, direct_visitors: 20, signups: 0 },
  { post_id: 3, views: 12, visitors: 10, cta_clicks: 0, cta_visitors: 0, search_visitors: 8, direct_visitors: 2, signups: 0 },
  { post_id: 4, views: 8, visitors: 6, cta_clicks: 0, cta_visitors: 0, direct_visitors: 6, signups: 0 },
]

describe('resumen de rendimiento', () => {
  it('ordena por valor, suma fuentes y calcula la cuota por tema', async () => {
    const digest = await performanceDigest(statsDb({ stats: STATS }), { now: NOW })
    expect(digest.site_analytics).toBe(true)
    expect(digest.totals).toMatchObject({ published_posts: 4, visitors: 386, cta_visitors: 17, signups: 2, gsc_clicks: 30 })
    expect(digest.totals.visitors_by_source.search).toBe(308)
    expect(digest.top_posts.map((p) => p.id)).toEqual([1, 2, 3, 4])
    const [disco, teatro] = digest.topics
    expect(disco.slug).toBe('discotecas')
    expect(disco.quota_multiplier).toBeGreaterThan(1)
    expect(teatro.quota_multiplier).toBe(0.6)
    const text = digestLines(digest, { siteUrl: 'https://aitickets.cl' }).join('\n')
    expect(text).toContain('<https://aitickets.cl/blog/llenar-discoteca|Cómo llenar una discoteca>')
    expect(text).toContain('discotecas ×')
  })

  it('sin la migración de analítica sigue funcionando con Search Console', async () => {
    const supabase = statsDb()
    supabase.rpc = async () => ({ data: null, error: { code: 'PGRST202', message: 'no existe' } })
    const digest = await performanceDigest(supabase, { now: NOW })
    expect(digest.site_analytics).toBe(false)
    expect(digest.top_posts[0].id).toBe(1) // desempata por clics de Google
  })

  it('el generador le da más cuota al tema que mejor funciona', async () => {
    const keywords = [
      { id: 10, keyword: 'como llenar un bar', normalized: 'como llenar un bar', topic_id: 1, status: 'new', score: 50 },
      { id: 11, keyword: 'como vender una obra', normalized: 'como vender una obra', topic_id: 2, status: 'new', score: 90 },
    ]
    // Mismo peso y los mismos artículos recientes por tema: decide el rendimiento
    const picked = await pickKeyword(statsDb({ stats: STATS, keywords }))
    expect(picked.topic.slug).toBe('discotecas')
    const swap = { 1: 3, 2: 4, 3: 1, 4: 2 }
    const flipped = await pickKeyword(statsDb({ stats: STATS.map((x) => ({ ...x, post_id: swap[x.post_id] })), keywords }))
    expect(flipped.topic.slug).toBe('teatro')
  })
})

describe('resumen de corridas (Slack y get_blog_run)', () => {
  const base = { id: 7, trigger: 'schedule', started_at: '2026-11-09T12:47:00Z', finished_at: '2026-11-09T12:52:30Z' }
  const cost = { usd: 1.0542, calls: 3, input_tokens: 159246, output_tokens: 17861, web_searches: 6 }

  it('artículo en borrador: título, keyword, vista previa, avisos, saltadas y costo desglosado', () => {
    const text = runSummary(
      {
        ...base,
        task: 'generate',
        status: 'ok',
        details: {
          post_id: 1,
          slug: 'llenar-discoteca',
          status: 'draft',
          title: 'Cómo llenar una discoteca',
          keyword: 'como llenar una discoteca',
          topic: 'discotecas',
          words: 1933,
          sources: 10,
          issues: [{ level: 'warn', code: 'links_removed', message: 'Se quitaron 2 enlaces' }],
          skipped_keywords: [{ keyword: 'como vender entradas online', covered_by: '/guias/como-vender-entradas-online' }],
          cost,
        },
      },
      { siteUrl: 'https://aitickets.cl', previewUrl: 'https://aitickets.cl/blog/vista-previa/1?t=x' },
    )
    expect(text).toContain('✅ *Blog · Artículo nuevo* #7 (automática)')
    expect(text).toContain('Borrador: *Cómo llenar una discoteca*')
    expect(text).toContain('Keyword: "como llenar una discoteca" · tema discotecas · 1933 palabras · 10 fuentes')
    expect(text).toContain('Vista previa: https://aitickets.cl/blog/vista-previa/1?t=x')
    expect(text).toContain('Aviso: Se quitaron 2 enlaces')
    expect(text).toContain('"como vender entradas online" → /guias/como-vender-entradas-online')
    expect(text).toContain('Duración: 5 min 30 s · Costo: US$1.05 · 3 llamadas a Claude · 159k tokens de entrada / 18k de salida · 6 búsquedas web')
  })

  it('publicado, fallido, saltado, keywords y métricas', () => {
    const published = runSummary({ ...base, task: 'generate', status: 'ok', details: { slug: 'x-y', status: 'published', keyword: 'k', words: 900, effects: { cache: 'ok', sitemap: 'ok', indexnow: 'ok' } } })
    expect(published).toContain('https://aitickets.cl/blog/x-y')
    expect(published).toContain('Difusión: caché ok · sitemap ok · IndexNow ok')
    expect(runSummary({ ...base, task: 'refresh', status: 'failed', error: '400 boom', details: {} })).toContain('⚠️ *Blog · Refresco de artículo* #7 (automática)\nError: 400 boom')
    expect(runSummary({ ...base, task: 'generate', status: 'skipped', details: { skipped: 'Ya cubiertas', tried: [{ keyword: 'a', covered_by: '/b' }] } })).toContain('Sin cambios: Ya cubiertas\nProbadas: "a" → /b')
    const kw = runSummary({ ...base, task: 'keywords', status: 'ok', details: { candidates: 182, classified: 5, saved: 182, rejected: 3, sources: { planner: 0, search_console: 11, autocomplete: 135 }, top: [{ keyword: 'ticketeras en chile', score: 44.6 }] } })
    expect(kw).toContain('182 candidatas (Planner 0 · Search Console 11 · autocompletado 135)')
    expect(kw).toContain('Mejores pendientes: "ticketeras en chile" (44.6)')
    const metrics = runSummary({ ...base, task: 'metrics', status: 'ok', details: { search_console: { updated: 4, pages_with_data: 3 }, performance: { window: { days: 28 }, site_analytics: true, totals: { published_posts: 4, visitors: 10, cta_visitors: 1, cta_rate: 0.1, signups: 0, gsc_clicks: 3, gsc_impressions: 40 }, top_posts: [], topics: [], recommendations: [] } } })
    expect(metrics).toContain('Search Console: 4 artículos actualizados (3 con datos)')
    expect(metrics).toContain('Lectores 10 · clics a AI Tickets 1 (10.0%)')
  })
})

describe('corridas: metrics semanal con resumen de rendimiento', () => {
  it('plannedTasks agenda metrics si hay artículos publicados, aunque no haya Search Console', async () => {
    const { plannedTasks, runBlogTask } = await import('../../netlify/lib/blog/runner.mjs')
    const supabase = statsDb({ stats: STATS })
    expect(await plannedTasks(supabase, NOW)).toContain('metrics')
    const out = await runBlogTask(supabase, { task: 'metrics', trigger: 'admin' })
    expect(out.status).toBe('ok')
    expect(out.details.search_console).toMatch(/sin configurar/)
    expect(out.details.performance.totals.visitors).toBe(386)
    expect(out).toMatchObject({ trigger: 'admin', started_at: expect.any(String), finished_at: expect.any(String) })
  })
})

describe('/api/blog/visit', () => {
  const call = async (body, headers = {}) => {
    const { POST } = await import('../../src/pages/api/blog/visit.ts')
    const request = new Request('https://aitickets.cl/api/blog/visit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1', 'x-nf-client-connection-ip': '200.1.2.3', ...headers },
      body: JSON.stringify(body),
    })
    return POST({ request, locals: { netlify: { context: { geo: { country: { code: 'CL' }, city: 'Santiago' } } } } })
  }
  beforeEach(() => {
    db = createFakeSupabase({
      tables: {
        aitickets_blog_posts: [
          { id: 1, slug: 'a', status: 'published' },
          { id: 2, slug: 'b', status: 'draft' },
        ],
        aitickets_blog_visits: [],
      },
    })
  })

  it('guarda la lectura con su fuente y la ubicación; ignora borradores', async () => {
    expect((await call({ post_id: 1, kind: 'view', referrer: 'https://www.google.cl/' })).status).toBe(204)
    expect((await call({ post_id: 2, kind: 'view' })).status).toBe(204)
    expect(db.tables.aitickets_blog_visits).toHaveLength(1)
    expect(db.tables.aitickets_blog_visits[0]).toMatchObject({ post_id: 1, kind: 'view', source: 'search', country: 'CL', city: 'Santiago', is_bot: false })
    expect(db.tables.aitickets_blog_visits[0].ip_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('el clic al CTA exige una ruta interna; los bots quedan marcados', async () => {
    expect((await call({ post_id: 1, kind: 'cta', cta_path: 'https://evil.com' })).status).toBe(400)
    expect((await call({ post_id: 1, kind: 'cta', cta_path: '//evil.com' })).status).toBe(400)
    expect((await call({ post_id: 1, kind: 'cta', cta_path: '/ticketera-discotecas?x=1' })).status).toBe(204)
    await call({ post_id: 1, kind: 'view' }, { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' })
    expect(db.tables.aitickets_blog_visits.map((v) => [v.kind, v.cta_path, v.is_bot, v.bot_reason])).toEqual([
      ['cta', '/ticketera-discotecas?x=1', false, null],
      ['view', null, true, 'ua:search'],
    ])
  })

  it('cuerpo inválido: 400', async () => {
    expect((await call({ post_id: 'x' })).status).toBe(400)
    expect((await call({ post_id: 1, kind: 'otro' })).status).toBe(400)
  })
})

describe('MCP de admin: analítica y corridas', () => {
  const actx = (supabase) => ({ supabase, origin: 'https://aitickets.cl', requestUrl: new URL('https://aitickets.cl/api/admin/mcp') })
  const tool = async (name) => (await import('../../src/lib/admin-api/tools/blog.ts')).blogAdminTools.find((t) => t.name === name)
  const env = { ...process.env }
  afterEach(() => {
    process.env = { ...env }
    vi.unstubAllEnvs()
  })

  it('get_blog_run trae el detalle y el mismo texto que va a Slack', async () => {
    vi.stubEnv('INTERNAL_API_SECRET', 'x'.repeat(32))
    const run = { id: 9, task: 'generate', trigger: 'admin', status: 'ok', started_at: '2026-11-09T20:27:00Z', finished_at: '2026-11-09T20:31:00Z', error: null, details: { post_id: 5, slug: 'borrador', status: 'draft', title: 'Borrador', keyword: 'k', words: 1000, issues: [], opts: { publish: false }, cost: { usd: 1, calls: 3 } } }
    const out = await (await tool('get_blog_run')).handler({ run_id: 9 }, actx(statsDb({ runs: [run] })))
    expect(out).toMatchObject({ run_id: 9, duration_seconds: 240, options: { publish: false }, cost: { usd: 1 }, post: { id: 5, url: null } })
    expect(out.post.preview_url).toMatch(/^https:\/\/aitickets\.cl\/blog\/vista-previa\/5\?t=/)
    expect(out.summary_text).toContain('Borrador: *Borrador*')
    expect(out.summary_text).toContain('Vista previa: https://aitickets.cl/blog/vista-previa/5?t=')
  })

  it('list_blog_posts ordena por lectores y get_blog_analytics arma el ranking con URL', async () => {
    const supabase = statsDb({ stats: STATS })
    const list = await (await tool('list_blog_posts')).handler({ sort: 'visitors', limit: 2 }, actx(supabase))
    expect(list.posts.map((p) => [p.id, p.site.visitors])).toEqual([
      [1, 250],
      [2, 120],
    ])
    const analytics = await (await tool('get_blog_analytics')).handler({ days: 28 }, actx(supabase))
    expect(analytics.top_posts[0]).toMatchObject({ id: 1, url: 'https://aitickets.cl/blog/llenar-discoteca' })
    expect(analytics.daily).toHaveLength(1)
  })

  it('send_blog_report_to_slack publica el rendimiento', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/x'
    const fetchMock = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const out = await (await tool('send_blog_report_to_slack')).handler({ days: 28 }, actx(statsDb({ stats: STATS })))
      expect(out.sent).toBe(true)
      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.text).toContain('📊 *Blog AI Tickets*')
      expect(body.text).toContain('Los que mejor funcionan')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
