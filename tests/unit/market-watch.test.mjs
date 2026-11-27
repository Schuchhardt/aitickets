// Importación automática de eventos externos hacia /panoramas: recolector multi-ticketera (netlify/lib/market/
// ticketing-watch.mjs: solo resultados de búsqueda y la API oficial de Ticketmaster), importador (src/lib/market/
// importer.ts), POST /api/internal/market-import y la herramienta sync_competitor_events. Sin red ni BD.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e) }))

const W = await import('../../netlify/lib/market/ticketing-watch.mjs')
const I = await import('../../src/lib/market/importer.ts')
const { POST } = await import('../../src/pages/api/internal/market-import.ts')
const { getAdminTool } = await import('../../src/lib/admin-api/tools/index.ts')
const { runAdminTool } = await import('../../src/lib/admin-api/registry.ts')

const TODAY = new Date('2026-11-27T15:00:00Z')
const LEAD_PROD = '11111111-1111-4111-8111-111111111111'
const LEAD_SALA = '22222222-2222-4222-8222-222222222222'
const freshDb = () =>
  createFakeSupabase({
    tables: {
      aitickets_external_producers: [],
      aitickets_external_venues: [],
      aitickets_external_events: [],
      aitickets_external_event_dates: [],
      aitickets_leads: [
        { id: LEAD_PROD, org_name: 'Risa Prod', lead_type: 'producer', status: 'new' },
        { id: LEAD_SALA, org_name: 'Teatro Cariola', lead_type: 'venue', status: 'new' },
      ],
      aitickets_competitor_events: [
        { id: 1, platform: 'passline', url: 'https://www.passline.com/eventos/risa-total', title: 'Risa Total', venue: 'Sala Ancha', city: 'Providencia', event_date: '2026-12-10', category: 'comedia', producer_name: null, lead_id: LEAD_PROD, first_seen_at: '2026-10-01T02:00:00Z' },
        { id: 2, platform: 'passline', url: 'https://www.passline.com/eventos/necrosis-tour', title: 'Necrosis - The Search Tour', venue: 'Teatro Cariola', city: 'Santiago', event_date: '2027-01-08', category: 'musica', producer_name: 'Metal Prod', lead_id: LEAD_SALA, first_seen_at: '2026-10-01T02:00:00Z' },
        { id: 3, platform: 'passline', url: 'https://www.passline.com/eventos/sin-fecha', title: 'Sin fecha', venue: 'X', city: 'Santiago', event_date: null, category: 'teatro', lead_id: null },
        { id: 4, platform: 'passline', url: 'https://www.passline.com/eventos/sin-ciudad', title: 'Sin ciudad', venue: null, city: null, event_date: '2026-12-20', category: 'teatro', lead_id: null },
        { id: 5, platform: 'passline', url: 'https://www.passline.com/eventos/pasado', title: 'Pasado', venue: 'Y', city: 'Santiago', event_date: '2026-11-01', category: 'teatro', lead_id: null },
      ],
    },
  })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
  db = freshDb()
})

describe('recolector: URLs, consultas y títulos', () => {
  const canon = (platform, url) => W.SEARCH_PLATFORMS.find((p) => p.platform === platform).canonical(url)
  it('deja solo páginas de evento de cada ticketera', () => {
    expect(canon('puntoticket', 'https://www.puntoticket.com/evento/bryartz-teatro-caupolican-dic-2026?x=1')).toBe('https://www.puntoticket.com/evento/bryartz-teatro-caupolican-dic-2026')
    expect(canon('puntoticket', 'https://puntoticket.com/David-Bisbal/')).toBe('https://www.puntoticket.com/david-bisbal')
    expect(canon('puntoticket', 'https://www.puntoticket.com/musica')).toBeNull()
    expect(canon('puntoticket', 'https://www.puntoticket.com/')).toBeNull()
    expect(canon('ticketplus', 'https://ticketplus.cl/en/events/rey-del-ring')).toBe('https://ticketplus.cl/events/rey-del-ring')
    expect(canon('ticketplus', 'https://espacioriesco.ticketplus.cl/events/expo-2026')).toBe('https://espacioriesco.ticketplus.cl/events/expo-2026')
    expect(canon('ticketplus', 'https://ticketplus.cl/en/pages/about')).toBeNull()
    expect(canon('welcu', 'https://welcu.com/lukysgym/laguna-trail')).toBe('https://welcu.com/lukysgym/laguna-trail')
    expect(canon('welcu', 'https://welcu.com/es/precios')).toBeNull()
    expect(canon('eventbrite', 'https://www.eventbrite.cl/e/taller-de-ceramica-tickets-123456789012')).toBe('https://www.eventbrite.cl/e/taller-de-ceramica-tickets-123456789012')
    expect(canon('eventbrite', 'https://www.eventbrite.cl/d/chile--santiago/eventos/')).toBeNull()
    expect(canon('passline', 'https://www.passline.com/eventos/marty-friedman-en-santiago-2026')).toBe('https://www.passline.com/eventos/marty-friedman-en-santiago-2026')
  })

  it('rota las consultas por día (Santiago primero) y limpia el título', () => {
    const all = W.buildQueries()
    expect(all[0].query).toMatch(/^site:puntoticket\.com concierto santiago$/)
    const d1 = W.queriesForDay(all, 24, new Date('2026-11-27T12:00:00Z'))
    const d2 = W.queriesForDay(all, 24, new Date('2026-11-28T12:00:00Z'))
    expect(d1).toHaveLength(24)
    expect(d1[0].query).not.toBe(d2[0].query)
    expect(W.queriesForDay(all, 0)).toEqual([])
    expect(W.cleanEventTitle('Bryartz Chile 2026 - Teatro Caupolicán | Venta de entradas en Punto Ticket')).toBe('Bryartz Chile 2026 - Teatro Caupolicán')
    expect(W.cleanEventTitle('Entradas Risa Total | Passline')).toBe('Risa Total')
  })

  it('ítem para el registro: rango de fechas, ciudad obligatoria y precios ordenados', () => {
    const e = { url: 'https://www.puntoticket.com/evento/bisbal', platform: 'puntoticket' }
    const ok = W.searchEventToItem(e, { name: 'David Bisbal', category: 'concierto', niche: 'pop', event_date: '2026-12-06', more_dates: ['2026-12-07', '2025-01-01'], start_time: '21:00', venue: 'Movistar Arena', city: 'Santiago', price_min: 80000, price_max: 35000 }, { today: TODAY })
    expect(ok).toMatchObject({
      name: 'David Bisbal', category: 'concierto', niche: 'pop', ticketing_platform: 'puntoticket', ticketing_url: e.url, source: 'puntoticket', external_id: 'bisbal', price_min: 35000, price_max: 80000,
    })
    expect(ok.dates.map((d) => d.date)).toEqual(['2026-12-06', '2026-12-07'])
    expect(ok.dates[0]).toMatchObject({ start_time: '21:00', city: 'Santiago', venue: { name: 'Movistar Arena', city: 'Santiago' } })
    expect(W.searchEventToItem(e, { name: 'X', event_date: '2026-12-06', city: null }, { today: TODAY })).toBeNull()
    expect(W.searchEventToItem(e, { name: 'X', event_date: '2026-10-01', city: 'Santiago' }, { today: TODAY })).toBeNull()
    expect(W.searchEventToItem(e, { name: 'X', event_date: '2028-01-01', city: 'Santiago' }, { today: TODAY })).toBeNull()
  })
})

describe('Ticketmaster (Discovery API)', () => {
  const ev = (id, date, extra = {}) => ({
    id, name: 'Coldplay', url: `https://www.ticketmaster.cl/event/${id}`,
    dates: { start: { localDate: date, localTime: '21:00:00' }, status: { code: 'onsale' } },
    classifications: [{ primary: true, segment: { name: 'Music' }, genre: { name: 'Rock' } }],
    priceRanges: [{ currency: 'CLP', min: 45000, max: 250000 }, { currency: 'USD', min: 1, max: 2 }],
    images: [{ url: 'https://s1.ticketm.net/small.jpg', width: 300, ratio: '16_9' }, { url: 'https://s1.ticketm.net/big.jpg', width: 1024, ratio: '16_9' }],
    _embedded: { venues: [{ name: 'Estadio Nacional', city: { name: 'Santiago' } }] },
    promoter: { name: 'DG Medios' },
    ...extra,
  })
  it('agrupa funciones del mismo show y mapea categoría, precio CLP, afiche y estado', () => {
    const items = W.groupTicketmaster([
      ev('A1', '2027-03-10'),
      ev('A2', '2027-03-11', { dates: { start: { localDate: '2027-03-11', localTime: '21:00:00' }, status: { code: 'rescheduled' } } }),
      { ...ev('B1', '2027-04-01'), name: 'Stand Up Fest', classifications: [{ segment: { name: 'Arts & Theatre' }, genre: { name: 'Comedy' } }] },
      { id: 'X', name: 'Sin ciudad', dates: { start: { localDate: '2027-01-01' } }, _embedded: { venues: [{ name: 'X' }] } },
    ])
    expect(items).toHaveLength(2)
    const cp = items.find((i) => i.name === 'Coldplay')
    expect(cp).toMatchObject({ category: 'concierto', niche: 'Rock', ticketing_platform: 'ticketmaster', external_id: 'A1', image_url: 'https://s1.ticketm.net/big.jpg', price_min: 45000, price_max: 250000, producer: { name: 'DG Medios' } })
    expect(cp.dates.map((d) => [d.date, d.start_time, d.status])).toEqual([['2027-03-10', '21:00', 'scheduled'], ['2027-03-11', '21:00', 'postponed']])
    expect(items.find((i) => i.name === 'Stand Up Fest').category).toBe('stand_up')
  })
})

describe('corrida (dependencias falsas)', () => {
  const RESULTS = {
    puntoticket: [
      { url: 'https://www.puntoticket.com/evento/bisbal-dic-2026', title: 'David Bisbal en Chile | Venta de entradas en Punto Ticket', description: 'Movistar Arena, Santiago. 6 de diciembre 21:00 hrs.' },
      { url: 'https://www.puntoticket.com/musica', title: 'Música', description: '' },
    ],
  }
  it('busca, extrae (Claude), arma ítems, reenvía lo pendiente y sincroniza el vigía', async () => {
    const queries = [{ platform: 'puntoticket', query: 'site:puntoticket.com concierto santiago' }, { platform: 'welcu', query: 'site:welcu.com concierto santiago' }]
    const search = vi.fn(async (q) => (q.startsWith('site:puntoticket.com') ? RESULTS.puntoticket : []))
    const anthropic = {
      messages: {
        create: vi.fn(async () => ({
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
          content: [{ type: 'text', text: JSON.stringify({ events: [{ url: 'https://www.puntoticket.com/evento/bisbal-dic-2026', name: 'David Bisbal en Chile', category: 'concierto', niche: 'pop', event_date: '2026-12-06', more_dates: [], start_time: '21:00', venue: 'Movistar Arena', city: 'Santiago', price_min: null, price_max: null, is_free: null, producer: null }] }) }],
        })),
      },
    }
    const posts = []
    let first = true
    const post = vi.fn(async (body) => {
      posts.push(body)
      if (body.events) {
        // La primera tanda "no alcanza": el registro devuelve remaining = 1 y el recolector la reenvía
        const remaining = first ? 1 : 0
        first = false
        return { ok: true, import: { totals: { events_created: body.events.length - remaining }, remaining, errors: [] } }
      }
      return { ok: true, sync: { checked: 2, totals: { events_created: 2 }, skipped: { sin_fecha: 1 }, next_offset: null } }
    })
    const s = await W.runMarketWatch({ deps: { search, anthropic, post, queries }, now: TODAY })
    expect(s.queries).toBe(2)
    expect(s.eventPages).toBe(1)
    expect(s.items).toBe(1)
    expect(s.byPlatform).toEqual({ puntoticket: 1 })
    expect(posts[0].events[0]).toMatchObject({ name: 'David Bisbal en Chile', niche: 'pop', dates: [{ date: '2026-12-06', start_time: '21:00', city: 'Santiago', venue: { name: 'Movistar Arena', city: 'Santiago' } }] })
    expect(posts[1].events).toHaveLength(1) // reenvío
    expect(posts[2]).toEqual({ sync_competitor_events: { offset: 0, limit: 24 } })
    expect(s.registered.events_created).toBe(1)
    expect(s.competitor).toMatchObject({ checked: 2, created: 2, skipped: { sin_fecha: 1 } })
    expect(W.formatMarketSlack(s)).toMatch(/1 nuevos/)
    // Nunca se visitó una ticketera: solo búsquedas
    expect(search.mock.calls.every(([q]) => q.startsWith('site:'))).toBe(true)
  })

  it('sin Claude usa la heurística; gate apagado por defecto', async () => {
    const queries = [{ platform: 'puntoticket', query: 'site:puntoticket.com concierto santiago' }]
    const s = await W.runMarketWatch({ deps: { queries, search: async () => RESULTS.puntoticket, anthropic: null, post: async () => ({ ok: true, import: { totals: {}, remaining: 0 }, sync: { next_offset: null } }) }, now: TODAY, dryRun: true })
    expect(s.plan[0]).toMatchObject({ name: 'David Bisbal en Chile', category: 'concierto', dates: [{ date: '2026-12-06', start_time: '21:00', city: 'Santiago' }] })
    expect(W.marketWatchGate()).toEqual({ ok: false, reason: 'MARKET_WATCH_ENABLED=false' })
  })
})

describe('importador: vigía de Passline → eventos externos', () => {
  it('mapea productora con lead, sala con nota y motivos de descarte', () => {
    const rows = db.tables.aitickets_competitor_events
    const prod = I.competitorToExternal(rows[0], { id: LEAD_PROD, org_name: 'Risa Prod', lead_type: 'producer' }, '2026-11-27')
    expect(prod.item).toMatchObject({ name: 'Risa Total', category: 'stand_up', ticketing_platform: 'passline', external_id: 'risa-total', producer: { name: 'Risa Prod', lead_id: LEAD_PROD } })
    const sala = I.competitorToExternal(rows[1], { id: LEAD_SALA, org_name: 'Teatro Cariola', lead_type: 'venue' }, '2026-11-27')
    expect(sala.item).toMatchObject({ category: 'concierto', producer: { name: 'Metal Prod' }, notes: `Lead sala: Teatro Cariola (${LEAD_SALA})` })
    expect(sala.item.dates[0]).toMatchObject({ date: '2027-01-08', venue: { name: 'Teatro Cariola', city: 'Santiago' } })
    expect(I.competitorToExternal(rows[2], null, '2026-11-27')).toEqual({ skip: 'sin_fecha' })
    expect(I.competitorToExternal(rows[3], null, '2026-11-27')).toEqual({ skip: 'sin_ciudad' })
  })

  it('syncCompetitorEvents registra con el mismo núcleo del MCP y enlaza el lead', async () => {
    const r = await I.syncCompetitorEvents(db, { today: '2026-11-27', deadline: Number.MAX_SAFE_INTEGER })
    expect(r.checked).toBe(3) // los de fecha próxima (sin fecha y pasados no entran a la consulta)
    expect(r.skipped).toEqual({ sin_ciudad: 1 })
    expect(r.totals.events_created).toBe(2)
    expect(r.next_offset).toBeNull()
    const ev = db.tables.aitickets_external_events
    expect(ev.map((e) => e.name).sort()).toEqual(['Necrosis - The Search Tour', 'Risa Total'])
    const prod = db.tables.aitickets_external_producers.find((p) => p.name === 'Risa Prod')
    expect(prod.lead_id).toBe(LEAD_PROD)
    // Repetir no duplica
    await I.syncCompetitorEvents(db, { today: '2026-11-27', deadline: Number.MAX_SAFE_INTEGER })
    expect(db.tables.aitickets_external_events).toHaveLength(2)
  })

  it('un ítem inválido no bloquea a los demás del lote', async () => {
    const good = { name: 'Bueno', category: 'teatro', dates: [{ date: '2026-12-12', city: 'Santiago' }] }
    const bad = { name: 'Malo', category: 'inventada', dates: [{ date: '2026-12-12', city: 'Santiago' }] }
    const r = await I.importEventItems(db, [good, bad], { deadline: Number.MAX_SAFE_INTEGER })
    expect(r.totals.events_created).toBe(1)
    expect(r.totals.errors).toBe(1)
    expect(r.errors[0].name).toBe('Malo')
    expect(r.remaining).toBe(0)
  })
})

describe('POST /api/internal/market-import y sync_competitor_events', () => {
  const req = (body, secret = 'shh') => new Request('https://aitickets.cl/api/internal/market-import', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { 'x-internal-secret': secret } : {}) }, body: JSON.stringify(body) })
  it('exige el secreto interno; importa ítems y sincroniza el vigía', async () => {
    vi.stubEnv('INTERNAL_API_SECRET', 'shh')
    expect((await POST({ request: req({ events: [] }, null) })).status).toBe(401)
    expect((await POST({ request: req({}) })).status).toBe(400)
    const res = await POST({ request: req({ events: [{ name: 'Jazz Club', category: 'concierto', niche: 'jazz', dates: [{ date: '2026-12-05', city: 'Ñuñoa' }] }], sync_competitor_events: { offset: 0 } }) })
    const body = await res.json()
    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(body.import.totals.events_created).toBe(1)
    expect(body.sync.checked).toBe(3)
    expect(db.tables.aitickets_external_events.map((e) => e.name)).toContain('Jazz Club')
  })

  it('sync_competitor_events: simulación sin escribir y registro con motivo', async () => {
    const actx = { supabase: db, origin: 'https://aitickets.cl', requestUrl: new URL('https://aitickets.cl/api/admin/mcp'), keyKind: 'full', fingerprint: 'abcd1234', ipHash: 'f'.repeat(64) }
    const dry = await runAdminTool(getAdminTool('sync_competitor_events'), { dry_run: true, reason: 'Probar la sincronización del vigía' }, actx)
    expect(dry.ok, JSON.stringify(dry)).toBe(true)
    expect(db.tables.aitickets_external_events).toHaveLength(0)
    const real = await runAdminTool(getAdminTool('sync_competitor_events'), { reason: 'Pasar el vigía a panoramas' }, actx)
    expect(real.result.totals.events_created).toBe(2)
    expect(db.tables.aitickets_external_events).toHaveLength(2)
  })
})
