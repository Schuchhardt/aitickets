// Ventas y asistentes por función (ítem 23): orderForFunction / salesByFunction (src/lib/eventAnalytics.ts), la
// analítica del panel con ?funcion=, get_event_performance y el CSV de órdenes con event_date_id. Sin red ni BD.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
let session
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))
vi.mock('../../src/lib/supabaseServer', () => ({
  EVENT_MANAGER_ROLES: ['admin', 'producer', 'editor'],
  getSessionContext: async () => session,
  hasRole: (u, roles) => roles.includes(u?.role),
  getOwnedEvent: async (id, orgId) => db.tables.events.find((e) => e.id === Number(id) && e.organization_id === orgId) || null,
  jsonResponse: (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))

const analytics = await import('../../src/lib/eventAnalytics.ts')
const csvEndpoint = await import('../../src/pages/api/events/orders-csv.ts')

const line = (id, event_date_id, price, quantity, extra = {}) => ({ id, name: `T${id}`, price, quantity, total: price * quantity, event_date_id, ...extra })
const order = (id, lines, extra = {}) => ({
  id, event_id: 10, status: 'paid', created_at: '2026-10-10T15:00:00Z', payment_provider: 'flow',
  amount: lines.reduce((n, l) => n + l.total, 0), ticket_qty: lines.reduce((n, l) => n + l.quantity, 0), ticket_details: lines,
  attendees: { first_name: 'Ana', last_name: 'Pérez', email: 'ana@x.cl', phone: null }, ...extra,
})

function seed() {
  db = createFakeSupabase({
    tables: {
      events: [{ id: 10, organization_id: 7, name: 'Curso de cerámica', slug: 'ceramica', status: 'published' }],
      event_dates: [
        { id: 502, event_id: 10, date: '2026-11-14', start_time: '10:00:00' },
        { id: 501, event_id: 10, date: '2026-11-07', start_time: '10:00:00' },
      ],
      event_tickets: [
        { id: 1, event_id: 10, ticket_name: 'Sábado 7', event_date_id: 501 },
        { id: 2, event_id: 10, ticket_name: 'Sábado 14', event_date_id: 502 },
        { id: 3, event_id: 10, ticket_name: 'Curso completo', event_date_id: null },
      ],
      event_orders: [
        // Una compra con entradas de las dos funciones y un descuento
        order('o1', [line(1, 501, 10000, 1), line(2, 502, 10000, 2)], { amount: 24000, discount_amount: 6000, ref: 'cata' }),
        order('o2', [line(2, 502, 10000, 1)], { utm_source: 'instagram' }),
        // Orden antigua sin event_date_id en la línea: sale del tipo de entrada
        order('o3', [{ id: 1, name: 'Sábado 7', price: 10000, quantity: 1, total: 10000 }]),
        order('o4', [line(3, null, 18000, 1)]),
        order('c1', [line(1, 501, 0, 1, { complimentary: true })], { payment_provider: 'courtesy', amount: 0 }),
      ],
      event_visits: [],
      event_attendees: [],
    },
    rpc: { aitickets_ticket_availability: () => [] },
  })
}

beforeEach(() => {
  seed()
  session = { dbUser: { id: 1, role: 'producer', organization_id: 7 } }
})

describe('orderForFunction', () => {
  it('deja solo las líneas de la función y su parte del monto', () => {
    const o1 = db.tables.event_orders[0]
    expect(analytics.orderForFunction(o1, '501')).toMatchObject({ ticket_qty: 1, amount: 8000, discount_amount: 2000 })
    expect(analytics.orderForFunction(o1, '502')).toMatchObject({ ticket_qty: 2, amount: 16000 })
    expect(analytics.orderForFunction(o1, analytics.ALL_FUNCTIONS)).toBeNull()
    // Una orden de una sola función queda igual
    const o2 = db.tables.event_orders[1]
    expect(analytics.orderForFunction(o2, '502')).toBe(o2)
  })
})

describe('analítica del panel por función', () => {
  it('ventas por función, en orden de fecha y con las válidas para cualquier función aparte', async () => {
    const r = await analytics.getEventAnalytics(db, { id: 10, status: 'published' })
    expect(r.functions.map((f) => f.id)).toEqual([501, 502])
    expect(r.sales_by_function).toEqual([
      { event_date_id: 501, label: expect.stringContaining('7 nov'), orders: 2, tickets: 2, revenue_clp: 18000 },
      { event_date_id: 502, label: expect.stringContaining('14 nov'), orders: 2, tickets: 3, revenue_clp: 26000 },
      { event_date_id: null, label: 'Válidas para cualquier función', orders: 1, tickets: 1, revenue_clp: 18000 },
    ])
    expect(r.function_channels).toBeNull()
  })

  it('con ?funcion= trae las ventas por canal de esa función', async () => {
    const r = await analytics.getEventAnalytics(db, { id: 10, status: 'published' }, { eventDateId: 502 })
    expect(r.selected_function).toMatchObject({ id: 502 })
    expect(r.function_channels).toEqual([
      { channel: 'ref:cata', orders: 1, tickets: 2, revenue_clp: 16000 },
      { channel: 'instagram', orders: 1, tickets: 1, revenue_clp: 10000 },
    ])
    // Una función que no es del evento se ignora
    expect((await analytics.getEventAnalytics(db, { id: 10, status: 'published' }, { eventDateId: 999 })).function_channels).toBeNull()
  })

  it('get_event_performance trae sales_by_function solo con varias funciones', async () => {
    const { eventPerformance } = await import('../../src/lib/producer-api/tools/analytics.ts')
    const ctx = { supabase: db, actor: { orgId: 7, eventIds: null }, origin: 'https://aitickets.cl' }
    const r = await eventPerformance(ctx, 10, 7)
    expect(r.sales_by_function.map((f) => [f.event_date_id, f.tickets])).toEqual([[501, 2], [502, 3], [null, 1]])
    db.tables.event_dates = db.tables.event_dates.slice(0, 1)
    expect((await eventPerformance(ctx, 10, 7)).sales_by_function).toBeUndefined()
  })
})

describe('CSV de órdenes por función', () => {
  const csv = async (query) => {
    const url = new URL(`https://aitickets.test/api/events/orders-csv?event_id=10${query}`)
    const res = await csvEndpoint.GET({ url, request: new Request(url) })
    return { res, rows: (await res.text()).replace(/^﻿/, '').split('\r\n').map((r) => r.split(';')) }
  }

  it('con varias funciones agrega la columna Función', async () => {
    const { rows } = await csv('')
    const col = rows[0].indexOf('Función')
    expect(col).toBeGreaterThan(0)
    expect(rows[0]).not.toContain('Entradas de la función')
    const byOrder = Object.fromEntries(rows.slice(1).map((r) => [r[0], r[col]]))
    expect(byOrder.o1).toMatch(/7 nov.*\|.*14 nov/)
    expect(byOrder.o3).toMatch(/7 nov/)
    expect(byOrder.o4).toBe('Todas las funciones')
  })

  it('event_date_id deja las órdenes de esa función (y las válidas para todas) con sus entradas de esa función', async () => {
    const { res, rows } = await csv('&event_date_id=501')
    expect(res.headers.get('Content-Disposition')).toMatch(/ordenes-ceramica-.*7-nov.*\.csv/)
    const col = rows[0].indexOf('Entradas de la función')
    expect(Object.fromEntries(rows.slice(1).map((r) => [r[0], r[col]]))).toEqual({ o1: '1', o3: '1', o4: '1', c1: '1' })
    expect((await csv('&event_date_id=999')).res.status).toBe(400)
  })
})
