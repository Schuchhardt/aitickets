// MCP de administración: eventos externos, mapa de mercado, modelo de fechas y calendario de mercado
// (src/lib/admin-api/tools/market.ts). Supabase falso: sin red ni BD.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e) }))

const { getAdminTool } = await import('../../src/lib/admin-api/tools/index.ts')
const { runAdminTool } = await import('../../src/lib/admin-api/registry.ts')

const actx = (keyKind = 'full') => ({ supabase: db, origin: 'https://aitickets.cl', requestUrl: new URL('https://aitickets.cl/api/admin/mcp'), keyKind, fingerprint: 'abcd1234', ipHash: 'f'.repeat(64) })
const raw = (name, args, keyKind) => runAdminTool(getAdminTool(name), args, actx(keyKind))
const run = async (name, args, keyKind) => {
  const out = await raw(name, args, keyKind)
  expect(out.ok, JSON.stringify(out)).toBe(true)
  return out.result
}
const reason = 'Mapeo de mercado desde Puntoticket, prueba'
const LEAD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const rows = () => db.tables.aitickets_external_events
const byName = (name) => rows().find((r) => r.name === name)

const BASE = [
  {
    name: 'Techno Night', event_type: 'fiesta', date: '2026-12-12', start_time: '23:30', city: 'Providencia', venue_name: 'Club Y', capacity: 800,
    organizer_name: 'Noche Prod', organizer_instagram: '@NocheProd', ticketing_platform: 'Punto Ticket', price_min: 10000, price_max: 15000,
    source: 'puntoticket', source_url: 'https://www.puntoticket.com/techno', external_id: 'PT-1', genre: 'Techno',
  },
  { name: 'Stand Up Martes', event_type: 'stand_up', date: '2026-12-15', city: 'Santiago', ticketing_platform: 'Ticketera Rara' },
  { name: 'Fonda Libre', event_type: 'fiesta', date: '2026-12-12', city: 'Ñuñoa', ticketing_platform: 'DM', organizer_name: 'Fonda Crew', price_max: 0 },
]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-20T15:00:00Z'))
  db = createFakeSupabase({
    tables: {
      aitickets_external_events: [],
      aitickets_market_calendar: [],
      organizations: [{ id: 7, public_name: 'Productora Siete' }],
      aitickets_leads: [{ id: LEAD, org_name: 'Noche Prod', status: 'new' }],
      events: [
        { id: 10, name: 'Fiesta AI', slug: 'fiesta-ai', status: 'published', organization_id: 7, start_date: '2026-12-13T02:00:00Z', end_date: '2026-12-13T08:00:00Z', created_at: '2026-10-01T00:00:00Z', capacity: 300 },
        { id: 11, name: 'Borrador', slug: 'borrador', status: 'draft', organization_id: 7, start_date: '2026-12-12T23:00:00Z', end_date: '2026-12-13T03:00:00Z', created_at: '2026-10-01T00:00:00Z' },
      ],
      event_dates: [{ id: 1, event_id: 10, date: '2026-12-12', start_time: '23:00:00', event_location_id: 'loc1' }],
      event_locations: [{ id: 'loc1', event_id: 10, venue_id: 'v1', name: 'Club X' }],
      venues: [{ id: 'v1', name: 'Club X', city: 'Providencia', capacity: 300 }],
      event_tags: [{ id: 1, event_id: 10, tag_id: 3 }],
      category_tags: [{ id: 3, name: 'Fiesta' }],
      event_tickets: [{ id: 1, event_id: 10, price: 8000, is_gift: false }],
      event_orders: [],
      aitickets_admin_audit: [],
      aitickets_admin_confirmations: [],
      aitickets_admin_idempotency: [],
    },
    unique: { aitickets_admin_idempotency: [['tool', 'idem_key']], aitickets_external_events: [['dedupe_key']] },
  })
})
afterEach(() => vi.useRealTimers())

describe('register_external_events', () => {
  it('simula, registra y normaliza (ciudad, región, Instagram, ticketera, gratis)', async () => {
    const dry = await run('register_external_events', { events: BASE, dry_run: true, reason })
    expect(dry).toMatchObject({ dry_run: true, created: 3, errors: 0 })
    expect(rows()).toHaveLength(0)
    expect(dry.results[0]).toMatchObject({ status: 'would_create', city_key: 'santiago', ticketing_platform: 'puntoticket' })
    expect(dry.results[1].warnings.join(' ')).toMatch(/Ticketera nueva "ticketera_rara"/)

    const r = await run('register_external_events', { events: BASE, reason })
    expect(r).toMatchObject({ created: 3, updated: 0, errors: 0 })
    expect(byName('Techno Night')).toMatchObject({
      city_key: 'santiago', region: 'metropolitana', organizer_key: 'ig:nocheprod', organizer_instagram: 'nocheprod', ticketing_platform: 'puntoticket',
      genre: 'techno', dedupe_key: 'techno_night|2026-12-12|santiago', status: 'scheduled', source: 'puntoticket', start_time: '23:30',
    })
    expect(byName('Fonda Libre')).toMatchObject({ ticketing_platform: 'none', is_free: true, source: 'manual' })
    expect(db.tables.aitickets_admin_audit.at(-1)).toMatchObject({ tool: 'register_external_events', reason, read_only: false, summary: expect.stringMatching(/3 creados/) })
  })

  it('duplicados: completa por nombre/día/ciudad, respeta skip y reconoce source + external_id', async () => {
    await run('register_external_events', { events: [{ ...BASE[0], tags: ['A'] }], reason })
    const merged = await run('register_external_events', { events: [{ name: 'TECHNO night', event_type: 'fiesta', date: '2026-12-12', city: 'Las Condes', sold_out: true, tags: ['b'] }], reason })
    expect(merged).toMatchObject({ created: 0, updated: 1 })
    expect(merged.results[0]).toMatchObject({ matched_by: 'nombre_dia_ciudad' })
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toMatchObject({ sold_out: true, tags: ['a', 'b'], name: 'Techno Night', city: 'Providencia', ticketing_platform: 'puntoticket' })

    const skipped = await run('register_external_events', { events: [{ name: 'Techno Night', event_type: 'fiesta', date: '2026-12-12', city: 'Santiago', capacity: 1 }], on_duplicate: 'skip', reason })
    expect(skipped).toMatchObject({ skipped: 1, updated: 0 })
    expect(rows()[0].capacity).toBe(800)

    const renamed = await run('register_external_events', { events: [{ name: 'Techno Night Vol 2', event_type: 'fiesta', date: '2026-12-12', city: 'Santiago', source: 'puntoticket', external_id: 'PT-1' }], reason })
    expect(renamed.results[0]).toMatchObject({ status: 'updated', matched_by: 'external_id' })
    expect(rows()).toHaveLength(1)
    expect(rows()[0].dedupe_key).toBe('techno_night_vol_2|2026-12-12|santiago')

    const same = await run('register_external_events', { events: [{ name: 'Techno Night Vol 2', event_type: 'fiesta', date: '2026-12-12', city: 'Santiago' }], reason })
    expect(same).toMatchObject({ unchanged: 1 })
  })

  it('errores por ítem sin frenar el resto; motivo obligatorio; la llave de solo lectura no escribe', async () => {
    const r = await run('register_external_events', {
      events: [
        { name: 'Con productora falsa', event_type: 'teatro', date: '2026-12-10', city: 'Santiago', organization_id: 999 },
        { name: 'Precios al revés', event_type: 'teatro', date: '2026-12-10', city: 'Santiago', price_min: 5000, price_max: 1000 },
        { name: 'Con lead', event_type: 'teatro', date: '2026-12-10', city: 'Santiago', lead_id: LEAD, organization_id: 7 },
        { name: 'Fecha mala', event_type: 'teatro', date: '2026-02-30', city: 'Santiago' },
      ],
      reason,
    })
    expect(r).toMatchObject({ created: 1, errors: 3 })
    expect(r.results.map((x) => x.status)).toEqual(['error', 'error', 'created', 'error'])
    expect(r.results[0].error).toMatch(/organization_id 999/)
    expect(r.results[1].error).toMatch(/price_min/)
    expect(byName('Con lead')).toMatchObject({ lead_id: LEAD, organization_id: 7 })

    const noReason = await raw('register_external_events', { events: BASE })
    expect(noReason).toMatchObject({ ok: false, code: 'invalid_input' })
    const ro = await raw('register_external_events', { events: BASE, reason }, 'readonly')
    expect(ro).toMatchObject({ ok: false, code: 'forbidden' })
    expect((await raw('list_external_events', {}, 'readonly')).ok).toBe(true)
  })
})

describe('list / get / update / delete', () => {
  beforeEach(async () => {
    await run('register_external_events', {
      events: [
        ...BASE,
        { name: 'Obra Larga', event_type: 'teatro', date: '2026-12-11', city: 'Santiago', series_key: 'obra-larga', ticketing_platform: 'ticketplus', organizer_name: 'Teatro Uno' },
        { name: 'Obra Larga', event_type: 'teatro', date: '2026-12-18', city: 'Santiago', series_key: 'obra-larga', ticketing_platform: 'ticketplus', organizer_name: 'Teatro Uno' },
        { name: 'Pasado', event_type: 'concierto', date: '2026-10-01', city: 'Temuco', ticketing_platform: 'passline', sold_out: true },
      ],
      reason,
    })
  })

  it('list_external_events: filtros, conteos y paginación', async () => {
    const all = await run('list_external_events', {})
    expect(all.total).toBe(5) // sin el pasado
    expect(all.counts_by_type).toMatchObject({ fiesta: 2, teatro: 2, stand_up: 1 })
    expect(all.items[0].date <= all.items[1].date).toBe(true)
    expect(all.note).toMatch(/DATO/)
    expect((await run('list_external_events', { all_dates: true })).total).toBe(6)
    expect((await run('list_external_events', { city: 'Providencia' })).total).toBe(5)
    expect((await run('list_external_events', { ticketing_platforms: ['none'] })).items.map((i) => i.name)).toEqual(['Fonda Libre'])
    expect((await run('list_external_events', { uses_ticketing: false })).total).toBe(1)
    expect((await run('list_external_events', { query: 'techno' })).items[0].name).toBe('Techno Night')
    expect((await run('list_external_events', { organizer: '@nocheprod' })).total).toBe(1)
    expect((await run('list_external_events', { all_dates: true, has_outcome: true })).items.map((i) => i.name)).toEqual(['Pasado'])
    const page = await run('list_external_events', { compact: true, limit: 2, offset: 1 })
    expect(page.items).toHaveLength(2)
    expect(page.items[0]).not.toHaveProperty('ticketing')
  })

  it('get_external_event: funciones del mismo espectáculo y eventos de esa noche', async () => {
    const obra = rows().find((r) => r.event_date === '2026-12-11')
    const g = await run('get_external_event', { id: obra.id })
    expect(g.event).toMatchObject({ name: 'Obra Larga', weekday: 'viernes', ticketing: { platform: 'ticketplus', uses_ticketing: true } })
    expect(g.other_functions.map((f) => f.date)).toEqual(['2026-12-18'])
    const techno = byName('Techno Night')
    expect((await run('get_external_event', { id: techno.id })).same_night_same_city.map((e) => e.name)).toEqual(['Fonda Libre'])
    expect(await raw('get_external_event', { id: 424242 })).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('update_external_event: resultado, borrar con null, nota y choque de duplicado', async () => {
    const techno = byName('Techno Night')
    const u = await run('update_external_event', { id: techno.id, sold_pct: 95, venue_name: null, add_note: 'Agotó preventa', reason })
    expect(u.changes.map((c) => c.field).sort()).toEqual(['notes', 'sold_pct', 'venue_name'])
    expect(byName('Techno Night')).toMatchObject({ sold_pct: 95, venue_name: null, notes: '[2026-11-20] Agotó preventa' })
    expect(u.event.outcome.sold_pct).toBe(95)
    const clash = await raw('update_external_event', { id: techno.id, name: 'Fonda Libre', reason })
    expect(clash).toMatchObject({ ok: false, code: 'conflict' })
    const noop = await run('update_external_event', { id: techno.id, sold_pct: 95, reason })
    expect(noop.changes).toEqual([])
    expect(await raw('update_external_event', { id: techno.id, name: null, reason })).toMatchObject({ ok: false, code: 'invalid_input' })
  })

  it('delete_external_events: pide confirmación y luego borra', async () => {
    const ids = rows().filter((r) => r.name === 'Obra Larga').map((r) => r.id)
    const first = await run('delete_external_events', { ids: [...ids, 999999], reason })
    expect(first.status).toBe('confirmation_required')
    expect(first.summary).toMatch(/Borrar 2 evento/)
    expect(first.warnings[0]).toMatch(/999999/)
    expect(rows()).toHaveLength(6)
    const done = await run('delete_external_events', { ids: [...ids, 999999], reason, confirmation_token: first.confirmation_token })
    expect(done).toMatchObject({ deleted: 2, not_found: [999999] })
    expect(rows()).toHaveLength(4)
  })
})

describe('mapa de mercado y modelo', () => {
  beforeEach(async () => {
    await run('register_external_events', {
      events: [
        ...BASE,
        { name: 'Techno Night II', event_type: 'fiesta', date: '2026-12-19', city: 'Santiago', organizer_name: 'Noche Prod', organizer_instagram: 'nocheprod', ticketing_platform: 'puntoticket', price_min: 12000 },
        { name: 'Rock Bar', event_type: 'concierto', date: '2026-12-11', city: 'Viña del Mar', ticketing_platform: 'passline', organizer_name: 'Rock Viña' },
      ],
      reason,
    })
  })

  it('get_market_map: participación por ticketera, tipos, oportunidades y eventos de AI Tickets', async () => {
    const m = await run('get_market_map', {})
    expect(m.sources).toMatchObject({ external_functions: 5, aitickets_functions: 1, include_internal: true })
    expect(m.totals.shows).toBe(6)
    const pt = m.platforms.find((p) => p.platform === 'puntoticket')
    expect(pt).toMatchObject({ shows: 2, organizers: 1 })
    expect(m.platforms.find((p) => p.platform === 'aitickets')).toMatchObject({ shows: 1, label: 'AI Tickets' })
    expect(m.types.find((t) => t.event_type === 'fiesta')).toMatchObject({ shows: 4 })
    expect(m.opportunities.map((o) => o.name)).toEqual(['Noche Prod'])
    expect(m.opportunities[0]).toMatchObject({ shows: 2, platforms: ['puntoticket'], aitickets_customer: false })
    expect(m.top_organizers.find((o) => o.name === 'Productora Siete')).toMatchObject({ aitickets_customer: true })
    const scl = await run('get_market_map', { city: 'Santiago', include_internal: false })
    expect(scl.totals.shows).toBe(4)
    expect(scl.platforms.some((p) => p.platform === 'aitickets')).toBe(false)
  })

  it('evaluate_event_date: competidores externos y de AI Tickets, sin contarse a sí mismo', async () => {
    const r = await run('evaluate_event_date', { event_type: 'fiesta', date: '2026-12-12', city: 'Las Condes' })
    expect(r).toMatchObject({ weekday: 'sábado', city_key: 'santiago', event_type: 'fiesta' })
    expect(r.score).toBeGreaterThanOrEqual(0)
    expect(r.factors.map((f) => f.factor)).toEqual(expect.arrayContaining(['dia_semana', 'temporada', 'competencia']))
    const names = r.competition.events.map((e) => e.name)
    expect(names).toEqual(expect.arrayContaining(['Techno Night', 'Fonda Libre', 'Fiesta AI']))
    expect(r.competition.events.find((e) => e.name === 'Fiesta AI')).toMatchObject({ source: 'aitickets', ticketing_platform: 'aitickets' })
    expect(r.data_used).toMatchObject({ external_functions: 5, aitickets_functions: 1 })
    expect(r.note).toMatch(/heurístico/)
    const techno = byName('Techno Night')
    const self = await run('evaluate_event_date', { event_type: 'fiesta', date: '2026-12-12', city: 'Santiago', external_event_id: techno.id, include_internal: false, price: 11000 })
    expect(self.competition.events.map((e) => e.name)).not.toContain('Techno Night')
    expect(self.price_check).toMatchObject({ your_price: 11000 })
    expect(await raw('evaluate_event_date', { event_type: 'fiesta' })).toMatchObject({ ok: false, code: 'invalid_input' })
  })

  it('recommend_event_dates: rango, filtro por día y límite', async () => {
    const r = await run('recommend_event_dates', { event_type: 'fiesta', city: 'Santiago', from: '2026-12-01', to: '2026-12-31', weekdays: ['viernes', 'sabado'], top: 3 })
    expect(r.top).toHaveLength(3)
    expect(r.top.every((t) => ['viernes', 'sábado'].includes(t.weekday))).toBe(true)
    expect(r.evaluated_dates).toBe(8)
    const def = await run('recommend_event_dates', { event_type: 'teatro' })
    expect(def).toMatchObject({ from: '2026-12-04', to: '2027-03-03' })
    expect(await raw('recommend_event_dates', { event_type: 'fiesta', from: '2026-12-01', to: '2027-12-01' })).toMatchObject({ ok: false, code: 'invalid_input' })
  })
})

describe('calendario de mercado', () => {
  it('crea un interferiado que arma fin de semana largo, lo lista y lo borra', async () => {
    const up = await run('upsert_market_calendar', {
      entries: [
        { kind: 'bridge_holiday', label: 'Interferiado 7 de diciembre', date_from: '2026-12-07', region: 'metropolitana' },
        { kind: 'school_vacation', label: 'Vacaciones de invierno', date_from: '2027-07-05', date_to: '2027-07-16', event_types: ['infantil'] },
      ],
      reason,
    })
    expect(up).toMatchObject({ created: 2, updated: 0 })
    expect(up.entries[0]).toMatchObject({ kind: 'bridge_holiday', date_to: '2026-12-07', region: 'metropolitana' })

    const cal = await run('list_market_calendar', { from: '2026-12-01', to: '2026-12-31', city: 'Santiago' })
    expect(cal.holidays.map((h) => h.date)).toEqual(['2026-12-07', '2026-12-08', '2026-12-25'])
    expect(cal.holidays[0]).toMatchObject({ source: 'calendario' })
    expect(cal.long_weekends.map((l) => [l.start, l.end, l.days])).toEqual([['2026-12-05', '2026-12-08', 4], ['2026-12-25', '2026-12-27', 3]])
    expect(cal.entries).toHaveLength(1)

    // Sin el interferiado (otra región) el 8 de diciembre martes no arma fin de semana largo; Navidad (viernes) sí
    const temuco = await run('list_market_calendar', { from: '2026-12-01', to: '2026-12-31', city: 'Temuco' })
    expect(temuco.long_weekends.map((l) => l.start)).toEqual(['2026-12-25'])

    const edited = await run('upsert_market_calendar', { entries: [{ id: up.entries[1].id, kind: 'school_vacation', label: 'Invierno RM', date_from: '2027-07-05', date_to: '2027-07-16', impact: 1.3 }], reason })
    expect(edited.entries[0]).toMatchObject({ status: 'updated', impact: 1.3 })

    const del = await run('delete_market_calendar_entries', { ids: up.entries.map((e) => e.id), reason })
    expect(del.deleted).toBe(2)
    expect(db.tables.aitickets_market_calendar).toHaveLength(0)
    expect(await raw('upsert_market_calendar', { entries: [{ kind: 'other', label: 'Mal', date_from: '2026-12-10', date_to: '2026-12-01' }], reason })).toMatchObject({ ok: false, code: 'invalid_input' })
  })
})

describe('sin la migración', () => {
  it('las lecturas avisan y las escrituras responden unavailable', async () => {
    db.failOn('aitickets_external_events', 'select', { code: '42P01', message: 'no existe' })
    const list = await run('list_external_events', {})
    expect(list.note).toMatch(/202611200100/)
    db.failOn('aitickets_external_events', 'select', { code: '42P01', message: 'no existe' }, { once: false })
    expect(await raw('register_external_events', { events: BASE, reason })).toMatchObject({ ok: false, code: 'unavailable' })
    const r = await run('evaluate_event_date', { event_type: 'fiesta', date: '2026-12-12', city: 'Santiago' })
    expect(r.warnings.join(' ')).toMatch(/202611200100/)
  })
})
