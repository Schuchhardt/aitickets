// Analítica de eventos (src/lib/eventAnalytics.ts): paginación, definiciones canónicas, hora de Chile, conversión
// por canal y tolerancia a la columna event_visits.ref que aún no existe (deploy preview sin migrar).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))

const analytics = await import('../../src/lib/eventAnalytics.ts')
const { recordEventVisit } = await import('../../src/lib/eventPage.ts')

const EVENT = { id: 10, status: 'published' }
const sale = (id, extra = {}) => ({
  id, event_id: 10, status: 'paid', created_at: '2026-10-10T15:00:00Z', amount: 10000, ticket_qty: 1, payment_provider: 'flow',
  ticket_details: [{ name: 'General', price: 10000, quantity: 1 }], ...extra,
})

function fakeDb(tables = {}, rpc = {}) {
  return createFakeSupabase({
    tables: { events: [{ id: 10, organization_id: 1, status: 'published' }], event_orders: [], event_visits: [], event_attendees: [], event_tickets: [], ...tables },
    rpc: { aitickets_ticket_availability: () => [], ...rpc },
  })
}

beforeEach(() => {
  db = fakeDb()
})

describe('paginación (PostgREST corta en 1000 filas)', () => {
  it('cuenta todas las visitas y órdenes aunque pasen de 1000', async () => {
    db = fakeDb({
      event_visits: Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, event_id: 10, created_at: '2026-10-10T15:00:00Z', ip_hash: `ip${i % 1200}`, referrer: null })),
      event_orders: Array.from({ length: 1500 }, (_, i) => sale(`o${i}`)),
    })
    const r = await analytics.getEventAnalytics(db, EVENT)
    expect(r.kpis).toMatchObject({ visits: 2500, unique_visitors: 1200, paid_orders: 1500, tickets_sold: 1500, revenue_clp: 15_000_000, conversion_pct: 125 })
    expect(r.visits_truncated).toBe(false)
    const summary = await analytics.getEventSummary(db, EVENT)
    expect(summary).toMatchObject({ visits: 2500, unique_visitors: 1200, tickets_sold: 1500 })
  })

  it('el resumen usa la RPC de conteo de visitas si existe', async () => {
    db = fakeDb({}, { aitickets_event_visit_counts: () => [{ visits: 90000, unique_visitors: 40000 }] })
    expect(await analytics.eventVisitCounts(db, 10)).toEqual({ visits: 90000, unique_visitors: 40000, truncated: false })
  })

  it('totales de la organización por tandas de eventos', async () => {
    const ids = Array.from({ length: 400 }, (_, i) => i + 1)
    db = fakeDb({ event_orders: ids.flatMap((id) => [sale(`a${id}`, { event_id: id }), sale(`c${id}`, { event_id: id, amount: 0, payment_provider: 'courtesy', ticket_qty: 2, ticket_details: [] })]) })
    expect(await analytics.orgSalesTotals(db, ids)).toEqual({ paid_orders: 400, tickets_sold: 400, courtesy_tickets: 800, revenue_clp: 4_000_000 })
    expect(db.calls.filter((c) => c.table === 'event_orders').length).toBeGreaterThanOrEqual(3)
  })
})

describe('definiciones', () => {
  it('ventas sin cortesías ni transferencias; la transferida cuenta en su origen', async () => {
    db = fakeDb({
      event_orders: [
        // Origen: compró 2, transfirió 1 (quantity baja, transferred_out sube; amount no cambia)
        sale('src', { amount: 20000, ticket_qty: 1, ticket_details: [{ name: 'General', price: 10000, quantity: 1, transferred_out: 1 }] }),
        sale('xfer', { amount: 0, ticket_qty: 1, payment_provider: 'free', ticket_details: [{ name: 'General', price: 10000, quantity: 1, transferred_from_order: 'src' }] }),
        sale('court', { amount: 0, ticket_qty: 3, payment_provider: 'courtesy', ticket_details: [] }),
        sale('free', { amount: 0, payment_provider: 'free', ticket_details: [{ name: 'Liberada', price: 0, quantity: 1 }] }),
        { ...sale('refunded'), status: 'refunded' },
      ],
    })
    const r = await analytics.getEventAnalytics(db, EVENT)
    expect(r.kpis).toMatchObject({ paid_orders: 2, tickets_sold: 3, courtesy_tickets: 3, revenue_clp: 20000 })
    expect(r.refunded_orders).toBe(1)
    expect(r.providers.map((p) => [p.label, p.orders, p.tickets])).toEqual([['Webpay', 1, 2], ['Gratis', 1, 1]])
  })

  it('entradas vigentes por tipo: sin anuladas y con las cortesías aparte', async () => {
    db = fakeDb({
      event_attendees: [
        { id: 'a1', event_id: 10, event_ticket_id: 1, status: 'active', is_complimentary: false, event_tickets: { ticket_name: 'General' } },
        { id: 'a2', event_id: 10, event_ticket_id: 1, status: null, is_complimentary: false, event_tickets: { ticket_name: 'General' } },
        { id: 'a3', event_id: 10, event_ticket_id: 1, status: 'cancelled', is_complimentary: false, event_tickets: { ticket_name: 'General' } },
        { id: 'a4', event_id: 10, event_ticket_id: 1, status: 'validated', is_complimentary: true, event_tickets: { ticket_name: 'General' } },
        { id: 'a5', event_id: 10, event_ticket_id: 2, status: 'active', is_complimentary: true, event_tickets: { ticket_name: 'Cortesía' } },
      ],
    })
    const types = await analytics.issuedByTicketType(db, 10)
    expect(types.map((t) => [t.name, t.tickets])).toEqual([['General', 2], ['General (cortesía)', 1], ['Cortesía', 1]])
    const summary = await analytics.getEventSummary(db, EVENT)
    expect(summary.issued_by_ticket_type_id).toEqual({ 1: 3, 2: 1 })
  })

  it('ocupación = emitidas ÷ capacidad a la venta (sin el tipo de cortesía del sistema)', async () => {
    db = fakeDb(
      {
        event_tickets: [
          { id: 1, event_id: 10, ticket_name: 'General', price: 10000, total_quantity: 100, status: 'available', is_gift: false },
          { id: 2, event_id: 10, ticket_name: 'Cortesía', price: 0, total_quantity: null, status: 'available', is_gift: true },
        ],
      },
      { aitickets_ticket_availability: () => [{ ticket_id: 1, sold: 25, pending: 0 }, { ticket_id: 2, sold: 40, pending: 0 }] },
    )
    const cap = await analytics.eventCapacity(db, EVENT)
    expect(cap).toMatchObject({ capacity: 100, issued: 25, sellThroughPct: 25, unlimited: false })
  })
})

describe('hora de Chile', () => {
  it('agrupa por día y hora local (UTC-3 en octubre)', async () => {
    db = fakeDb({
      event_visits: [
        { id: 1, event_id: 10, created_at: '2026-10-01T02:30:00Z', ip_hash: 'a', referrer: null }, // 30-09 23:30 en Chile
        { id: 2, event_id: 10, created_at: '2026-10-01T15:00:00Z', ip_hash: 'b', referrer: 'https://www.instagram.com/' },
      ],
      event_orders: [sale('o1', { created_at: '2026-10-03T01:00:00Z' })], // 02-10 22:00 en Chile
    })
    const r = await analytics.getEventAnalytics(db, EVENT)
    expect(r.daily.map((d) => d.date)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02'])
    expect(r.daily.map((d) => [d.visits, d.tickets])).toEqual([[1, 0], [1, 0], [0, 1]])
    expect(r.peak_hours[23]).toBe(1)
    expect(r.peak_hours[12]).toBe(1)
    expect(r.sources.map((s) => s.source).sort()).toEqual(['Directo', 'Instagram'])
  })
})

describe('conversión por canal', () => {
  it('visitantes y órdenes por ref / utm, con el mismo criterio', async () => {
    db = fakeDb({
      event_visits: [
        { id: 1, event_id: 10, created_at: '2026-10-10T12:00:00Z', ip_hash: 'a', ref: 'dj' },
        { id: 2, event_id: 10, created_at: '2026-10-10T12:00:00Z', ip_hash: 'a', ref: 'dj' },
        { id: 3, event_id: 10, created_at: '2026-10-10T12:00:00Z', ip_hash: 'b', ref: 'dj' },
        { id: 4, event_id: 10, created_at: '2026-10-10T12:00:00Z', ip_hash: 'c', utm_source: 'instagram' },
        { id: 5, event_id: 10, created_at: '2026-10-10T12:00:00Z', ip_hash: 'd' },
      ],
      event_orders: [sale('o1', { ref: 'dj' }), sale('o2', { utm_source: 'instagram' }), sale('o3', { utm_source: 'instagram' })],
    })
    const r = await analytics.getEventAnalytics(db, EVENT)
    const byChannel = Object.fromEntries(r.channels.map((c) => [c.channel, c]))
    expect(byChannel['ref:dj']).toMatchObject({ visits: 3, unique_visitors: 2, orders: 1, conversion_pct: 50 })
    // Más órdenes que visitantes (visitas sin el parámetro): no se informa una conversión irreal
    expect(byChannel.instagram).toMatchObject({ unique_visitors: 1, orders: 2, conversion_pct: null })
    expect(byChannel['Directo / sin seguimiento']).toMatchObject({ unique_visitors: 1, orders: 0, conversion_pct: 0 })
    expect(r.ref_tracked).toBe(true)
  })

  it('sin la columna ref (deploy preview sin migrar) lee las visitas igual y no inventa visitas para ref', async () => {
    db = fakeDb({
      event_visits: [{ id: 1, event_id: 10, created_at: '2026-10-10T12:00:00Z', ip_hash: 'a' }],
      event_orders: [sale('o1', { ref: 'dj' })],
    })
    db.failOn('event_visits', 'select', { code: '42703', message: 'column event_visits.ref does not exist' })
    const r = await analytics.getEventAnalytics(db, EVENT)
    expect(r.ref_tracked).toBe(false)
    expect(r.kpis.visits).toBe(1)
    expect(r.channels.find((c) => c.channel === 'ref:dj')).toMatchObject({ visits: null, unique_visitors: null, orders: 1, conversion_pct: null })
  })

  it('get_event_performance mantiene sus campos y agrega la conversión por canal', async () => {
    const { eventPerformance } = await import('../../src/lib/producer-api/tools/analytics.ts')
    db = fakeDb({
      event_visits: [{ id: 1, event_id: 10, created_at: '2026-10-10T12:00:00Z', ip_hash: 'a', ref: 'dj', country: 'CL', city: 'Santiago' }],
      event_orders: [sale('o1', { ref: 'dj' })],
    })
    const ctx = { supabase: db, actor: { orgId: 1, eventIds: null }, origin: 'https://aitickets.cl' }
    const r = await eventPerformance(ctx, 10, 7)
    expect(r.sales_channels).toEqual([{ channel: 'ref:dj', orders: 1, tickets: 1, revenue_clp: 10000 }])
    expect(r.channel_conversion[0]).toMatchObject({ channel: 'ref:dj', unique_visitors: 1, orders: 1, conversion_pct: 100 })
    expect(r.traffic.top_locations).toEqual([{ location: 'Santiago, CL', visits: 1, percentage: 100 }])
    expect(r.sales_by_payment_provider[0]).toMatchObject({ provider: 'flow', label: 'Webpay', orders: 1 })
  })
})

describe('recordEventVisit guarda ref', () => {
  const request = (headers = {}) => new Request('https://aitickets.cl/api/events/visit', { headers: { 'user-agent': 'Mozilla/5.0', 'x-nf-client-connection-ip': '1.2.3.4', ...headers } })

  it('guarda el ref recortado', async () => {
    await recordEventVisit(10, request(), { ref: `  ${'x'.repeat(200)}  `, utmSource: 'ig' })
    expect(db.tables.event_visits[0]).toMatchObject({ event_id: 10, ref: 'x'.repeat(128), utm_source: 'ig' })
  })

  it('sin la columna ref guarda la visita igual', async () => {
    db.failOn('event_visits', 'insert', { code: 'PGRST204', message: "Could not find the 'ref' column of 'event_visits'" })
    await recordEventVisit(10, request(), { ref: 'dj' })
    expect(db.tables.event_visits).toHaveLength(1)
    expect(db.tables.event_visits[0].ref).toBeUndefined()
  })

  it('sin ref no manda la columna', async () => {
    await recordEventVisit(10, request(), { referrer: 'https://google.com' })
    const insert = db.calls.find((c) => c.table === 'event_visits' && c.op === 'insert')
    expect('ref' in insert.values).toBe(false)
  })
})
