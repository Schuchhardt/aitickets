// Aforo en vivo del panel (ítem 7): /api/events/checkin-stats es get_checkin_stats con la sesión del usuario
// (src/lib/producer-api/session.ts), con permiso "checkin" y acceso por evento. Sin red ni BD.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
let session
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))
vi.mock('../../src/lib/supabaseServer', () => ({ getSessionContext: async () => session }))

const { GET } = await import('../../src/pages/api/events/checkin-stats.ts')

const attendee = (id, ticket, status, validated_at = null) => ({ id, event_id: 10, event_ticket_id: ticket, status, validated_at, is_complimentary: false })

beforeEach(() => {
  db = createFakeSupabase({
    tables: {
      events: [
        { id: 10, organization_id: 7, name: 'Viernes', capacity: 100 },
        { id: 11, organization_id: 7, name: 'Sábado', capacity: 50 },
        { id: 20, organization_id: 8, name: 'Ajeno', capacity: 10 },
      ],
      event_tickets: [
        { id: 1, event_id: 10, ticket_name: 'Lista', event_date_id: null, total_quantity: 60 },
        { id: 2, event_id: 10, ticket_name: 'Cover', event_date_id: null, total_quantity: 40 },
      ],
      event_dates: [{ id: 501, event_id: 10, date: '2026-11-07', start_time: '23:00:00' }],
      event_attendees: [
        attendee(1, 1, 'validated', new Date().toISOString()),
        attendee(2, 1, 'active'),
        attendee(3, 2, 'validated', new Date().toISOString()),
        attendee(4, 2, 'cancelled'),
      ],
      event_orders: [],
      aitickets_event_staff: [],
      aitickets_api_audit: [],
    },
  })
  session = { dbUser: { id: 1, role: 'producer', organization_id: 7, name: 'Ana', email: 'a@p.cl' } }
})

const get = (eventId) => {
  const url = new URL(`https://aitickets.test/api/events/checkin-stats?event_id=${eventId}`)
  return GET({ url, request: new Request(url), cookies: {} })
}

describe('/api/events/checkin-stats', () => {
  it('devuelve ingresados sobre emitidas, por tipo de entrada, sin caché', async () => {
    const res = await get(10)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = await res.json()
    expect(body).toMatchObject({ issued: 3, checked_in: 2, pending: 1, capacity: 100, occupancy_pct: 2 })
    expect(body.by_ticket_type).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Lista', issued: 2, checked_in: 1 }),
        expect.objectContaining({ name: 'Cover', issued: 1, checked_in: 1 }),
      ]),
    )
    expect(body.arrivals_last_3h.reduce((n, a) => n + a.count, 0)).toBe(2)
  })

  it('la puerta lo ve; solo lectura y finanzas no; otro evento u otra productora no', async () => {
    session.dbUser.role = 'validator'
    expect((await get(10)).status).toBe(200)
    session.dbUser.role = 'viewer'
    expect((await get(10)).status).toBe(403)
    session.dbUser.role = 'finance'
    expect((await get(10)).status).toBe(403)
    session.dbUser.role = 'producer'
    expect((await get(20)).status).toBe(404)
    expect((await get('x')).status).toBe(400)
  })

  it('un miembro asignado a ciertos eventos solo ve los suyos', async () => {
    session.dbUser = { ...session.dbUser, id: 2, role: 'editor' }
    db.tables.aitickets_event_staff.push({ id: 1, user_id: 2, event_id: 11 })
    expect((await get(10)).status).toBe(403)
    expect((await get(11)).status).toBe(200)
  })

  it('sin sesión, 401', async () => {
    session = null
    expect((await get(10)).status).toBe(401)
  })
})
