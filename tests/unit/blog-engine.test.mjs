// Blog SEO automatizado (netlify/lib/blog, docs/specs/blog-seo.md): texto, puntaje, keywords, validación de
// artículos, clientes de Google, investigación con Claude y una generación completa con Supabase y Claude falsos.
import { readdirSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { brandMentions, countWords, keywordCoverage, markdownLinks, normalizeKeyword, slugify } from '../../netlify/lib/blog/text.mjs'
import { keywordDemand, keywordScore, rejectionReason, topicByDeficit, MIN_AUTO_SCORE } from '../../netlify/lib/blog/scoring.mjs'
import { aggregateGscQueries, buildKeywordRow, isUsableKeyword, mergeCandidate } from '../../netlify/lib/blog/keywords.mjs'
import { finalizeArticle, sanitizeArticleLinks, WRITER_SYSTEM, CLOSING_HEADING } from '../../netlify/lib/blog/writer.mjs'
import { INTERNAL_PAGES, PRODUCT_FACTS, isInternalPath } from '../../netlify/lib/blog/product-facts.mjs'
import { blogSlugFromUrl, generatePost, groupQueriesBySlug } from '../../netlify/lib/blog/posts.mjs'
import { _resetGoogleTokenCache, gscWindow, keywordIdeas, searchAnalytics } from '../../netlify/lib/blog/google.mjs'
import { _setAnthropicClient, askJson, isCitableSource, research } from '../../netlify/lib/blog/llm.mjs'
import { signBlogPreview, verifyBlogPreview } from '../../netlify/lib/blog/preview-token.mjs'
import { BLOG_CACHE_TAG } from '../../netlify/lib/blog/publish.mjs'
import { BLOG_PAGES_TAG } from '../../src/lib/cdnCache.ts'
import { LANDINGS } from '../../src/data/landings'
import { SERVICE_FEE_PERCENT_LABEL } from '../../netlify/lib/fees.mjs'

describe('texto', () => {
  it('normaliza keywords sin tildes, signos ni guiones', () => {
    expect(normalizeKeyword('¿Cómo organizar un SHOW de Stand-Up?')).toBe('como organizar un show de stand up')
    expect(normalizeKeyword('  check-in   con QR ')).toBe('check in con qr')
  })

  it('slug corto, sin palabras vacías ni ñ', () => {
    expect(slugify('Cómo organizar un show de stand-up')).toBe('organizar-show-stand-up')
    expect(slugify('Cuánto cobrar por la entrada a una fiesta en Ñuñoa')).toBe('cuanto-cobrar-entrada-fiesta-nunoa')
    expect(slugify('x'.repeat(200), 70).length).toBeLessThanOrEqual(70)
    expect(slugify('¿?')).toBe('articulo')
  })

  it('cobertura de keyword tolera plurales y guiones', () => {
    expect(keywordCoverage('como organizar eventos', 'Guía para organizar un evento')).toBe(1)
    expect(keywordCoverage('control de acceso para eventos', 'Check-in de tu fiesta')).toBeLessThan(0.5)
  })

  it('cuenta palabras sin URLs ni Markdown y encuentra links y menciones de marca', () => {
    expect(countWords('## Título\n\nUna [frase](https://x.cl/a-b-c) con **cinco** palabras')).toBe(6)
    expect(markdownLinks('a [uno](/precios) y [dos](https://sii.cl)').map((l) => l.url)).toEqual(['/precios', 'https://sii.cl'])
    expect(brandMentions('AI Tickets, AITickets y aitickets.cl')).toBe(3)
  })
})

describe('puntaje', () => {
  const base = { intent: 'informational', relevance: 90, sources: [] }

  it('más demanda y menos competencia suben el puntaje; la intención de compra lo baja', () => {
    const low = keywordScore({ ...base, planner_searches: 10 })
    const high = keywordScore({ ...base, planner_searches: 1000 })
    expect(high).toBeGreaterThan(low)
    expect(keywordScore({ ...base, planner_searches: 1000, planner_competition: 'HIGH' })).toBeLessThan(high)
    expect(keywordScore({ ...base, planner_searches: 1000, intent: 'transactional' })).toBeLessThan(high / 2)
    expect(keywordScore({ ...base, planner_searches: 1000, intent: 'navigational' })).toBe(0)
    expect(keywordScore({ ...base, intent: null })).toBe(0)
  })

  it('Search Console entre la 4 y la 30 empuja (striking distance)', () => {
    const plain = keywordScore({ ...base, gsc_impressions: 200 })
    expect(keywordScore({ ...base, gsc_impressions: 200, gsc_position: 9 })).toBeGreaterThan(plain)
    expect(keywordScore({ ...base, gsc_impressions: 200, gsc_position: 2 })).toBe(plain)
  })

  it('sin volumen usa el autocompletado como señal y nunca baja de 0,1 con datos', () => {
    expect(keywordDemand({ sources: ['autocomplete'] })).toBeGreaterThan(keywordDemand({ sources: [] }))
    expect(keywordDemand({ planner_searches: 0 })).toBe(0.1)
    expect(keywordScore({ ...base, relevance: 85, sources: ['autocomplete'] })).toBeGreaterThan(MIN_AUTO_SCORE)
  })

  it('descarta marcas ajenas, público asistente, sin tema o poco relevantes', () => {
    expect(rejectionReason({ intent: 'navigational', topic_id: 1, relevance: 90 })).toMatch(/marca/)
    expect(rejectionReason({ intent: 'informational', audience: 'attendee', topic_id: 1, relevance: 90 })).toMatch(/público/)
    expect(rejectionReason({ intent: 'informational', audience: 'producer', topic_id: null, relevance: 90 })).toMatch(/tema/)
    expect(rejectionReason({ intent: 'informational', audience: 'producer', topic_id: 1, relevance: 20 })).toMatch(/Relevancia/)
    expect(rejectionReason({ intent: 'informational', audience: 'producer', topic_id: 1, relevance: 70 })).toBeNull()
  })

  it('reparte por cuota: elige el tema con más déficit', () => {
    const topics = [{ id: 1, weight: 6 }, { id: 2, weight: 3 }, { id: 3, weight: 1 }, { id: 4, weight: 0 }]
    expect(topicByDeficit(topics, new Map()).id).toBe(1)
    expect(topicByDeficit(topics, new Map([[1, 6], [2, 1]])).id).toBe(2)
    expect(topicByDeficit(topics, new Map([[1, 6], [2, 3]])).id).toBe(3)
    expect(topicByDeficit(topics, new Map(), (t) => t.id === 4)).toBeNull()
  })
})

describe('keywords', () => {
  it('filtra keywords inservibles', () => {
    expect(isUsableKeyword('como organizar un concierto')).toBe(true)
    expect(isUsableKeyword('teatro')).toBe(false) // una palabra
    expect(isUsableKeyword('ai tickets precios')).toBe(false) // marca propia
    expect(isUsableKeyword('www.passline.com eventos')).toBe(false)
  })

  it('fusiona candidatas de varias fuentes por su forma normalizada', () => {
    const map = new Map()
    mergeCandidate(map, 'Cómo organizar un concierto', { sources: ['planner'], planner_searches: 320 })
    mergeCandidate(map, 'como organizar un concierto', { sources: ['autocomplete'] })
    expect(map.size).toBe(1)
    const c = map.get('como organizar un concierto')
    expect([...c.sources]).toEqual(['planner', 'autocomplete'])
    expect(c.planner_searches).toBe(320)
  })

  it('agrega Search Console por consulta con posición ponderada y la página principal', () => {
    const out = aggregateGscQueries([
      { keys: ['preventa entradas', 'https://aitickets.cl/guias/como-hacer-una-preventa'], impressions: 90, clicks: 3, position: 8 },
      { keys: ['preventa entradas', 'https://aitickets.cl/precios'], impressions: 10, clicks: 0, position: 18 },
    ])
    expect(out).toEqual([{ query: 'preventa entradas', impressions: 100, clicks: 3, position: 9, page: 'https://aitickets.cl/guias/como-hacer-una-preventa' }])
  })

  it('las filas del upsert llevan siempre las mismas columnas y conservan lo no medido', () => {
    const now = '2026-11-09T00:00:00.000Z'
    const fresh = buildKeywordRow({ keyword: 'como organizar un concierto', normalized: 'como organizar un concierto', sources: new Set(['planner']), planner_searches: 500 }, null, { topic_id: 3, intent: 'informational', audience: 'producer', relevance: 90 }, now)
    const prev = { keyword: 'Cómo organizar un concierto', status: 'queued', note: null, topic_id: 7, intent: 'informational', relevance: 80, sources: ['manual'], gsc_clicks: 4, gsc_page: '/x', classified_at: '2026-10-01' }
    const known = buildKeywordRow({ keyword: 'como organizar un concierto', normalized: 'como organizar un concierto', sources: new Set(['autocomplete']) }, prev, null, now)
    expect(Object.keys(known).sort()).toEqual(Object.keys(fresh).sort())
    expect(fresh.status).toBe('new')
    expect(fresh.score).toBeGreaterThan(0)
    expect(known).toMatchObject({ status: 'queued', topic_id: 7, gsc_clicks: 4, gsc_page: '/x', classified_at: '2026-10-01', keyword: 'Cómo organizar un concierto' })
    expect(known.sources).toEqual(['manual', 'autocomplete'])
    // Una nueva clasificada para el público asistente queda descartada con motivo
    const attendee = buildKeywordRow({ keyword: 'entradas teatro hoy', normalized: 'entradas teatro hoy', sources: new Set(['search_console']) }, null, { topic_id: 2, intent: 'transactional', audience: 'attendee', relevance: 10 }, now)
    expect(attendee.status).toBe('rejected')
    expect(attendee.note).toMatch(/público/)
    // El tema puesto a mano manda sobre el de la IA
    const manual = buildKeywordRow({ keyword: 'x y', normalized: 'x y', sources: new Set() }, { ...prev, status: 'new', classified_at: null }, { topic_id: 9, intent: 'informational', audience: 'producer', relevance: 90 }, now)
    expect(manual.topic_id).toBe(7)
  })
})

describe('ficha del producto y catálogo interno', () => {
  it('toda landing y toda guía es enlazable desde el blog', () => {
    for (const l of LANDINGS) expect(isInternalPath(`/${l.slug}`), l.slug).toBe(true)
    for (const f of readdirSync('src/content/guias').filter((f) => f.endsWith('.md'))) {
      expect(isInternalPath(`/guias/${f.replace(/\.md$/, '')}`), f).toBe(true)
    }
    expect(new Set(INTERNAL_PAGES.map((p) => p.path)).size).toBe(INTERNAL_PAGES.length)
    expect(isInternalPath('/dashboard')).toBe(false)
    expect(isInternalPath('/blog/tema/teatro')).toBe(true)
  })

  it('las tarifas salen de fees.mjs', () => {
    expect(PRODUCT_FACTS.join(' ')).toContain(`${SERVICE_FEE_PERCENT_LABEL} del valor de la entrada`)
  })

  it('la etiqueta de caché del blog es la misma en el motor y en las páginas', () => {
    expect(BLOG_CACHE_TAG).toBe(BLOG_PAGES_TAG)
  })

  it('las reglas editoriales piden valor primero y AI Tickets solo al cierre', () => {
    expect(WRITER_SYSTEM).toContain(`## ${CLOSING_HEADING}`)
    expect(WRITER_SYSTEM).toMatch(/Primero entregas valor/)
    expect(WRITER_SYSTEM).toMatch(/Nunca inventes/)
  })
})

// Artículo de prueba: n secciones con párrafos de relleno
function articleBody({ sections = 6, words = 160, brand = 1, links = ['[preventas](/guias/como-hacer-una-preventa)', '[precios](/precios)'] } = {}) {
  const para = (i) => Array.from({ length: words }, (_, j) => `palabra${i}x${j}`).join(' ')
  const parts = ['Organizar un concierto en Chile requiere presupuesto, sala y difusión. Aquí tienes los pasos para organizar un concierto sin perder plata.']
  for (let i = 0; i < sections; i++) parts.push(`## Sección ${i + 1}\n\n${para(i)} ${links[i] || ''}`)
  parts.push(`## ${CLOSING_HEADING}\n\n${'Con AI Tickets publicas gratis. '.repeat(brand)}[Ver cómo funciona](/ticketera-musica-en-vivo).`)
  return parts.join('\n\n')
}

const rawArticle = (over = {}) => ({
  title: 'Cómo organizar un concierto: guía paso a paso',
  meta_title: 'Cómo organizar un concierto en Chile',
  meta_description: 'Presupuesto, sala, permisos y difusión: todo lo que necesitas para organizar un concierto en Chile sin perder plata, paso a paso y con ejemplos.',
  slug: 'organizar-concierto',
  excerpt: 'Los pasos para organizar un concierto.',
  body_markdown: articleBody(),
  faq: [
    { question: '¿Cuánto cuesta?', answer: 'Depende de la sala.' },
    { question: '¿Necesito permiso?', answer: 'Depende de la comuna.' },
    { question: '¿Cuándo vender?', answer: 'Con anticipación.' },
  ],
  secondary_keywords_used: ['organizar concierto pequeño'],
  ...over,
})

describe('validación de artículos', () => {
  it('quita links no permitidos y convierte H1 en H2', () => {
    const { body, stripped, cited } = sanitizeArticleLinks(
      '# Título\n[a](/precios) [b](/dashboard/x) [c](https://www.sii.cl/boleta) [d](https://otro.cl/x) [e](https://www.puntoticket.com/x) [f](https://aitickets.cl/precios) [g](/blog/otro)',
      { internalPaths: ['/blog/otro'], sourceUrls: ['https://www.sii.cl/boleta', 'https://www.puntoticket.com/x'] },
    )
    expect(body).toBe('## Título\n[a](/precios) b [c](https://www.sii.cl/boleta) d e [f](/precios) [g](/blog/otro)')
    expect(stripped).toEqual(['/dashboard/x', 'https://otro.cl/x', 'https://www.puntoticket.com/x'])
    expect(cited).toEqual(['https://www.sii.cl/boleta'])
  })

  it('un artículo completo pasa y queda listo para publicar', () => {
    const { ok, issues, article } = finalizeArticle(rawArticle(), {
      keyword: 'como organizar un concierto',
      landingPath: '/ticketera-musica-en-vivo',
      sources: [{ url: 'https://www.sii.cl/boleta', title: 'SII' }],
      existingSlugs: new Set(['organizar-concierto']),
    })
    expect(issues.filter((i) => i.level === 'error')).toEqual([])
    expect(ok).toBe(true)
    expect(article.slug).toBe('organizar-concierto-2')
    expect(article.word_count).toBeGreaterThan(800)
    expect(article.faq).toHaveLength(3)
    expect(article.sources).toEqual([{ url: 'https://www.sii.cl/boleta', title: 'SII', cited: false }])
  })

  it('no publica solo un artículo corto, promocional o que no trabaja la keyword', () => {
    const short = finalizeArticle(rawArticle({ body_markdown: articleBody({ words: 20 }) }), { keyword: 'como organizar un concierto' })
    expect(short.ok).toBe(false)
    expect(short.issues.map((i) => i.code)).toContain('too_short')
    const promo = finalizeArticle(rawArticle({ body_markdown: articleBody({ brand: 6 }) }), { keyword: 'como organizar un concierto' })
    expect(promo.issues.map((i) => i.code)).toContain('promotional')
    const offTopic = finalizeArticle(rawArticle({ title: 'Diez ideas para tu próxima fiesta', meta_title: 'Ideas para fiestas' }), { keyword: 'como organizar un concierto' })
    expect(offTopic.issues.map((i) => i.code)).toContain('keyword_title')
  })

  it('en un refresco el slug no cambia', () => {
    const { article } = finalizeArticle(rawArticle({ slug: 'otro-slug' }), { keyword: 'como organizar un concierto', fixedSlug: 'organizar-concierto' })
    expect(article.slug).toBe('organizar-concierto')
  })
})

describe('Search Console y Keyword Planner', () => {
  beforeEach(() => {
    _resetGoogleTokenCache()
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'cid')
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'csecret')
    vi.stubEnv('GOOGLE_OAUTH_REFRESH_TOKEN', 'rtoken')
    vi.stubEnv('GSC_SITE_URL', 'sc-domain:aitickets.cl')
    vi.stubEnv('GOOGLE_ADS_DEVELOPER_TOKEN', 'devtoken')
    vi.stubEnv('GOOGLE_ADS_CUSTOMER_ID', '123-456-7890')
    vi.stubEnv('GOOGLE_ADS_LOGIN_CUSTOMER_ID', '999-000-1111')
  })

  const fakeFetch = (handler) => {
    const calls = []
    const impl = async (url, init = {}) => {
      calls.push({ url: String(url), init })
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'ya29.x', expires_in: 3600 })
      return handler(String(url), init)
    }
    return { impl, calls }
  }

  it('Keyword Planner: Chile, español, headers de Ads y métricas numéricas', async () => {
    const { impl, calls } = fakeFetch(() =>
      Response.json({ results: [{ text: 'como organizar un concierto', keywordIdeaMetrics: { avgMonthlySearches: '320', competition: 'LOW', competitionIndex: '12', highTopOfPageBidMicros: '450000000' } }] }),
    )
    const ideas = await keywordIdeas(['como organizar un concierto'], { fetchImpl: impl })
    expect(ideas).toEqual([{ keyword: 'como organizar un concierto', searches: 320, competition: 'LOW', competition_index: 12, high_bid_micros: 450000000 }])
    const ads = calls.find((c) => c.url.includes('googleads.googleapis.com'))
    expect(ads.url).toBe('https://googleads.googleapis.com/v25/customers/1234567890:generateKeywordIdeas')
    expect(ads.init.headers).toMatchObject({ Authorization: 'Bearer ya29.x', 'developer-token': 'devtoken', 'login-customer-id': '9990001111' })
    const body = JSON.parse(ads.init.body)
    expect(body).toMatchObject({ language: 'languageConstants/1003', geoTargetConstants: ['geoTargetConstants/2152'], keywordPlanNetwork: 'GOOGLE_SEARCH' })
  })

  it('errores de Google llegan legibles', async () => {
    const { impl } = fakeFetch(() => Response.json({ error: { message: 'The caller does not have permission', details: [{ errors: [{ message: 'Developer token is not approved.' }] }] } }, { status: 403 }))
    await expect(keywordIdeas(['x y'], { fetchImpl: impl })).rejects.toThrow(/Developer token is not approved/)
  })

  it('Search Console pagina y usa la propiedad codificada', async () => {
    let page = 0
    const { impl, calls } = fakeFetch(() => Response.json({ rows: page++ === 0 ? [{ keys: ['a'] }, { keys: ['b'] }] : [{ keys: ['c'] }] }))
    const rows = await searchAnalytics({ ...gscWindow(28, new Date('2026-11-09T12:00:00Z')), dimensions: ['query'], maxRows: 4, pageSize: 2, fetchImpl: impl })
    expect(rows.map((r) => r.keys[0])).toEqual(['a', 'b', 'c'])
    const gsc = calls.filter((c) => c.url.includes('searchAnalytics'))
    expect(gsc[0].url).toBe('https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aaitickets.cl/searchAnalytics/query')
    expect(JSON.parse(gsc[0].init.body)).toMatchObject({ startDate: '2026-10-10', endDate: '2026-11-06', rowLimit: 2, startRow: 0 })
    // El token se pidió una sola vez
    expect(calls.filter((c) => c.url.includes('oauth2')).length).toBe(1)
  })
})

describe('Claude: investigación y JSON', () => {
  afterEach(() => _setAnthropicClient(null))

  const fakeClient = (responses) => {
    const params = []
    return {
      params,
      beta: { messages: { stream: (p) => (params.push(p), { finalMessage: async () => responses.shift() }) } },
    }
  }

  it('retoma pause_turn, junta fuentes citadas primero y descarta ticketeras y passline', async () => {
    const client = fakeClient([
      {
        stop_reason: 'pause_turn',
        model: 'claude-opus-5-5',
        usage: { input_tokens: 1000, output_tokens: 100, server_tool_use: { web_search_requests: 2 } },
        content: [
          { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://www.sii.cl/a', title: 'SII' }, { type: 'web_search_result', url: 'https://www.puntoticket.com/x', title: 'PT' }] },
        ],
      },
      {
        stop_reason: 'end_turn',
        model: 'claude-opus-5-5',
        usage: { input_tokens: 2000, output_tokens: 500, server_tool_use: { web_search_requests: 1 } },
        content: [
          { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://www.bcn.cl/ley', title: 'Ley' }, { type: 'web_search_result', url: 'https://passline.com/e', title: 'P' }] },
          { type: 'text', text: '- Dato (https://www.sii.cl/a)', citations: [{ url: 'https://www.bcn.cl/ley', title: 'Ley' }] },
        ],
      },
    ])
    _setAnthropicClient(client)
    const meter = { calls: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, web_searches: 0, usd: 0 }
    const out = await research({ system: 's', user: 'u', model: 'claude-opus-5-5', meter })
    expect(out.sources.map((s) => s.url)).toEqual(['https://www.bcn.cl/ley', 'https://www.sii.cl/a'])
    expect(client.params).toHaveLength(2)
    expect(client.params[0].tools[0]).toMatchObject({ type: 'web_search_20250305', blocked_domains: ['passline.com'], user_location: { country: 'CL' } })
    expect(client.params[0]).toMatchObject({ fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'] })
    expect(client.params[1].messages.at(-1).role).toBe('assistant')
    expect(meter).toMatchObject({ calls: 2, web_searches: 3, input_tokens: 3000, output_tokens: 600 })
    expect(meter.usd).toBeCloseTo((3000 * 4 + 600 * 20) / 1e6 + 0.03, 6)
  })

  it('un rechazo o una respuesta cortada no se usan', async () => {
    _setAnthropicClient(fakeClient([{ stop_reason: 'refusal', content: [], usage: {} }]))
    await expect(askJson({ system: 's', user: 'u', schema: {}, model: 'claude-opus-5-5' })).rejects.toThrow(/declinó/)
    _setAnthropicClient(fakeClient([{ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"a":' }], usage: {} }]))
    await expect(askJson({ system: 's', user: 'u', schema: {}, model: 'claude-opus-5-5' })).rejects.toThrow(/cortada/)
  })

  it('sin fallback del servidor en modelos que no lo aceptan', async () => {
    const client = fakeClient([{ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"ok":true}' }], usage: {} }])
    _setAnthropicClient(client)
    expect(await askJson({ system: 's', user: 'u', schema: {}, model: 'claude-haiku-5-5' })).toEqual({ ok: true })
    expect(client.params[0].fallbacks).toBeUndefined()
  })

  it('fuentes citables: https, sin ticketeras ni hosts prohibidos', () => {
    expect(isCitableSource('https://www.sii.cl/x')).toBe(true)
    expect(isCitableSource('http://www.sii.cl/x')).toBe(false)
    expect(isCitableSource('https://www.welcu.com/x')).toBe(false)
    expect(isCitableSource('https://www.passline.com/x')).toBe(false)
  })
})

describe('artículos publicados y Search Console', () => {
  it('reconoce URLs de artículos y agrupa consultas por artículo', () => {
    expect(blogSlugFromUrl('https://aitickets.cl/blog/organizar-concierto')).toBe('organizar-concierto')
    expect(blogSlugFromUrl('https://aitickets.cl/blog/tema/teatro')).toBeNull()
    expect(blogSlugFromUrl('https://aitickets.cl/guias/x')).toBeNull()
    const g = groupQueriesBySlug([
      { keys: ['https://aitickets.cl/blog/a', 'q1'], impressions: 5, clicks: 0, position: 12.34 },
      { keys: ['https://aitickets.cl/blog/a', 'q2'], impressions: 50, clicks: 2, position: 7 },
    ])
    expect(g.get('a').map((q) => q.query)).toEqual(['q2', 'q1'])
    expect(g.get('a')[1].position).toBe(12.3)
  })

  it('el link de vista previa sirve solo para su artículo y vence', () => {
    vi.stubEnv('INTERNAL_API_SECRET', 'x'.repeat(32))
    const now = new Date('2026-11-09T00:00:00Z')
    const t = signBlogPreview(42, now)
    expect(verifyBlogPreview(t, now)).toBe(42)
    expect(verifyBlogPreview(t, new Date('2026-12-01T00:00:00Z'))).toBeNull()
    expect(verifyBlogPreview(`${t}x`, now)).toBeNull()
  })
})

describe('generación completa (Supabase y Claude falsos)', () => {
  afterEach(() => _setAnthropicClient(null))

  const topics = [
    { id: 1, slug: 'musica-en-vivo', kind: 'niche', name: 'Música en vivo', description: 'Conciertos', landing_path: '/ticketera-musica-en-vivo', seed_keywords: [], weight: 8, active: true },
    { id: 2, slug: 'teatro', kind: 'niche', name: 'Teatro', description: 'Obras', landing_path: '/ticketera-teatro', seed_keywords: [], weight: 2, active: true },
  ]

  function llm({ coveredBy = '' } = {}) {
    return {
      beta: {
        messages: {
          stream: (p) => ({
            finalMessage: async () => {
              const schema = p.output_config?.format?.schema
              let text = ''
              if (p.tools) {
                return {
                  stop_reason: 'end_turn',
                  usage: { input_tokens: 10, output_tokens: 10 },
                  content: [
                    { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://www.sii.cl/boleta', title: 'SII' }] },
                    { type: 'text', text: '- Boleta electrónica (https://www.sii.cl/boleta)' },
                  ],
                }
              }
              if (schema?.required?.includes('covered_by')) {
                text = JSON.stringify({
                  covered_by: coveredBy,
                  secondary_keywords: ['organizar concierto pequeño', 'inventada'],
                  search_intent: 'aprender',
                  angle: 'práctico',
                  working_title: 't',
                  outline: ['a'],
                  questions: ['q'],
                  research_queries: ['r'],
                })
              } else {
                text = JSON.stringify(rawArticle({ body_markdown: `${articleBody()}\n\nDato del [SII](https://www.sii.cl/boleta).` }))
              }
              return { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text }] }
            },
          }),
        },
      },
    }
  }

  const db = () =>
    createFakeSupabase({
      tables: {
        aitickets_blog_topics: topics,
        aitickets_blog_keywords: [
          { id: 10, keyword: 'como organizar un concierto', normalized: 'como organizar un concierto', topic_id: 1, status: 'new', score: 80 },
          { id: 11, keyword: 'organizar concierto pequeño', normalized: 'organizar concierto pequeno', topic_id: 1, status: 'new', score: 60 },
          { id: 12, keyword: 'como difundir una obra', normalized: 'como difundir una obra', topic_id: 2, status: 'new', score: 70 },
        ],
        aitickets_blog_posts: [],
      },
    })

  it('elige por cuota, escribe, publica y marca la keyword y sus secundarias como usadas', async () => {
    _setAnthropicClient(llm())
    const supabase = db()
    const out = await generatePost(supabase, { publish: true, model: 'claude-opus-5-5' })
    expect(out).toMatchObject({ status: 'published', keyword: 'como organizar un concierto', topic: 'musica-en-vivo', slug: 'organizar-concierto' })
    const post = supabase.tables.aitickets_blog_posts[0]
    expect(post).toMatchObject({ topic_id: 1, status: 'published', primary_keyword: 'como organizar un concierto' })
    expect(post.published_at).toBeTruthy()
    expect(post.sources[0]).toMatchObject({ url: 'https://www.sii.cl/boleta', cited: true })
    const kw = Object.fromEntries(supabase.tables.aitickets_blog_keywords.map((k) => [k.id, k]))
    expect(kw[10]).toMatchObject({ status: 'used', post_id: post.id })
    expect(kw[11]).toMatchObject({ status: 'used', post_id: post.id })
    expect(kw[12].status).toBe('new')
  })

  it('sin autopublicación queda en borrador', async () => {
    _setAnthropicClient(llm())
    const supabase = db()
    const out = await generatePost(supabase, { publish: false, model: 'claude-opus-5-5' })
    expect(out.status).toBe('draft')
    expect(supabase.tables.aitickets_blog_posts[0].published_at).toBeNull()
  })

  it('si otra página ya responde la búsqueda, la descarta y prueba la siguiente', async () => {
    _setAnthropicClient(llm({ coveredBy: '/ticketera-musica-en-vivo' }))
    const supabase = db()
    const out = await generatePost(supabase, { publish: true, model: 'claude-opus-5-5' })
    expect(out.skipped).toBeTruthy()
    expect(supabase.tables.aitickets_blog_posts).toHaveLength(0)
    const k10 = supabase.tables.aitickets_blog_keywords.find((k) => k.id === 10)
    expect(k10).toMatchObject({ status: 'rejected', note: 'La responde /ticketera-musica-en-vivo' })
  })

  it('una keyword priorizada a mano va antes que la cuota', async () => {
    _setAnthropicClient(llm())
    const supabase = db()
    supabase.tables.aitickets_blog_keywords.find((k) => k.id === 12).status = 'queued'
    const out = await generatePost(supabase, { publish: true, model: 'claude-opus-5-5' })
    expect(out.keyword).toBe('como difundir una obra')
    expect(out.topic).toBe('teatro')
  })
})

describe('descubrimiento de keywords y corridas', () => {
  afterEach(() => _setAnthropicClient(null))

  it('junta Planner y autocompletado, clasifica con IA y guarda con puntaje y estado', async () => {
    _resetGoogleTokenCache()
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'cid')
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'cs')
    vi.stubEnv('GOOGLE_OAUTH_REFRESH_TOKEN', 'rt')
    vi.stubEnv('GOOGLE_ADS_DEVELOPER_TOKEN', 'dt')
    vi.stubEnv('GOOGLE_ADS_CUSTOMER_ID', '1234567890')
    const fetchImpl = async (url) => {
      const u = String(url)
      if (u.startsWith('https://oauth2.googleapis.com')) return Response.json({ access_token: 't', expires_in: 3600 })
      if (u.includes('generateKeywordIdeas')) {
        return Response.json({
          results: [
            { text: 'como organizar un concierto', keywordIdeaMetrics: { avgMonthlySearches: '480', competition: 'LOW' } },
            { text: 'entradas concierto hoy', keywordIdeaMetrics: { avgMonthlySearches: '9000', competition: 'HIGH' } },
          ],
        })
      }
      if (u.includes('suggestqueries')) return new Response(JSON.stringify(['x', ['cuanto cuesta organizar un concierto']]), { headers: { 'content-type': 'application/json; charset=utf-8' } })
      throw new Error(`fetch inesperado ${u}`)
    }
    _setAnthropicClient({
      beta: {
        messages: {
          stream: (p) => ({
            finalMessage: async () => {
              const list = p.messages[0].content.split('Keywords:\n')[1].split('\n')
              const items = list.map((line) => {
                const [i, ...rest] = line.split('. ')
                const kw = rest.join('. ')
                const attendee = kw.startsWith('entradas')
                return { i: Number(i), topic: 'musica-en-vivo', intent: attendee ? 'transactional' : 'informational', audience: attendee ? 'attendee' : 'producer', relevance: attendee ? 10 : 90 }
              })
              return { stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: JSON.stringify({ items }) }] }
            },
          }),
        },
      },
    })
    const { discoverKeywords } = await import('../../netlify/lib/blog/keywords.mjs')
    const supabase = createFakeSupabase({
      tables: {
        aitickets_blog_topics: [{ id: 1, slug: 'musica-en-vivo', name: 'Música en vivo', description: 'Conciertos', seed_keywords: ['como organizar un concierto'], weight: 8, active: true }],
        aitickets_blog_keywords: [{ id: 5, keyword: 'rider tecnico banda', normalized: 'rider tecnico banda', topic_id: 1, status: 'queued', sources: ['manual'], classified_at: null }],
      },
    })
    const out = await discoverKeywords(supabase, { topicSlug: 'musica-en-vivo', fetchImpl })
    expect(out).toMatchObject({ sources: { planner: 2, autocomplete: 1 }, rejected: 1 })
    const byNorm = Object.fromEntries(supabase.tables.aitickets_blog_keywords.map((k) => [k.normalized, k]))
    expect(byNorm['como organizar un concierto']).toMatchObject({ status: 'new', topic_id: 1, planner_searches: 480, planner_competition: 'LOW', intent: 'informational' })
    expect(byNorm['como organizar un concierto'].score).toBeGreaterThan(MIN_AUTO_SCORE)
    expect(byNorm['como organizar un concierto'].sources.sort()).toEqual(['planner', 'seed'])
    expect(byNorm['entradas concierto hoy']).toMatchObject({ status: 'rejected' })
    expect(byNorm['cuanto cuesta organizar un concierto']).toMatchObject({ status: 'new', sources: ['autocomplete'] })
    // La agregada a mano se clasificó y sigue priorizada
    expect(byNorm['rider tecnico banda']).toMatchObject({ status: 'queued', intent: 'informational' })
    expect(byNorm['rider tecnico banda'].classified_at).toBeTruthy()
  })

  it('la corrida queda en la bitácora con su costo; plannedTasks dice qué toca', async () => {
    const { runBlogTask, plannedTasks } = await import('../../netlify/lib/blog/runner.mjs')
    const supabase = createFakeSupabase({ tables: { aitickets_blog_topics: [], aitickets_blog_keywords: [], aitickets_blog_posts: [], aitickets_blog_runs: [] } })
    expect(await plannedTasks(supabase)).toEqual(['keywords', 'generate'])
    const out = await runBlogTask(supabase, { task: 'generate', trigger: 'admin' })
    expect(out).toMatchObject({ task: 'generate', status: 'skipped' })
    const run = supabase.tables.aitickets_blog_runs[0]
    expect(run).toMatchObject({ task: 'generate', trigger: 'admin', status: 'skipped' })
    expect(run.details.cost).toMatchObject({ usd: 0 })
    expect(run.finished_at).toBeTruthy()
  })
})

describe('render de artículos (src/lib/blog.ts)', () => {
  it('Markdown → HTML seguro con tablas, índice y links externos en otra pestaña', async () => {
    const { renderArticle } = await import('../../src/lib/blog.ts')
    const { html, toc } = renderArticle(
      'Intro con [fuente](https://www.sii.cl/x) y [precios](/precios).\n\n## Qué es una preventa\n\nTexto <script>alert(1)</script>\n\n## Qué es una preventa\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n<iframe src="https://x"></iframe>',
    )
    expect(toc).toEqual([
      { id: 'que-es-una-preventa', text: 'Qué es una preventa' },
      { id: 'que-es-una-preventa-2', text: 'Qué es una preventa' },
    ])
    expect(html).toContain('<h2 id="que-es-una-preventa">Qué es una preventa</h2>')
    expect(html).toContain('<a href="https://www.sii.cl/x" target="_blank" rel="noopener">fuente</a>')
    expect(html).toContain('<a href="/precios">precios</a>')
    expect(html).toContain('<table>')
    expect(html).not.toMatch(/<script|<iframe|alert\(1\)/)
  })
})
