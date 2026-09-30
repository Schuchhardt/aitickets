// Leads desde Passline: SOLO resultados de búsqueda (nunca se visita passline.com), extracción, dedupe,
// agrupación en leads, enriquecimiento de contactos, exportación CSV e interruptores.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import {
  assertNoForbiddenFetch, createFirecrawlBudget, FirecrawlBudgetError, parseSearchResponse, search,
} from '../../netlify/lib/firecrawl.mjs'
import {
  cleanTitle, collectPasslineEvents, decodeHtmlEntities, DEFAULT_QUERIES, extractWithClaude, findLeadContacts,
  getPasslineConfig, groupEventsIntoLeads, leadKeyFor, normalizeName, parseResultHeuristics, parseSpanishDate,
  passlineEventUrl, passlineWatchGate, pickContactsFromResults, runPasslineWatch, seedEventsFromPasslineJson,
} from '../../netlify/lib/leads/passline-watch.mjs'
import { buildLeadsCsv, CSV_COLUMNS, csvCell, filterExportableLeads, leadPriority } from '../../netlify/lib/leads/export.mjs'
import { crawlSite, instagramHandleFromUrl, whatsappFromUrl } from '../../netlify/lib/outreach/enrich.mjs'
import { isNeverFetchUrl } from '../../netlify/lib/outreach/domains.mjs'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const TODAY = new Date('2026-09-30T12:00:00Z')

describe('filtro de URLs de Passline', () => {
  it('acepta solo páginas de evento passline.com/eventos/<slug> y las canoniza', () => {
    expect(passlineEventUrl('https://www.passline.com/eventos/stand-up-juan')).toBe('https://www.passline.com/eventos/stand-up-juan')
    expect(passlineEventUrl('http://passline.com/eventos/Stand-Up-Juan/?utm=x#a')).toBe('https://www.passline.com/eventos/stand-up-juan')
    expect(passlineEventUrl('https://www.passline.com/eventos/')).toBeNull()
    expect(passlineEventUrl('https://www.passline.com/eventos/a/b')).toBeNull()
    expect(passlineEventUrl('https://www.passline.com/productora/xyz')).toBeNull()
    expect(passlineEventUrl('https://home.passline.com/eventos/x')).toBeNull()
    expect(passlineEventUrl('https://passline.com.evil.cl/eventos/x')).toBeNull()
    expect(passlineEventUrl('https://www.puntoticket.com/eventos/x')).toBeNull()
  })

  it('une resultados repetidos por URL y descarta los que no son eventos', () => {
    const events = collectPasslineEvents([
      { query: 'q1', results: [
        { url: 'https://www.passline.com/eventos/a', title: 'A | Passline', description: 'corto' },
        { url: 'https://www.instagram.com/foo/', title: 'foo', description: '' },
      ] },
      { query: 'q2', results: [{ url: 'https://passline.com/eventos/a/', title: 'A', description: 'un snippet más largo' }] },
    ])
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ url: 'https://www.passline.com/eventos/a', description: 'un snippet más largo', queries: ['q1', 'q2'] })
  })
})

describe('extracción heurística de título/snippet', () => {
  it('limpia el título y extrae recinto, comuna, fecha, categoría y productor etiquetado', () => {
    const r = parseResultHeuristics({
      title: 'Entradas Stand Up de Juan Pérez | Passline',
      description: 'Sábado 12 de octubre en Teatro Mori Bellavista, Providencia. Organiza: Productora Risa SpA.',
    }, TODAY)
    expect(r).toEqual({
      event_title: 'Stand Up de Juan Pérez',
      producer_name: 'Productora Risa SpA',
      venue: 'Teatro Mori Bellavista',
      city: 'Providencia',
      event_date: '2026-10-12',
      category: 'stand_up',
    })
  })

  it('nunca adivina el productor: sin etiqueta explícita queda null', () => {
    const r = parseResultHeuristics({ title: 'Los Tres en vivo - Passline', description: 'Los Tres presentan su gira en Sala SCD Bellavista, Santiago.' }, TODAY)
    expect(r.producer_name).toBeNull()
    expect(r.city).toBe('Santiago')
    expect(r.category).toBe('musica')
  })

  it('fechas: dd/mm/aaaa, ISO, abreviadas y sin año (año siguiente si ya pasó)', () => {
    expect(parseSpanishDate('funciones el 05/11/2026', TODAY)).toBe('2026-11-05')
    expect(parseSpanishDate('2026-12-01 20:00', TODAY)).toBe('2026-12-01')
    expect(parseSpanishDate('Vie 3 oct · 21:00', TODAY)).toBe('2026-10-03')
    expect(parseSpanishDate('14 de marzo', TODAY)).toBe('2027-03-14')
    expect(parseSpanishDate('sin fecha', TODAY)).toBeNull()
  })

  it('decodifica entidades dobles del archivo de Passline y limpia títulos', () => {
    expect(decodeHtmlEntities('&amp;Ntilde;u&amp;ntilde;oa')).toBe('Ñuñoa')
    expect(cleanTitle('Passline - Entradas para Hamlet')).toBe('Hamlet')
  })
})

describe('dedupe y agrupación en leads', () => {
  it('normaliza nombres (tildes, puntuación, sufijos societarios) para la clave del lead', () => {
    expect(normalizeName('Productora Risa SpA.')).toBe('productora risa')
    expect(leadKeyFor({ type: 'producer', name: 'PRODUCTORA RISÁ spa', city: 'Ñuñoa' })).toBe('producer:productora risa')
    expect(leadKeyFor({ type: 'venue', name: 'Teatro Mori', city: 'Providencia' })).toBe('venue:teatro mori|providencia')
    expect(leadKeyFor({ type: 'venue', name: 'Teatro Mori', city: 'Santiago' })).not.toBe(leadKeyFor({ type: 'venue', name: 'Teatro Mori', city: 'Providencia' }))
  })

  it('agrupa por productor; sin productor usa el recinto (tipo venue); sin ninguno, fuera', () => {
    const groups = groupEventsIntoLeads([
      { url: 'u1', title: 'A', producer_name: 'Risa SpA', venue: 'Teatro Mori', city: 'Providencia', event_date: '2026-10-01', category: 'stand_up' },
      { url: 'u2', title: 'B', producer_name: 'RISA', venue: 'Sala X', city: 'Santiago', event_date: '2026-11-01', category: 'comedia' },
      { url: 'u3', title: 'C', producer_name: null, venue: 'Teatro Mori', city: 'Providencia', event_date: null, category: 'teatro' },
      { url: 'u4', title: 'D', producer_name: null, venue: null, city: 'Santiago' },
    ])
    expect(groups).toHaveLength(2)
    const producer = groups.find((g) => g.type === 'producer')
    expect(producer).toMatchObject({ name_key: 'producer:risa', categories: ['stand_up', 'comedia'] })
    expect(producer.events.map((e) => e.url)).toEqual(['u1', 'u2'])
    expect(producer.last_event).toMatchObject({ url: 'u2', date: '2026-11-01' })
    expect(groups.find((g) => g.type === 'venue')).toMatchObject({ name_key: 'venue:teatro mori|providencia', city: 'Providencia' })
  })
})

describe('guardia: nunca visitar passline.com', () => {
  it('isNeverFetchUrl cubre passline.com y subdominios', () => {
    expect(isNeverFetchUrl('https://www.passline.com/eventos/x')).toBe(true)
    expect(isNeverFetchUrl('https://imagenes.passline.com/a.jpg')).toBe(true)
    expect(isNeverFetchUrl('passline.com')).toBe(true)
    expect(isNeverFetchUrl('https://notpassline.com')).toBe(false)
  })

  it('Firecrawl: scrape/crawl con passline y scrapeOptions en la búsqueda lanzan antes de salir a la red', () => {
    expect(() => assertNoForbiddenFetch('/v2/scrape', { url: 'https://www.passline.com/eventos/x' })).toThrow(/prohibido/)
    expect(() => assertNoForbiddenFetch('/v2/crawl', { url: 'passline.com' })).toThrow(/prohibido/)
    expect(() => assertNoForbiddenFetch('/v2/batch/scrape', { urls: ['https://a.cl', 'https://passline.com/eventos/y'] })).toThrow(/prohibido/)
    expect(() => assertNoForbiddenFetch('/v2/scrape', { url: 'https://productora.cl' })).toThrow(/no habilitado/)
    expect(() => assertNoForbiddenFetch('/v2/search', { query: 'site:passline.com', scrapeOptions: { formats: ['markdown'] } })).toThrow(/scrapeOptions/)
    expect(() => assertNoForbiddenFetch('/v2/search', { query: 'site:passline.com/eventos teatro' })).not.toThrow()
  })

  it('search() solo llama a /v2/search, sin scrapeOptions, y cuenta créditos', async () => {
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc-test')
    const calls = []
    vi.stubGlobal('fetch', async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) })
      return Response.json({ success: true, creditsUsed: 2, data: { web: [{ url: 'https://www.passline.com/eventos/a', title: 'A', description: 'd' }] } })
    })
    const budget = createFirecrawlBudget(10)
    const r = await search('site:passline.com/eventos teatro', { limit: 10, budget })
    expect(r).toEqual([{ url: 'https://www.passline.com/eventos/a', title: 'A', description: 'd' }])
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.firecrawl.dev/v2/search')
    expect(calls[0].body.scrapeOptions).toBeUndefined()
    expect(calls[0].body).toMatchObject({ country: 'CL', sources: ['web'] })
    expect(budget.used).toBe(2)
  })

  it('search() exige FIRECRAWL_API_KEY y respeta el tope de créditos', async () => {
    await expect(search('x')).rejects.toThrow(/FIRECRAWL_API_KEY/)
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc-test')
    await expect(search('x', { budget: createFirecrawlBudget(1) })).rejects.toBeInstanceOf(FirecrawlBudgetError)
  })

  it('parseSearchResponse acepta v2 (data.web) y v1 (data[])', () => {
    expect(parseSearchResponse({ data: [{ url: 'https://a.cl', title: 't', description: 'd' }] })).toHaveLength(1)
    expect(parseSearchResponse({ data: { web: [{ metadata: { url: 'https://b.cl', title: 'T' } }] } })[0]).toMatchObject({ url: 'https://b.cl', title: 'T' })
    expect(parseSearchResponse(null)).toEqual([])
  })

  it('crawlSite nunca visita passline ni otras ticketeras (sin fetch)', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(await crawlSite('https://www.passline.com/eventos/x')).toMatchObject({ error: 'not_owned_site', pages: [] })
    expect(await crawlSite('https://ticketplus.cl/x')).toMatchObject({ error: 'not_owned_site' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('crawlSite no sigue una redirección hacia passline', async () => {
    const lookup = async () => [{ address: '93.184.216.34' }]
    const urls = []
    vi.stubGlobal('fetch', async (url) => {
      urls.push(String(url))
      return new Response('', { status: 302, headers: { location: 'https://www.passline.com/eventos/x' } })
    })
    const r = await crawlSite('https://productora.cl', { lookup })
    expect(urls.every((u) => !isNeverFetchUrl(u))).toBe(true)
    expect(r.pages).toEqual([])
  })

  it('el enriquecimiento nunca elige passline/ticketeras/prensa como sitio propio', () => {
    const picked = pickContactsFromResults([
      { url: 'https://www.passline.com/eventos/risa-comedia', title: 'Risa Comedia', description: '' },
      { url: 'https://www.puntoticket.com/risa-comedia', title: 'Risa Comedia', description: '' },
      { url: 'https://www.latercera.com/risa-comedia-nota', title: 'Risa Comedia en La Tercera', description: '' },
      { url: 'https://www.instagram.com/p/abc/', title: 'post', description: '' },
      { url: 'https://www.instagram.com/risacomedia.cl/', title: 'Risa Comedia (@risacomedia.cl)', description: 'Contacto: hola@risacomedia.cl' },
      { url: 'https://risacomedia.cl/contacto', title: 'Contacto - Risa Comedia', description: 'Escríbenos a hola@risacomedia.cl' },
    ], 'Risa Comedia')
    expect(picked.website).toEqual({ url: 'https://risacomedia.cl/', sourceUrl: 'https://risacomedia.cl/contacto' })
    expect(picked.instagram).toEqual({ handle: 'risacomedia.cl', url: 'https://www.instagram.com/risacomedia.cl/' })
    expect(picked.snippetEmails.map((e) => e.email)).toContain('hola@risacomedia.cl')
  })

  it('no toma un sitio cuyo dominio no corresponde al nombre', () => {
    const picked = pickContactsFromResults([{ url: 'https://otraagencia.cl/', title: 'Risa Comedia – portafolio', description: '' }], 'Risa Comedia')
    expect(picked.website).toBeNull()
  })
})

describe('WhatsApp e Instagram desde enlaces', () => {
  it('extrae números de wa.me/api.whatsapp.com y handles de perfiles (no publicaciones)', () => {
    expect(whatsappFromUrl('https://wa.me/56912345678')).toBe('56912345678')
    expect(whatsappFromUrl('https://api.whatsapp.com/send?phone=+56 9 1234 5678&text=hola')).toBe('56912345678')
    expect(whatsappFromUrl('https://wa.me/123')).toBeNull()
    expect(whatsappFromUrl('https://example.com/56912345678')).toBeNull()
    expect(instagramHandleFromUrl('https://www.instagram.com/Teatro.Mori/')).toBe('teatro.mori')
    expect(instagramHandleFromUrl('https://instagram.com/p/Cxyz/')).toBeNull()
    expect(instagramHandleFromUrl('https://instagram.com/reel/abc')).toBeNull()
  })
})

describe('extracción con Claude (una llamada batch)', () => {
  const events = [
    { url: 'https://www.passline.com/eventos/a', title: 'A | Passline', description: 'Organiza: Risa SpA. Teatro Mori.' },
    { url: 'https://www.passline.com/eventos/b', title: 'B', description: 'En Sala X' },
  ]

  it('hace UNA llamada con salida estructurada y descarta URLs inventadas y productor = recinto', async () => {
    const create = vi.fn(async () => ({
      stop_reason: 'end_turn',
      usage: { input_tokens: 500, output_tokens: 200 },
      content: [{ type: 'text', text: JSON.stringify({ events: [
        { url: 'https://www.passline.com/eventos/a', event_title: 'A', producer_or_organizer_name: 'Risa SpA', venue: 'Teatro Mori', city: 'Providencia', event_date: '2026-10-10', category: 'stand_up' },
        { url: 'https://www.passline.com/eventos/b', event_title: 'B', producer_or_organizer_name: 'Sala X', venue: 'Sala X', city: null, event_date: 'mañana', category: 'otro' },
        { url: 'https://www.passline.com/eventos/inventado', event_title: 'Z', producer_or_organizer_name: 'Z', venue: null, city: null, event_date: null, category: 'teatro' },
      ] }) }],
    }))
    const tokenBudget = { limit: 10_000, used: 0, calls: 0 }
    const out = await extractWithClaude(events, { anthropic: { messages: { create } }, model: 'claude-haiku-4-5', tokenBudget, today: TODAY })
    expect(create).toHaveBeenCalledTimes(1)
    const req = create.mock.calls[0][0]
    expect(req.model).toBe('claude-haiku-4-5')
    expect(req.output_config.format.type).toBe('json_schema')
    expect(req.messages[0].content).toContain('<untrusted')
    expect(out.size).toBe(2)
    expect(out.get('https://www.passline.com/eventos/a')).toMatchObject({ producer_name: 'Risa SpA', event_date: '2026-10-10', category: 'stand_up' })
    expect(out.get('https://www.passline.com/eventos/b')).toMatchObject({ producer_name: null, event_date: null, category: null })
    expect(tokenBudget.used).toBe(700)
  })

  it('sin presupuesto de tokens no llama a Claude', async () => {
    const create = vi.fn()
    const out = await extractWithClaude(events, { anthropic: { messages: { create } }, model: 'm', tokenBudget: { limit: 100, used: 90 } })
    expect(create).not.toHaveBeenCalled()
    expect(out.size).toBe(0)
  })
})

// RPC falsa con la misma semántica que aitickets_touch_competitor_events.
function touchRpc() {
  return {
    aitickets_touch_competitor_events: ({ p_rows, p_seen_via }, state) => {
      const rows = (state.aitickets_competitor_events ||= [])
      return p_rows.map((r) => {
        const existing = rows.find((x) => x.url === r.url)
        if (existing) {
          existing.times_seen += 1
          existing.producer_name = existing.producer_name || r.producer_name
          return { id: existing.id, url: r.url, lead_id: existing.lead_id, inserted: false }
        }
        const row = { id: rows.length + 1, ...r, seen_via: p_seen_via, times_seen: 1, lead_id: null }
        rows.push(row)
        return { id: row.id, url: r.url, lead_id: null, inserted: true }
      })
    },
  }
}

function fakeSearch(map) {
  const calls = []
  const fn = async (query) => {
    calls.push(query)
    for (const [k, v] of Object.entries(map)) if (query.includes(k)) return v
    return []
  }
  fn.calls = calls
  return fn
}

describe('runPasslineWatch', () => {
  const passlineResults = [
    { url: 'https://www.passline.com/eventos/risa-1', title: 'Risa en vivo | Passline', description: '12 de octubre en Teatro Mori Bellavista, Providencia. Organiza: Risa Comedia.' },
    { url: 'https://www.passline.com/eventos/risa-2', title: 'Risa 2 | Passline', description: '20 de octubre en Sala Master, Santiago. Organiza: Risa Comedia.' },
    { url: 'https://www.passline.com/eventos/hamlet', title: 'Hamlet | Passline', description: 'Teatro Aurora, Valparaíso.' },
    { url: 'https://www.passline.com/', title: 'Passline', description: '' },
  ]

  function setup(extraTables = {}) {
    vi.stubEnv('LEADS_PASSLINE_QUERIES', 'site:passline.com/eventos stand up santiago')
    vi.stubEnv('LEADS_ENRICH_PER_RUN', '5')
    const db = createFakeSupabase({ tables: { aitickets_competitor_events: [], aitickets_leads: [], aitickets_suppressions: [], ...extraTables }, rpc: touchRpc() })
    const search = fakeSearch({
      'site:passline.com': passlineResults,
      '"Risa Comedia" contacto': [{ url: 'https://risacomedia.cl/', title: 'Risa Comedia', description: '' }],
      '"Risa Comedia" instagram': [{ url: 'https://www.instagram.com/risacomedia/', title: 'Risa Comedia', description: '' }],
    })
    const crawl = vi.fn(async () => ({ pages: [{}], email: 'hola@risacomedia.cl', emailSourceUrl: 'https://risacomedia.cl/contacto', whatsapp: [{ number: '56912345678', url: 'https://risacomedia.cl/' }], instagram: [] }))
    return { db, search, crawl }
  }

  it('guarda eventos y leads (manual_only, source passline_search, status new) y enriquece con fuentes', async () => {
    const { db, search, crawl } = setup()
    const s = await runPasslineWatch({ supabase: db, deps: { search, anthropic: null, crawl }, now: TODAY })
    expect(s.passlineUrls).toBe(3)
    expect(s.newEvents).toBe(3)
    expect(s.leadsInserted).toBe(2)
    const leads = db.tables.aitickets_leads
    const risa = leads.find((l) => l.name_key === 'producer:risa comedia')
    expect(risa).toMatchObject({ source: 'passline_search', status: 'new', manual_only: true, lead_type: 'producer', events_on_passline: 2, current_ticketing: 'passline' })
    expect(risa.last_passline_event).toMatchObject({ url: 'https://www.passline.com/eventos/risa-2', date: '2026-10-20' })
    expect(risa).toMatchObject({ website: 'https://risacomedia.cl/', instagram: 'risacomedia', email: 'hola@risacomedia.cl', whatsapp: '56912345678' })
    expect(risa.contact_sources.map((c) => c.field).sort()).toEqual(['email', 'instagram', 'website', 'whatsapp'])
    expect(risa.contact_sources.find((c) => c.field === 'email').url).toBe('https://risacomedia.cl/contacto')
    expect(leads.find((l) => l.lead_type === 'venue')).toMatchObject({ name_key: 'venue:teatro aurora|valparaiso' })
    expect(db.tables.aitickets_competitor_events.every((e) => e.lead_id)).toBe(true)
    // Nunca se visitó passline: crawl solo recibió el sitio propio.
    for (const [url] of crawl.mock.calls) expect(isNeverFetchUrl(url)).toBe(false)
  })

  it('segunda corrida: incrementa times_seen, no duplica leads y nunca cambia el status de un lead contactado', async () => {
    const { db, search, crawl } = setup()
    await runPasslineWatch({ supabase: db, deps: { search, anthropic: null, crawl }, now: TODAY, enrich: false })
    const risa = db.tables.aitickets_leads.find((l) => l.name_key === 'producer:risa comedia')
    risa.status = 'contacted'
    const s2 = await runPasslineWatch({ supabase: db, deps: { search, anthropic: null, crawl }, now: TODAY, enrich: false })
    expect(s2.leadsInserted).toBe(0)
    expect(s2.leadsUpdated).toBe(2)
    expect(db.tables.aitickets_leads).toHaveLength(2)
    expect(risa.status).toBe('contacted')
    expect(db.tables.aitickets_competitor_events.every((e) => e.times_seen === 2)).toBe(true)
    expect(db.calls.filter((c) => c.table === 'aitickets_leads' && c.op === 'update').every((c) => !('status' in (c.values || {})))).toBe(true)
  })

  it('a un lead suprimido no se le actualiza nada (solo se vinculan los eventos)', async () => {
    const { db, search, crawl } = setup({
      aitickets_leads: [{ id: 'l1', name_key: 'producer:risa comedia', org_name: 'Risa Comedia', status: 'suppressed', source: 'passline_search', source_refs: [] }],
    })
    await runPasslineWatch({ supabase: db, deps: { search, anthropic: null, crawl }, now: TODAY, enrich: false })
    const lead = db.tables.aitickets_leads.find((l) => l.id === 'l1')
    expect(lead.status).toBe('suppressed')
    expect(lead.source_refs).toEqual([])
  })

  it('dry-run no escribe nada en la BD y devuelve el plan', async () => {
    const { db, search, crawl } = setup()
    const s = await runPasslineWatch({ supabase: db, dryRun: true, deps: { search, anthropic: null, crawl }, now: TODAY })
    expect(db.calls.filter((c) => c.op !== 'select')).toEqual([])
    expect(s.plan.events).toHaveLength(3)
    expect(s.plan.leads.find((l) => l.org_name === 'Risa Comedia')).toMatchObject({ email: 'hola@risacomedia.cl', events_on_passline: 2 })
  })

  it('dry-run lee la lista de supresión: el lead suprimido sale con status suppressed y el plan queda revisado', async () => {
    const { db, search, crawl } = setup({ aitickets_suppressions: [{ id: 1, email: null, domain: 'risacomedia.cl' }] })
    const s = await runPasslineWatch({ supabase: db, dryRun: true, deps: { search, anthropic: null, crawl }, now: TODAY })
    expect(db.calls.filter((c) => c.op !== 'select')).toEqual([])
    expect(s.plan.suppressionChecked).toBe(true)
    const risa = s.plan.leads.find((l) => l.org_name === 'Risa Comedia')
    expect(risa.status).toBe('suppressed')
    expect(risa.email).toBeUndefined()
    expect(filterExportableLeads(s.plan.leads).leads.map((l) => l.org_name)).not.toContain('Risa Comedia')
  })

  it('dry-run sin cliente: el plan queda marcado como no revisado', async () => {
    const { search, crawl } = setup()
    const s = await runPasslineWatch({ supabase: null, dryRun: true, deps: { search, anthropic: null, crawl }, now: TODAY })
    expect(s.plan.suppressionChecked).toBe(false)
  })

  it('correo suprimido: el lead pasa a suppressed (no queda como new con Instagram/WhatsApp)', async () => {
    const { db, search, crawl } = setup({ aitickets_suppressions: [{ id: 1, email: 'hola@risacomedia.cl', domain: null }] })
    const s = await runPasslineWatch({ supabase: db, deps: { search, anthropic: null, crawl }, now: TODAY })
    const risa = db.tables.aitickets_leads.find((l) => l.name_key === 'producer:risa comedia')
    expect(risa.status).toBe('suppressed')
    expect(risa.next_action_at).toBeNull()
    expect(risa.email ?? null).toBeNull()
    expect(s.suppressed).toBe(1)
  })

  it('dominio que ya tiene otro lead (outreach): se funde sin tocar su status y el de Passline queda invalid', async () => {
    const { db, search, crawl } = setup({
      aitickets_leads: [{ id: 'o1', org_name: 'Risa Comedia SpA', domain: 'risacomedia.cl', email: 'contacto@risacomedia.cl', status: 'contacted', source: 'websearch', source_refs: [{ source: 'websearch', url: 'https://x.cl' }], categories: ['comedia'] }],
    })
    const s = await runPasslineWatch({ supabase: db, deps: { search, anthropic: null, crawl }, now: TODAY })
    expect(s.duplicates).toBe(1)
    const other = db.tables.aitickets_leads.find((l) => l.id === 'o1')
    const risa = db.tables.aitickets_leads.find((l) => l.name_key === 'producer:risa comedia')
    expect(other.status).toBe('contacted')
    expect(other.domain).toBe('risacomedia.cl')
    expect(other.email).toBe('contacto@risacomedia.cl')
    expect(other.current_ticketing).toBe('passline')
    expect(other.events_on_passline).toBe(2)
    expect(other.source_refs.some((r) => r.source === 'passline_search')).toBe(true)
    expect(risa).toMatchObject({ status: 'invalid', invalid_reason: 'duplicate_of:o1', events_on_passline: 0 })
    expect(risa.domain ?? null).toBeNull()
    expect(db.tables.aitickets_competitor_events.filter((e) => e.lead_id === 'o1')).toHaveLength(2)
    // Siguiente corrida: los eventos siguen yendo al lead existente, y su status no cambia.
    await runPasslineWatch({ supabase: db, deps: { search, anthropic: null, crawl }, now: TODAY, enrich: false })
    expect(db.tables.aitickets_competitor_events.filter((e) => e.lead_id === 'o1')).toHaveLength(2)
    expect(risa.status).toBe('invalid')
    expect(other.status).toBe('contacted')
  })

  it('las consultas de búsqueda por defecto apuntan a passline.com/eventos (nunca una URL a visitar)', () => {
    expect(DEFAULT_QUERIES.every((q) => q.startsWith('site:passline.com/eventos '))).toBe(true)
    expect(getPasslineConfig().queries).toEqual([...DEFAULT_QUERIES])
  })
})

describe('semilla passline_rm.json', () => {
  it('mapea campos, decodifica entidades y guarda producer_ref', () => {
    const [e] = seedEventsFromPasslineJson([{
      url: 'https://www.passline.com/eventos/impro-x', nombre: 'Impro &amp;amp; Co', lugar: 'Teatro Mori', nombre_communa: '&amp;Ntilde;u&amp;ntilde;oa',
      nombre_region: 'RM', fecha_inicio: '2025-11-02', category_name: 'Comedia', productor: '7159914', artistas: 'Juan',
    }])
    expect(e).toMatchObject({ url: 'https://www.passline.com/eventos/impro-x', title: 'Impro & Co', venue: 'Teatro Mori', city: 'Ñuñoa', region: 'RM', event_date: '2025-11-02', category: 'comedia', producer_ref: '7159914', producer_name: null })
  })
})

describe('exportación CSV', () => {
  it('columnas exactas y orden por prioridad (ICP stand-up/comedia/teatro primero)', () => {
    const csv = buildLeadsCsv([
      { org_name: 'Fiesta X', lead_type: 'venue', categories: ['fiesta'], events_on_passline: 1, last_passline_event: { date: '2026-10-05' }, status: 'new' },
      { org_name: 'Risa', lead_type: 'producer', categories: ['stand_up'], events_on_passline: 4, last_passline_event: { title: 'Risa 2', date: '2026-10-20', url: 'https://www.passline.com/eventos/risa-2' }, instagram: 'risacomedia', whatsapp: '56912345678', email: 'hola@risa.cl', contact_sources: [{ field: 'email', url: 'https://risa.cl/contacto' }], status: 'new' },
    ], TODAY)
    const [header, first, second] = csv.trim().split('\n')
    expect(header.split(',')).toEqual([...CSV_COLUMNS])
    expect(CSV_COLUMNS).toEqual(['prioridad', 'nombre', 'tipo', 'ciudad', 'eventos_passline', 'ultimo_evento', 'fecha_ultimo_evento', 'url_evento_passline', 'web', 'instagram', 'email', 'whatsapp', 'fuentes', 'estado', 'notas'])
    expect(first.startsWith('90,Risa,productora,')).toBe(true)
    expect(first).toContain('https://www.instagram.com/risacomedia/')
    expect(first).toContain('+56912345678')
    expect(first).toContain('https://risa.cl/contacto')
    expect(second.startsWith('50,Fiesta X,recinto,')).toBe(true)
  })

  it('prioridad: recencia + frecuencia + ICP', () => {
    expect(leadPriority({ categories: ['teatro'], events_on_passline: 10, last_passline_event: { date: '2026-10-15' } }, TODAY)).toBe(100)
    expect(leadPriority({ categories: ['musica'], events_on_passline: 1, last_passline_event: { date: '2025-01-01' } }, TODAY)).toBe(20)
    expect(leadPriority({ categories: [], events_on_passline: 0, last_seen_event_at: '2026-09-29T00:00:00Z' }, TODAY)).toBe(25)
  })

  it('filtro previo al CSV: quita suprimidos (estado, correo, dominio) y leads ya en outreach por dominio/correo', () => {
    const leads = [
      { id: 'a', name_key: 'producer:a', org_name: 'A', status: 'new', website: 'https://a.cl/' },
      { id: 'b', name_key: 'producer:b', org_name: 'B', status: 'new', email: 'Hola@B.cl' },
      { id: 'c', name_key: 'producer:c', org_name: 'C', status: 'suppressed' },
      { id: 'd', name_key: 'producer:d', org_name: 'D', status: 'new', website: 'https://d.cl/' },
      { id: 'e', name_key: 'producer:e', org_name: 'E', status: 'new', email: 'e@gmail.com' },
      { id: 'f', name_key: 'producer:f', org_name: 'F', status: 'new', website: 'https://f.cl/', domain: 'f.cl' },
      { name_key: 'producer:g', org_name: 'G', status: 'new', website: 'https://g.cl/' },
    ]
    const { leads: kept, skipped } = filterExportableLeads(leads, {
      suppressions: [{ domain: 'a.cl', email: null }, { email: 'hola@b.cl', domain: null }],
      otherLeads: [
        { id: 'o1', name_key: null, domain: 'd.cl', status: 'contacted' },
        { id: 'o2', name_key: null, email: 'e@gmail.com', status: 'new' },
        { id: 'f', name_key: 'producer:f', domain: 'f.cl', status: 'new' },
        { id: 'g1', name_key: 'producer:g', domain: 'g.cl', status: 'new' },
        { id: 'o3', domain: 'x.cl', status: 'invalid' },
      ],
    })
    expect(kept.map((l) => l.org_name)).toEqual(['F', 'G'])
    expect(skipped).toHaveLength(5)
  })

  it('escapa comillas/comas y neutraliza fórmulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('di "hola"')).toBe('"di ""hola"""')
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell(null)).toBe('')
  })
})

describe('interruptores', () => {
  it('apagado por defecto; exige LEADS_PASSLINE_ENABLED=true y FIRECRAWL_API_KEY', () => {
    expect(passlineWatchGate()).toEqual({ ok: false, reason: 'LEADS_PASSLINE_ENABLED=false' })
    vi.stubEnv('LEADS_PASSLINE_ENABLED', 'true')
    expect(passlineWatchGate()).toEqual({ ok: false, reason: 'FIRECRAWL_API_KEY no configurada' })
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc')
    expect(passlineWatchGate()).toEqual({ ok: true })
  })

  it('la función programada no dispara nada si está apagada', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { default: handler, config } = await import('../../netlify/functions/passline-watch/index.mjs')
    const res = await handler(new Request('https://aitickets.cl/.netlify/functions/passline-watch'))
    expect(await res.text()).toMatch(/skipped/)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(config.schedule).toBe('0 11 * * *')
  })

  it('encendida, la programada dispara la background con x-internal-secret hacia DEPLOY_URL', async () => {
    vi.stubEnv('LEADS_PASSLINE_ENABLED', 'true')
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc')
    vi.stubEnv('INTERNAL_API_SECRET', 's3cret')
    vi.stubEnv('DEPLOY_URL', 'https://deploy--aitickets.netlify.app')
    const calls = []
    vi.stubGlobal('fetch', async (url, init) => { calls.push({ url: String(url), headers: init.headers }); return new Response(null, { status: 202 }) })
    const { default: handler } = await import('../../netlify/functions/passline-watch/index.mjs')
    const res = await handler(new Request('https://evil.example/.netlify/functions/passline-watch'))
    expect(await res.json()).toEqual({ name: 'passline-watch-background', status: 202 })
    expect(calls[0].url).toBe('https://deploy--aitickets.netlify.app/.netlify/functions/passline-watch-background')
    expect(calls[0].headers['x-internal-secret']).toBe('s3cret')
  })

  it('la background exige x-internal-secret y respeta el interruptor', async () => {
    vi.stubEnv('INTERNAL_API_SECRET', 's3cret')
    const { default: handler } = await import('../../netlify/functions/passline-watch-background/index.mjs')
    expect((await handler(new Request('https://x.cl/f', { method: 'POST' }))).status).toBe(401)
    const res = await handler(new Request('https://x.cl/f', { method: 'POST', headers: { 'x-internal-secret': 's3cret' } }))
    expect(await res.json()).toEqual({ skipped: 'LEADS_PASSLINE_ENABLED=false' })
  })
})

describe('findLeadContacts', () => {
  it('no guarda contactos de un dominio suprimido', async () => {
    const db = createFakeSupabase({ tables: { aitickets_suppressions: [{ id: 1, email: null, domain: 'risacomedia.cl' }] } })
    const search = fakeSearch({ contacto: [{ url: 'https://risacomedia.cl/', title: 'Risa Comedia', description: '' }] })
    const crawl = vi.fn()
    const r = await findLeadContacts({ id: 'x', org_name: 'Risa Comedia', lead_type: 'producer', instagram: 'risa' }, { search, crawl, supabase: db, now: TODAY })
    expect(r.suppressed).toBe(true)
    expect(r.patch.website).toBeUndefined()
    expect(r.patch).toMatchObject({ status: 'suppressed', next_action_at: null })
    expect(crawl).not.toHaveBeenCalled()
    const converted = await findLeadContacts({ id: 'y', org_name: 'Risa Comedia', lead_type: 'producer', status: 'converted' }, { search, crawl, supabase: db, now: TODAY })
    expect(converted.patch.status).toBeUndefined()
  })
})
