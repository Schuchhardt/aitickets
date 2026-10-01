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
  getOwnedEvent: async (eventId, orgId) => (db.tables.events || []).find((e) => String(e.id) === String(eventId) && e.organization_id === orgId) || null,
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
})
