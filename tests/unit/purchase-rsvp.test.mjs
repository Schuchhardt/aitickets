// Registro gratis del rediseño: un solo campo "Nombre y apellido" (buyer.fullName) que el servidor divide, y
// 409 ALREADY_REGISTERED si el email ya tiene una inscripción gratis pagada para el evento (sin duplicar).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
const sendEmailMock = vi.fn(async () => ({ ok: true, status: 'sent' }))

vi.mock('../../netlify/lib/rate-limit.mjs', () => ({ rateLimit: async () => ({ allowed: true, source: 'db' }) }))
vi.mock('../../netlify/lib/turnstile.mjs', () => ({
  verifyTurnstile: async () => ({ success: true }),
  isTurnstileEnabled: () => false,
  turnstileSiteKey: () => null,
}))
vi.mock('../../netlify/lib/tickets-email.mjs', () => ({ sendOrderTicketsEmail: (...a) => sendEmailMock(...a) }))
vi.mock('../../netlify/lib/payments/index.mjs', () => ({
  enabledProviders: () => ['flow'],
  defaultProvider: () => 'flow',
  holdMinutesFor: () => 15,
  createCheckout: async () => ({ redirectUrl: 'https://flow.test/pay', externalId: 'tok' }),
}))
vi.mock('../../netlify/lib/supabase.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getSupabaseAdmin: () => withOr(db) }
})

function withOr(fake) {
  return {
    ...fake,
    from(table) {
      const b = fake.from(table)
      b.or = () => b
      return b
    },
  }
}

const { default: handler } = await import('../../netlify/functions/purchase-tickets/index.mjs')

function setup({ orders = [], totalQuantity = null } = {}) {
  db = createFakeSupabase({
    tables: {
      events: [{ id: 5, name: 'Noche de Vinilos', slug: 'vinilos', status: 'published', end_date: null, organization_id: 7 }],
      event_tickets: [{ id: 50, event_id: 5, event_date_id: null, ticket_name: 'General', price: 0, max_quantity: 4, is_gift: false, status: 'available', init_date: null, end_date: null, total_quantity: totalQuantity }],
      attendees: [],
      event_orders: orders,
      event_attendees: [],
    },
    rpc: {
      aitickets_reserve_order: ({ p_order }, state) => {
        const row = { id: `order-${state.event_orders.length + 1}`, status: 'pending', event_id: 5, ...p_order }
        state.event_orders.push(row)
        return row.id
      },
    },
  })
}

const request = (buyer, extra = {}) => new Request('https://example.test/api/purchase-ticket', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-nf-client-connection-ip': '203.0.113.9' },
  body: JSON.stringify({ eventId: 5, buyer, tickets: [{ id: 50, quantity: 1 }], termsAccepted: true, ...extra }),
})

beforeEach(() => sendEmailMock.mockClear())

describe('purchase-tickets: registro gratis del rediseño', () => {
  it('divide "Nombre y apellido" en el servidor (apellido vacío permitido)', async () => {
    setup()
    const res = await handler(request({ fullName: '  Sebastián  Pérez Soto ', email: 'Seba@Example.com' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ provider: 'free', redirectUrl: '/order/order-1' })
    const order = db.tables.event_orders[0]
    expect(order).toMatchObject({ status: 'paid', buyer_first_name: 'Sebastián', buyer_last_name: 'Pérez Soto', buyer_email: 'seba@example.com', total_payment: 0 })
    expect(sendEmailMock).toHaveBeenCalledWith('order-1')

    setup()
    const solo = await handler(request({ fullName: 'Seba', email: 'seba@example.com' }))
    expect(solo.status).toBe(200)
    expect(db.tables.event_orders[0]).toMatchObject({ buyer_first_name: 'Seba', buyer_last_name: '' })
  })

  it('nombre de menos de 2 caracteres: 400', async () => {
    setup()
    const res = await handler(request({ fullName: 'S', email: 'seba@example.com' }))
    expect(res.status).toBe(400)
    expect((await res.json()).message).toBe('Escribe tu nombre.')
  })

  it('email ya inscrito: 409 ALREADY_REGISTERED sin crear otra orden', async () => {
    setup({ orders: [{ id: 'old', event_id: 5, status: 'paid', total_payment: 0, buyer_email: 'seba@example.com' }] })
    const res = await handler(request({ fullName: 'Seba Pérez', email: 'seba@example.com' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'ALREADY_REGISTERED' })
    expect(db.tables.event_orders).toHaveLength(1)
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('clientes antiguos (firstName/lastName) siguen funcionando', async () => {
    setup()
    const res = await handler(request({ firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.com' }))
    expect(res.status).toBe(200)
    expect(db.tables.event_orders[0]).toMatchObject({ buyer_first_name: 'Ana', buyer_last_name: 'Pérez' })
  })

  it('cupos agotados: 409 con code SOLD_OUT (la página pasa a lista de espera)', async () => {
    setup({ totalQuantity: 0 })
    const res = await handler(request({ fullName: 'Seba Pérez', email: 'seba@example.com' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'SOLD_OUT' })
  })
})
