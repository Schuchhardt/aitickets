// /api/orders/resend: un miembro con acceso limitado a ciertos eventos (aitickets_event_staff) no reenvía
// entradas de órdenes de otros eventos de su organización.
import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
let session
const sendTicketsEmail = vi.fn(async () => ({ ok: true, data: {} }))

vi.mock('../../src/lib/auth-helpers', () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: db.order }) }
      return chain
    },
  }),
}))
vi.mock('../../src/lib/supabaseServer', async () => {
  const { canAccessEventByStaff } = await import('../../netlify/lib/event-staff.mjs')
  return {
    getSessionContext: async () => session,
    hasRole: (u, roles) => roles.includes(u?.role),
    jsonResponse: (body, status = 200) => new Response(JSON.stringify(body), { status }),
    getOwnedEvent: async (eventId, _orgId, _cols, userId) =>
      (await canAccessEventByStaff(db.staff, userId, eventId)) ? { id: eventId } : null,
  }
})
vi.mock('../../src/pages/api/_lib/server-utils', () => ({ sendTicketsEmail: (...a) => sendTicketsEmail(...a) }))

const { POST } = await import('../../src/pages/api/orders/resend.ts')
const call = () => POST({ request: new Request('https://example.test/api/orders/resend', { method: 'POST', body: JSON.stringify({ orderId: 'o1' }) }) })

function setup(staffRows) {
  session = { dbUser: { id: 5, organization_id: 7, role: 'validator' } }
  db = { order: { id: 'o1', status: 'paid', events: { id: 3, organization_id: 7 } }, staff: createFakeSupabase({ tables: { aitickets_event_staff: staffRows } }) }
  sendTicketsEmail.mockClear()
}

describe('/api/orders/resend', () => {
  it('con acceso limitado a otro evento: 404 y no se envía nada', async () => {
    setup([{ user_id: 5, event_id: 99 }])
    expect((await call()).status).toBe(404)
    expect(sendTicketsEmail).not.toHaveBeenCalled()
  })

  it('con acceso al evento (o sin restricción): reenvía', async () => {
    setup([{ user_id: 5, event_id: 3 }])
    expect((await call()).status).toBe(200)
    expect(sendTicketsEmail).toHaveBeenCalledTimes(1)
    setup([])
    expect((await call()).status).toBe(200)
    expect(sendTicketsEmail).toHaveBeenCalledTimes(1)
  })
})
