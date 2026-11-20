// MCP de administración: eventos externos (con productora, lugar, categoría, nicho y varias funciones o giras), mapa de
// mercado, modelo de fechas y calendario de mercado (src/lib/admin-api/tools/market.ts). Supabase falso: sin red ni BD.
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
const T = {
  events: () => db.tables.aitickets_external_events,
  dates: () => db.tables.aitickets_external_event_dates,
  producers: () => db.tables.aitickets_external_producers,
  venues: () => db.tables.aitickets_external_venues,
}
const eventNamed = (name) => T.events().find((e) => e.name === name)
const datesOf = (name) => T.dates().filter((d) => d.event_id === eventNamed(name).id)

const TOUR = {
  name: 'Gira Rock Andino 2026', category: 'concierto', niche: 'Rock', ticketing_platform: 'Punto Ticket', price_min: 15000, price_max: 30000,
  source: 'puntoticket', source_url: 'https://www.puntoticket.com/rock-andino', external_id: 'PT-77',
  producer: { name: 'Andes Prod', instagram: '@AndesProd' },
  dates: [
    { date: '2026-12-11', start_time: '21:00', venue: { name: 'Teatro Caupolicán', city: 'Santiago', capacity: 4500 } },
    { date: '2026-12-12', start_time: '21:00', venue: { name: 'Teatro Municipal de Viña', city: 'Viña del Mar', capacity: 1200 } },
    { date: '2026-12-14', venue: { name: 'Teatro Regional', city: 'Concepción' } },
  ],
}
const PARTY = {
  name: 'Techno Night', category: 'fiesta', niche: 'Tecno', ticketing_platform: 'passline',
  producer: { name: 'Noche Prod', instagram: 'nocheprod' },
  dates: [{ date: '2026-12-12', start_time: '23:30', venue: { name: 'Club Y', city: 'Providencia', capacity: 800 } }],
}
const FONDA = { name: 'Fonda Libre', category: 'fiesta', niche: 'cumbia', ticketing_platform: 'DM', producer: { name: 'Fonda Crew' }, price_max: 0, dates: [{ date: '2026-12-12', city: 'Ñuñoa' }] }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-20T15:00:00Z'))
  db = createFakeSupabase({
    tables: {
      aitickets_external_producers: [],
      aitickets_external_venues: [],
      aitickets_external_events: [],
      aitickets_external_event_dates: [],
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
    unique: {
      aitickets_admin_idempotency: [['tool', 'idem_key']],
      aitickets_external_producers: [['producer_key']],
      aitickets_external_venues: [['venue_key']],
      aitickets_external_event_dates: [['event_id', 'slot_key']],
    },
  })
})
afterEach(() => vi.useRealTimers())

describe('register_external_events', () => {
  it('simula y registra: gira en 3 ciudades, productoras y lugares nuevos, nicho y ticketera normalizados', async () => {
    const dry = await run('register_external_events', { events: [TOUR, PARTY, FONDA], dry_run: true, reason })
    expect(dry).toMatchObject({ dry_run: true, events_created: 3, dates_added: 5, producers_created: 3, venues_created: 4, errors: 0 })
    expect(T.events()).toHaveLength(0)
    expect(T.dates()).toHaveLength(0)
    expect(dry.results[0]).toMatchObject({ status: 'would_create', tour_cities: ['Santiago', 'Gran Valparaíso (Viña, Valparaíso, Concón…)', 'Gran Concepción'] })

    const r = await run('register_external_events', { events: [TOUR, PARTY, FONDA], reason })
    expect(r).toMatchObject({ events_created: 3, dates_added: 5, producers_created: 3, venues_created: 4, errors: 0 })
    const tour = eventNamed('Gira Rock Andino 2026')
    expect(tour).toMatchObject({ category: 'concierto', niche: 'rock', ticketing_platform: 'puntoticket', name_key: 'gira_rock_andino_2026', source: 'puntoticket', external_id: 'PT-77' })
    expect(T.producers().find((p) => p.id === tour.producer_id)).toMatchObject({ name: 'Andes Prod', instagram: 'andesprod', producer_key: 'ig:andesprod' })
    expect(datesOf('Gira Rock Andino 2026').map((d) => [d.event_date, d.city_key, d.status])).toEqual([
      ['2026-12-11', 'santiago', 'scheduled'],
      ['2026-12-12', 'gran_valparaiso', 'scheduled'],
      ['2026-12-14', 'gran_concepcion', 'scheduled'],
    ])
    expect(T.venues().find((v) => v.name === 'Teatro Municipal de Viña')).toMatchObject({ city_key: 'gran_valparaiso', region: 'valparaiso', capacity: 1200, venue_key: 'teatro_municipal_de_vina|gran_valparaiso' })
    expect(eventNamed('Techno Night').niche).toBe('techno')
    expect(eventNamed('Fonda Libre')).toMatchObject({ ticketing_platform: 'none', is_free: true })
    expect(datesOf('Fonda Libre')[0]).toMatchObject({ city: 'Ñuñoa', city_key: 'santiago', venue_id: null, region: 'metropolitana' })
    expect(r.results[2].warnings || []).not.toEqual(expect.arrayContaining([expect.stringMatching(/Nicho nuevo/)])) // cumbia es un nicho sugerido de fiesta
    const odd = { name: 'Fiesta Rara', category: 'fiesta', niche: 'Vaporwave', dates: [{ date: '2026-12-05', city: 'Santiago' }] }
    const first = await run('register_external_events', { events: [odd], reason })
    expect(first.results[0].warnings.join(' ')).toMatch(/Nicho nuevo "vaporwave" en fiesta \(usados o sugeridos: .*techno/)
    const second = await run('register_external_events', { events: [{ ...odd, name: 'Otra Rara' }], reason })
    expect((second.results[0].warnings || []).join(' ')).not.toMatch(/Nicho nuevo/)
    expect(db.tables.aitickets_admin_audit.find((a) => a.tool === 'register_external_events' && !a.summary.includes('simulación') && a.summary.includes('3 creados'))).toMatchObject({ reason, summary: expect.stringMatching(/5 funciones nuevas/) })
  })

  it('el mismo evento desde otra fuente: completa funciones y reutiliza productora y lugar', async () => {
    await run('register_external_events', { events: [TOUR, PARTY], reason })
    // Misma gira (source + external_id): una función nueva en Temuco y la de Viña agotada
    const again = await run('register_external_events', {
      events: [{ ...TOUR, dates: [{ ...TOUR.dates[1], sold_out: true }, { date: '2026-12-18', start_time: '21:00', venue: { name: 'Teatro Municipal', city: 'Temuco' } }] }],
      reason,
    })
    expect(again).toMatchObject({ events_created: 0, events_updated: 1, dates_added: 1, dates_updated: 1, producers_created: 0, venues_created: 1 })
    expect(again.results[0]).toMatchObject({ matched_by: 'external_id', producer: { status: 'existing' } })
    expect(datesOf('Gira Rock Andino 2026')).toHaveLength(4)
    expect(datesOf('Gira Rock Andino 2026').find((d) => d.event_date === '2026-12-12').sold_out).toBe(true)

    // La fiesta vista en Instagram: sin external_id, la productora solo por nombre, la función sin hora
    const ig = await run('register_external_events', {
      events: [{ name: 'TECHNO NIGHT', category: 'fiesta', source: 'instagram', producer: { name: 'noche prod' }, dates: [{ date: '2026-12-12', venue: { name: 'club y', city: 'Santiago' } }] }],
      reason,
    })
    expect(ig).toMatchObject({ events_created: 0, producers_created: 0, venues_created: 0, dates_added: 0 })
    expect(ig.results[0]).toMatchObject({ matched_by: 'nombre_y_fechas', status: 'updated' })
    expect(eventNamed('Techno Night')).toMatchObject({ source: 'instagram' }) // el nombre guardado no se pisa
    expect(T.events()).toHaveLength(2)

    // skip deja el existente igual
    const skip = await run('register_external_events', { events: [{ ...PARTY, price_min: 1 }], on_duplicate: 'skip', reason })
    expect(skip).toMatchObject({ events_skipped: 1 })
    expect(eventNamed('Techno Night').price_min).toBeUndefined()

    // Un año después es otro evento (fuera de la ventana de 120 días)
    const next = await run('register_external_events', { events: [{ ...PARTY, dates: [{ ...PARTY.dates[0], date: '2027-12-11' }] }], reason })
    expect(next).toMatchObject({ events_created: 1 })
  })

  it('errores por ítem; motivo obligatorio; la llave de solo lectura no escribe', async () => {
    const r = await run('register_external_events', {
      events: [
        { name: 'Sin categoría', dates: [{ date: '2026-12-10', city: 'Santiago' }] },
        { name: 'Sin ciudad', category: 'teatro', dates: [{ date: '2026-12-10' }] },
        { name: 'Productora falsa', category: 'teatro', producer: { name: 'Productora X', organization_id: 999 }, dates: [{ date: '2026-12-10', city: 'Santiago' }] },
        { name: 'Precios al revés', category: 'teatro', price_min: 5000, price_max: 1000, dates: [{ date: '2026-12-10', city: 'Santiago' }] },
        { name: 'Una buena y una mala', category: 'teatro', producer: { name: 'Lead Teatro', lead_id: LEAD }, dates: [{ date: '2026-12-10', city: 'Santiago' }, { date: '2026-12-11' }] },
      ],
      reason,
    })
    expect(r.results.map((x) => x.status)).toEqual(['error', 'error', 'error', 'error', 'created'])
    expect(r.results[0].error).toMatch(/name y category/)
    expect(r.results[1].error).toMatch(/ciudad o lugar/)
    expect(r.results[2].error).toMatch(/organization_id 999/)
    expect(r.results[3].error).toMatch(/price_min/)
    expect(r.results[4].dates).toMatchObject({ added: 1, errors: 1 })
    expect(T.producers().find((p) => p.name === 'Lead Teatro').lead_id).toBe(LEAD)

    expect(await raw('register_external_events', { events: [PARTY] })).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(await raw('register_external_events', { events: [PARTY], reason }, 'readonly')).toMatchObject({ ok: false, code: 'forbidden' })
    expect((await raw('list_external_events', {}, 'readonly')).ok).toBe(true)
  })
})

describe('list / get / update / delete', () => {
  beforeEach(async () => {
    await run('register_external_events', {
      events: [TOUR, PARTY, FONDA, { name: 'Pasado', category: 'concierto', ticketing_platform: 'passline', dates: [{ date: '2026-10-01', city: 'Temuco', sold_out: true }] }],
      reason,
    })
  })

  it('list_external_events: resumen de funciones, giras y filtros', async () => {
    const all = await run('list_external_events', {})
    expect(all.total).toBe(3)
    expect(all.counts_by_category).toMatchObject({ fiesta: 2, concierto: 1 })
    expect(all.counts_by_niche).toMatchObject({ rock: 1, techno: 1, cumbia: 1 })
    const tour = all.items.find((i) => i.name === 'Gira Rock Andino 2026')
    expect(tour).toMatchObject({ functions: 3, first_date: '2026-12-11', last_date: '2026-12-14', is_tour: true, producer: { name: 'Andes Prod' } })
    expect(tour.dates.map((d) => d.venue?.name)).toEqual(['Teatro Caupolicán', 'Teatro Municipal de Viña', 'Teatro Regional'])
    expect(tour.lead_niche).toBe('musica_en_vivo')
    expect((await run('list_external_events', { all_dates: true })).total).toBe(4)
    expect((await run('list_external_events', { city: 'Viña del Mar' })).items.map((i) => i.name)).toEqual(['Gira Rock Andino 2026'])
    expect((await run('list_external_events', { tours_only: true })).total).toBe(1)
    expect((await run('list_external_events', { niche: 'Tecno' })).items.map((i) => i.name)).toEqual(['Techno Night'])
    expect((await run('list_external_events', { uses_ticketing: false })).items.map((i) => i.name)).toEqual(['Fonda Libre'])
    expect((await run('list_external_events', { producer: '@andesprod' })).total).toBe(1)
    expect((await run('list_external_events', { query: 'caupolican' })).total).toBe(1)
    const venueId = T.venues().find((v) => v.name === 'Club Y').id
    expect((await run('list_external_events', { venue_id: venueId })).items.map((i) => i.name)).toEqual(['Techno Night'])
    expect((await run('list_external_events', { all_dates: true, has_outcome: true })).items.map((i) => i.name)).toEqual(['Pasado'])
    const compact = await run('list_external_events', { compact: true, limit: 1 })
    expect(compact.items[0]).toMatchObject({ functions: 3, is_tour: true })
    expect(compact.items[0]).not.toHaveProperty('dates')
  })

  it('get_external_event: funciones con lugar y los otros eventos de esas noches', async () => {
    const party = eventNamed('Techno Night')
    const g = await run('get_external_event', { id: party.id })
    expect(g.event).toMatchObject({ name: 'Techno Night', niche: 'techno', is_tour: false, producer: { name: 'Noche Prod', instagram: 'nocheprod' } })
    expect(g.event.dates[0]).toMatchObject({ date: '2026-12-12', weekday: 'sábado', start_time: '23:30', venue: { name: 'Club Y', capacity: 800 }, city_key: 'santiago' })
    expect(g.same_nights.map((x) => x.name)).toEqual(['Fonda Libre'])
    expect(g.next_step).toMatch(/niche=techno/)
    expect(await raw('get_external_event', { id: 424242 })).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('update_external_event: datos, productora y funciones (agregar, cambiar, borrar, estado)', async () => {
    const tour = eventNamed('Gira Rock Andino 2026')
    const [scl, vina, conce] = datesOf('Gira Rock Andino 2026')
    const u = await run('update_external_event', {
      id: tour.id,
      niche: 'Rock Latino',
      add_note: 'Agregaron Temuco',
      add_dates: [{ date: '2026-12-19', start_time: '21:00', venue: { name: 'Teatro Municipal', city: 'Temuco', capacity: 900 } }],
      update_dates: [{ id: vina.id, sold_out: true, sold_pct: 100, attendance: 1180 }, { id: scl.id, start_time: '20:30' }],
      remove_date_ids: [conce.id],
      reason,
    })
    expect(u.changes.map((c) => c.field).sort()).toEqual(['niche', 'notes'])
    expect(u.dates).toMatchObject({ added: 1, updated: 2, removed: 1, errors: [] })
    expect(u.event).toMatchObject({ niche: 'rock_latino', functions: 3, is_tour: true, sold_out_functions: 1 })
    expect(u.event.cities).toEqual(['Santiago', 'Gran Valparaíso (Viña, Valparaíso, Concón…)', 'temuco'])
    expect(T.dates().find((d) => d.id === scl.id)).toMatchObject({ start_time: '20:30', slot_key: `2026-12-11|20:30|v${scl.venue_id}` })
    expect(eventNamed('Gira Rock Andino 2026').notes).toBe('[2026-11-20] Agregaron Temuco')

    // Mover una función al lugar y hora de otra del mismo evento choca
    const clash = await run('update_external_event', { id: tour.id, update_dates: [{ id: vina.id, date: '2026-12-11', start_time: '20:30', venue: { venue_id: scl.venue_id } }], reason })
    expect(clash.dates.errors[0]).toMatch(/Ya hay otra función/)

    // Se cayó todo; y desvincular la productora
    const cancel = await run('update_external_event', { id: tour.id, set_status_all_dates: 'cancelled', producer: null, reason })
    expect(cancel.event.statuses).toEqual({ cancelled: 3 })
    expect(cancel.event.producer).toBeNull()

    expect(await raw('update_external_event', { id: tour.id, reason })).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(await raw('update_external_event', { id: tour.id, category: null, reason })).toMatchObject({ ok: false, code: 'invalid_input' })
  })

  it('delete_external_events: pide confirmación y borra el evento con sus funciones', async () => {
    const tour = eventNamed('Gira Rock Andino 2026')
    const first = await run('delete_external_events', { ids: [tour.id, 999999], reason })
    expect(first.status).toBe('confirmation_required')
    expect(first.summary).toMatch(/1 evento\(s\) externo\(s\) y sus 3 funciones/)
    expect(first.warnings[0]).toMatch(/999999/)
    const done = await run('delete_external_events', { ids: [tour.id, 999999], reason, confirmation_token: first.confirmation_token })
    expect(done).toMatchObject({ deleted: 1, functions_deleted: 3, not_found: [999999] })
    expect(T.events()).toHaveLength(3)
    expect(T.dates().some((d) => d.event_id === tour.id)).toBe(false)
    expect(T.producers().some((p) => p.name === 'Andes Prod')).toBe(true) // la productora queda
  })
})

describe('productoras y lugares', () => {
  beforeEach(async () => {
    await run('register_external_events', {
      events: [
        TOUR,
        PARTY,
        { name: 'After Techno', category: 'club', niche: 'techno', ticketing_platform: 'passline', producer: { name: 'Noche Prod', instagram: 'nocheprod' }, dates: [{ date: '2026-12-19', venue: { name: 'Club Y', city: 'Santiago' } }] },
        { name: 'Unplugged', category: 'concierto', producer: { name: 'Andes Producciones' }, dates: [{ date: '2026-12-20', venue: { name: 'Caupolicán', city: 'Santiago' } }] },
      ],
      reason,
    })
  })

  it('list_external_producers: actividad, ticketeras, enlaces y nicho de lead sugerido', async () => {
    const r = await run('list_external_producers', {})
    expect(r.items[0]).toMatchObject({ name: 'Noche Prod', events: 2, functions: 2, niches: ['techno'], platforms: ['passline'], cities: ['Santiago'] })
    expect(r.items[0].categories.sort()).toEqual(['club', 'fiesta'])
    expect(r.items.find((p) => p.name === 'Andes Prod')).toMatchObject({ events: 1, functions: 3, suggested_lead_niche: 'musica_en_vivo' })
    expect((await run('list_external_producers', { linked: 'none', min_events: 2 })).items.map((p) => p.name)).toEqual(['Noche Prod'])
    expect((await run('list_external_producers', { city: 'Concepción' })).items.map((p) => p.name)).toEqual(['Andes Prod'])
  })

  it('update_external_producer: enlazar a lead, choque de Instagram y fusión de duplicados', async () => {
    const noche = T.producers().find((p) => p.name === 'Noche Prod')
    const linked = await run('update_external_producer', { id: noche.id, lead_id: LEAD, website: 'https://noche.cl', reason })
    expect(linked.changes.map((c) => c.field).sort()).toEqual(['lead_id', 'website'])
    expect((await run('list_external_producers', { linked: 'lead' })).items.map((p) => p.name)).toEqual(['Noche Prod'])

    const dup = T.producers().find((p) => p.name === 'Andes Producciones')
    const clash = await raw('update_external_producer', { id: dup.id, instagram: '@andesprod', reason })
    expect(clash).toMatchObject({ ok: false, code: 'conflict' })
    expect(clash.message).toMatch(/merge_into_id/)

    const target = T.producers().find((p) => p.name === 'Andes Prod')
    const first = await run('update_external_producer', { id: dup.id, merge_into_id: target.id, reason })
    expect(first.status).toBe('confirmation_required')
    const merged = await run('update_external_producer', { id: dup.id, merge_into_id: target.id, reason, confirmation_token: first.confirmation_token })
    expect(merged).toMatchObject({ merged_into: target.id, events_moved: 1 })
    expect(eventNamed('Unplugged').producer_id).toBe(target.id)
    expect(T.producers().some((p) => p.id === dup.id)).toBe(false)

    const del = await run('update_external_producer', { id: target.id, delete: true, reason })
    expect(del.status).toBe('confirmation_required')
    expect(await raw('update_external_producer', { id: target.id, delete: true, reason, confirmation_token: del.confirmation_token })).toMatchObject({ ok: false, code: 'conflict' })
  })

  it('list_external_venues y update_external_venue: actividad, cambio de ciudad y fusión', async () => {
    const venues = await run('list_external_venues', { city: 'Santiago' })
    expect(venues.items[0]).toMatchObject({ name: 'Club Y', functions: 2, events: 2 })
    expect(venues.items.find((v) => v.name === 'Teatro Caupolicán')).toMatchObject({ capacity: 4500, functions: 1 })

    // Corregir la ciudad del Teatro Regional mueve sus funciones
    const regional = T.venues().find((v) => v.name === 'Teatro Regional')
    const moved = await run('update_external_venue', { id: regional.id, city: 'Talcahuano', capacity: 1500, reason })
    expect(moved.changes.map((c) => c.field)).toEqual(expect.arrayContaining(['city', 'capacity']))
    expect(T.dates().find((d) => d.venue_id === regional.id)).toMatchObject({ city: 'Talcahuano', city_key: 'gran_concepcion' })

    // "Caupolicán" es el mismo lugar que "Teatro Caupolicán"
    const dup = T.venues().find((v) => v.name === 'Caupolicán')
    const real = T.venues().find((v) => v.name === 'Teatro Caupolicán')
    const first = await run('update_external_venue', { id: dup.id, merge_into_id: real.id, reason })
    expect(first.status).toBe('confirmation_required')
    const merged = await run('update_external_venue', { id: dup.id, merge_into_id: real.id, reason, confirmation_token: first.confirmation_token })
    expect(merged).toMatchObject({ merged_into: real.id, functions_moved: 1, functions_deduplicated: 0 })
    expect(datesOf('Unplugged')[0]).toMatchObject({ venue_id: real.id, slot_key: `2026-12-20|-|v${real.id}` })
    expect(T.venues().some((v) => v.id === dup.id)).toBe(false)
  })
})

describe('mapa de mercado y modelo', () => {
  beforeEach(async () => {
    await run('register_external_events', {
      events: [
        TOUR,
        PARTY,
        FONDA,
        { name: 'Techno Night II', category: 'fiesta', niche: 'techno', ticketing_platform: 'passline', price_min: 12000, producer: { name: 'Noche Prod', instagram: 'nocheprod' }, dates: [{ date: '2026-12-19', venue: { name: 'Club Y', city: 'Santiago' } }] },
      ],
      reason,
    })
  })

  it('get_market_map: categorías con nichos, giras, lugares, ticketeras y oportunidades', async () => {
    const m = await run('get_market_map', {})
    expect(m.sources).toMatchObject({ external_functions: 6, aitickets_functions: 1, include_internal: true })
    expect(m.totals).toMatchObject({ events: 5, functions: 7, tours: 1 })
    const fiesta = m.categories.find((c) => c.category === 'fiesta')
    expect(fiesta).toMatchObject({ events: 4 })
    expect(fiesta.niches.map((x) => x.key)).toEqual(expect.arrayContaining(['techno', 'cumbia']))
    expect(m.tours[0]).toMatchObject({ event: 'Gira Rock Andino 2026', producer: 'Andes Prod', functions: 3 })
    expect(m.tours[0].cities).toHaveLength(3)
    expect(m.venues[0]).toMatchObject({ name: 'Club Y', functions: 2 })
    expect(m.platforms.find((p) => p.platform === 'aitickets')).toMatchObject({ events: 1 })
    expect(m.opportunities.map((o) => o.name)).toEqual(['Noche Prod'])
    expect(m.opportunities[0]).toMatchObject({ events: 2, platforms: ['passline'], suggested_lead_niche: 'fiestas', producer_id: expect.any(Number) })
    expect(m.data_quality).toMatchObject({ events_without_producer: 0, events_without_niche: 0 })
    const techno = await run('get_market_map', { niche: 'Tecno', include_internal: false })
    expect(techno.totals.events).toBe(2)
  })

  it('evaluate_event_date: la gira compite en cada ciudad; el nicho pesa; un evento no compite consigo mismo', async () => {
    const vina = await run('evaluate_event_date', { category: 'concierto', date: '2026-12-12', city: 'Viña del Mar', include_internal: false })
    expect(vina.competition.events.map((e) => e.name)).toEqual(['Gira Rock Andino 2026'])
    expect(vina.competition.events[0]).toMatchObject({ niche: 'rock', producer: 'Andes Prod', ticketing_platform: 'puntoticket' })
    const tour = eventNamed('Gira Rock Andino 2026')
    const self = await run('evaluate_event_date', { category: 'concierto', date: '2026-12-12', city: 'Viña del Mar', external_event_id: tour.id, include_internal: false })
    expect(self.competition.events).toEqual([])

    const party = await run('evaluate_event_date', { category: 'fiesta', niche: 'techno', date: '2026-12-12', city: 'Las Condes', price: 11000 })
    const w = Object.fromEntries(party.competition.events.map((e) => [e.name, e.weight]))
    expect(w['Fonda Libre']).toBe(0.6) // otro nicho de la misma categoría
    expect(w['Techno Night']).toBeGreaterThan(1) // mismo nicho y 800 personas
    expect(w['Fiesta AI']).toBeGreaterThan(0) // AI Tickets (sin nicho)
    expect(party.price_check).toMatchObject({ your_price: 11000 })
    expect(party.note).toMatch(/heurístico/)
    expect(await raw('evaluate_event_date', { category: 'fiesta' })).toMatchObject({ ok: false, code: 'invalid_input' })
  })

  it('recommend_event_dates: rango, días de la semana y límite', async () => {
    const r = await run('recommend_event_dates', { category: 'fiesta', niche: 'techno', city: 'Santiago', from: '2026-12-01', to: '2026-12-31', weekdays: ['viernes', 'sabado'], top: 3 })
    expect(r.top).toHaveLength(3)
    expect(r.top.every((t) => ['viernes', 'sábado'].includes(t.weekday))).toBe(true)
    expect(r.evaluated_dates).toBe(8)
    expect(await run('recommend_event_dates', { category: 'teatro' })).toMatchObject({ from: '2026-12-04', to: '2027-03-03' })
    expect(await raw('recommend_event_dates', { category: 'fiesta', from: '2026-12-01', to: '2027-12-01' })).toMatchObject({ ok: false, code: 'invalid_input' })
  })
})

describe('calendario de mercado', () => {
  it('crea un interferiado que arma fin de semana largo, lo lista y lo borra', async () => {
    const up = await run('upsert_market_calendar', {
      entries: [
        { kind: 'bridge_holiday', label: 'Interferiado 7 de diciembre', date_from: '2026-12-07', region: 'metropolitana' },
        { kind: 'school_vacation', label: 'Vacaciones de invierno', date_from: '2027-07-05', date_to: '2027-07-16', categories: ['infantil'] },
      ],
      reason,
    })
    expect(up).toMatchObject({ created: 2, updated: 0 })
    expect(up.entries[1]).toMatchObject({ kind: 'school_vacation', categories: ['infantil'] })

    const cal = await run('list_market_calendar', { from: '2026-12-01', to: '2026-12-31', city: 'Santiago' })
    expect(cal.holidays.map((h) => h.date)).toEqual(['2026-12-07', '2026-12-08', '2026-12-25'])
    expect(cal.holidays[0]).toMatchObject({ source: 'calendario' })
    expect(cal.long_weekends.map((l) => [l.start, l.end, l.days])).toEqual([['2026-12-05', '2026-12-08', 4], ['2026-12-25', '2026-12-27', 3]])

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
    expect((await run('list_external_events', { all_dates: true })).note).toMatch(/202611200100/)
    db.failOn('aitickets_external_events', 'select', { code: '42P01', message: 'no existe' }, { once: false })
    db.failOn('aitickets_external_producers', 'select', { code: '42P01', message: 'no existe' }, { once: false })
    expect(await raw('register_external_events', { events: [PARTY], reason })).toMatchObject({ ok: false, code: 'unavailable' })
    expect((await run('list_external_producers', {})).note).toMatch(/202611200100/)
    const r = await run('evaluate_event_date', { category: 'fiesta', date: '2026-12-12', city: 'Santiago' })
    expect(r.warnings.join(' ')).toMatch(/202611200100/)
  })
})
