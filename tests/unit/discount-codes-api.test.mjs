// /api/discount-codes: autorización por rol y alcance por organización (service role => filtros explícitos).
import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
let session

vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e) }))
vi.mock('../../src/lib/supabaseServer', () => ({
  EVENT_MANAGER_ROLES: ['admin', 'producer', 'editor'],
  getSessionContext: async () => session,
  hasRole: (u, roles) => roles.includes(u?.role),
  jsonResponse: (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  // Como el real: organización + acceso por evento (un miembro con filas en aitickets_event_staff solo ve esos eventos)
  getOwnedEvent: async (eventId, orgId, _cols, userId) => {
    const event = (db.tables.events || []).find((e) => String(e.id) === String(eventId) && e.organization_id === orgId)
    const staff = (db.tables.aitickets_event_staff || []).filter((r) => userId != null && r.user_id === userId).map((r) => r.event_id)
    return event && (!staff.length || staff.includes(Number(event.id))) ? event : null
  },
}))

const api = await import('../../src/pages/api/discount-codes/index.ts')

const ctx = (method, body, search = '') => ({
  request: new Request(`https://example.test/api/discount-codes${search}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }),
  url: new URL(`https://example.test/api/discount-codes${search}`),
})

function setup(role = 'producer') {
  session = { dbUser: { id: 1, organization_id: 7, role } }
  db = createFakeSupabase({
    tables: {
      events: [{ id: 3, name: 'Mío', organization_id: 7 }, { id: 9, name: 'Ajeno', organization_id: 8 }],
      aitickets_discount_codes: [
        { id: '00000000-0000-0000-0000-000000000001', organization_id: 7, event_id: null, code: 'TODOS', kind: 'percent', value: 10, active: true, created_at: '2026-10-01' },
        { id: '00000000-0000-0000-0000-000000000002', organization_id: 7, event_id: 3, code: 'EV3', kind: 'fixed', value: 2000, active: true, created_at: '2026-10-02' },
        { id: '00000000-0000-0000-0000-000000000003', organization_id: 8, event_id: 9, code: 'AJENO', kind: 'fixed', value: 2000, active: true, created_at: '2026-10-03' },
      ],
    },
    rpc: { aitickets_discount_code_stats: () => [{ code_id: '00000000-0000-0000-0000-000000000002', uses: 3, paid_orders: 2, discount_total: 4000, revenue: 16000 }] },
  })
}

describe('/api/discount-codes', () => {
  it('GET lista solo los códigos de la organización, con métricas', async () => {
    setup()
    const res = await api.GET(ctx('GET'))
    const { codes } = await res.json()
    expect(codes.map((c) => c.code).sort()).toEqual(['EV3', 'TODOS'])
    expect(codes.find((c) => c.code === 'EV3')).toMatchObject({ uses: 3, paidOrders: 2, discountTotal: 4000, revenue: 16000, eventName: 'Mío' })
  })

  it('GET no muestra los premios por calificar (source review_reward)', async () => {
    setup()
    db.tables.aitickets_discount_codes.push({ id: '00000000-0000-0000-0000-000000000004', organization_id: 7, event_id: null, code: 'GRACIAS-ABC234', kind: 'percent', value: 10, active: true, source: 'review_reward', created_at: '2026-10-04' })
    const { codes } = await (await api.GET(ctx('GET'))).json()
    expect(codes.map((c) => c.code).sort()).toEqual(['EV3', 'TODOS'])
  })

  it('validador no puede gestionar códigos', async () => {
    setup('validator')
    expect((await api.GET(ctx('GET'))).status).toBe(403)
  })

  it('POST con evento de otra organización: 404', async () => {
    setup()
    const res = await api.POST(ctx('POST', { code: 'NUEVO', kind: 'percent', value: 10, eventId: 9 }))
    expect(res.status).toBe(404)
  })

  it('POST crea el código en la organización de la sesión (aunque el cliente mande otra)', async () => {
    setup()
    const res = await api.POST(ctx('POST', { code: 'nuevo', kind: 'fixed', value: 5000, organization_id: 8 }))
    expect(res.status).toBe(201)
    const created = db.tables.aitickets_discount_codes.find((c) => c.code === 'NUEVO')
    expect(created).toMatchObject({ organization_id: 7, kind: 'fixed', value: 5000, event_id: null, created_by: 1, active: true })
  })

  it('PATCH no toca códigos de otra organización ni permite cambiar el valor', async () => {
    setup()
    const foreign = await api.PATCH(ctx('PATCH', { id: '00000000-0000-0000-0000-000000000003', active: false }))
    expect(foreign.status).toBe(404)
    expect(db.tables.aitickets_discount_codes.find((c) => c.code === 'AJENO').active).toBe(true)
    const value = await api.PATCH(ctx('PATCH', { id: '00000000-0000-0000-0000-000000000002', value: 1 }))
    expect(value.status).toBe(400)
    const ok = await api.PATCH(ctx('PATCH', { id: '00000000-0000-0000-0000-000000000002', active: false }))
    expect(ok.status).toBe(200)
    expect((await ok.json()).code).toMatchObject({ code: 'EV3', active: false })
  })

  describe('miembro con acceso limitado a ciertos eventos (aitickets_event_staff)', () => {
    const limited = () => {
      setup('editor')
      db.tables.events.push({ id: 4, name: 'Otro mío', organization_id: 7 })
      db.tables.aitickets_discount_codes.push({ id: '00000000-0000-0000-0000-000000000005', organization_id: 7, event_id: 4, code: 'EV4', kind: 'fixed', value: 1000, active: true, created_at: '2026-10-05' })
      db.tables.aitickets_event_staff = [{ user_id: 1, event_id: 3 }]
    }

    it('GET sin evento: los de sus eventos y los de toda la organización, no los de otros eventos', async () => {
      limited()
      const { codes } = await (await api.GET(ctx('GET'))).json()
      expect(codes.map((c) => c.code).sort()).toEqual(['EV3', 'TODOS'])
      expect((await api.GET(ctx('GET', null, '?event_id=4'))).status).toBe(404)
    })

    it('POST: solo para sus eventos; nunca un código de toda la organización', async () => {
      limited()
      expect((await api.POST(ctx('POST', { code: 'GLOBAL', kind: 'percent', value: 10 }))).status).toBe(403)
      expect((await api.POST(ctx('POST', { code: 'OTRO', kind: 'percent', value: 10, eventId: 4 }))).status).toBe(404)
      expect((await api.POST(ctx('POST', { code: 'PROPIO', kind: 'percent', value: 10, eventId: 3 }))).status).toBe(201)
      expect(db.tables.aitickets_discount_codes.map((c) => c.code)).not.toContain('GLOBAL')
    })

    it('PATCH: no cambia códigos de otros eventos ni los de toda la organización', async () => {
      limited()
      expect((await api.PATCH(ctx('PATCH', { id: '00000000-0000-0000-0000-000000000005', active: false }))).status).toBe(404)
      expect((await api.PATCH(ctx('PATCH', { id: '00000000-0000-0000-0000-000000000001', active: false }))).status).toBe(403)
      expect(db.tables.aitickets_discount_codes.filter((c) => c.active === false)).toEqual([])
      expect((await api.PATCH(ctx('PATCH', { id: '00000000-0000-0000-0000-000000000002', active: false }))).status).toBe(200)
    })
  })
})
