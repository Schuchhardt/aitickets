// Ocupación de cada función en una vista (ítem 13): functionOccupancy (src/lib/eventAnalytics.ts), el módulo del
// panel y get_event_performance. Sin red ni BD.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))

const analytics = await import('../../src/lib/eventAnalytics.ts')
const { resolveModules } = await import('../../src/lib/eventModules.ts')

const attendee = (id, ticket, extra = {}) => ({ id, event_id: 10, event_ticket_id: ticket, status: 'active', is_complimentary: false, ...extra })

beforeEach(() => {
  db = createFakeSupabase({
    tables: {
      events: [{ id: 10, organization_id: 7, name: 'Obra', slug: 'obra', status: 'published' }],
      event_dates: [
        { id: 502, event_id: 10, date: '2026-11-14', start_time: '20:00:00' },
        { id: 501, event_id: 10, date: '2026-11-07', start_time: '20:00:00' },
        { id: 503, event_id: 10, date: '2026-11-21', start_time: '20:00:00' },
      ],
      event_tickets: [
        { id: 1, event_id: 10, ticket_name: 'General', event_date_id: 501, total_quantity: 4 },
        { id: 2, event_id: 10, ticket_name: 'Estudiante', event_date_id: 501, total_quantity: 1 },
        { id: 3, event_id: 10, ticket_name: 'General', event_date_id: 502, total_quantity: null },
        { id: 4, event_id: 10, ticket_name: 'Cortesía', event_date_id: null, total_quantity: 30, is_gift: false },
        { id: 5, event_id: 10, ticket_name: 'General', event_date_id: 503, total_quantity: 10 },
      ],
      event_attendees: [
        attendee(1, 1, { status: 'validated' }),
        attendee(2, 1),
        attendee(3, 1, { is_complimentary: true }),
        attendee(4, 2),
        attendee(5, 1, { status: 'cancelled' }),
        attendee(6, 3),
        attendee(7, 4, { is_complimentary: true }),
      ],
      event_orders: [],
      event_visits: [],
    },
    rpc: { aitickets_ticket_availability: () => [] },
  })
})

describe('functionOccupancy', () => {
  it('una fila por función, en orden de fecha: vendidas, cortesías, cupo y %', async () => {
    const rows = await analytics.functionOccupancy(db, 10)
    expect(rows).toEqual([
      // 2 vendidas de General + 1 Estudiante, 1 cortesía en General; la anulada no cuenta. Cupo 4 + 1 = 5
      { event_date_id: 501, label: expect.stringContaining('7 nov'), sold: 3, courtesy: 1, issued: 4, checked_in: 1, capacity: 5, occupancy_pct: 80 },
      // Tipo sin límite: no hay %
      { event_date_id: 502, label: expect.stringContaining('14 nov'), sold: 1, courtesy: 0, issued: 1, checked_in: 0, capacity: null, occupancy_pct: null },
      // Sin entradas emitidas también aparece
      { event_date_id: 503, label: expect.stringContaining('21 nov'), sold: 0, courtesy: 0, issued: 0, checked_in: 0, capacity: 10, occupancy_pct: 0 },
      // El tipo "Cortesía" del sistema no tiene función ni es cupo a la venta
      { event_date_id: null, label: 'Válidas para cualquier función', sold: 0, courtesy: 1, issued: 1, checked_in: 0, capacity: null, occupancy_pct: null },
    ])
  })

  it('get_event_performance la trae con varias funciones', async () => {
    const { eventPerformance } = await import('../../src/lib/producer-api/tools/analytics.ts')
    const ctx = { supabase: db, actor: { orgId: 7, eventIds: null }, origin: 'https://aitickets.cl' }
    const r = await eventPerformance(ctx, 10, 7)
    expect(r.occupancy_by_function.map((f) => [f.event_date_id, f.issued, f.occupancy_pct])).toEqual([[501, 4, 80], [502, 1, null], [503, 0, 0], [null, 1, null]])
  })
})

describe('módulo del panel', () => {
  const ctx = (over = {}) => ({ profile: 'funciones', status: 'published', functionCount: 1, ticketTypeCount: 1, phase: 'before', waitlistCount: 0, hasAttendees: true, isMassive: false, ...over })
  it('aparece en Entradas y ventas solo con más de una función', () => {
    expect(resolveModules(ctx()).find((m) => m.id === 'function-occupancy')).toBeUndefined()
    expect(resolveModules(ctx({ functionCount: 3 })).find((m) => m.id === 'function-occupancy')).toMatchObject({ tab: 'ventas', enabled: true })
  })
})
