// Compra con código de descuento: el servidor valida el código, descuenta el subtotal, calcula el cargo sobre el
// monto descontado y reserva con aitickets_reserve_order_v2 (que aplica el límite de usos con el código bloqueado).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { computeBuyerTotal } from '../../netlify/lib/fees.mjs'

let db
const createCheckoutMock = vi.fn(async () => ({ redirectUrl: 'https://flow.test/pay', externalId: 'tok' }))
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
  createCheckout: (...a) => createCheckoutMock(...a),
}))
vi.mock('../../netlify/lib/supabase.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getSupabaseAdmin: () => withOr(db) }
})

// countLivePendingOrders usa .or(): el fake no lo soporta, se ignora el filtro (no hay órdenes pendientes previas).
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

const CODE = { id: '11111111-1111-1111-1111-111111111111', organization_id: 7, event_id: null, code: 'PROMO25', kind: 'percent', value: 25, max_uses: 10, per_buyer_limit: null, starts_at: null, ends_at: null, active: true }

function setup({ code = CODE, reserveV2 } = {}) {
  const reserved = []
  db = createFakeSupabase({
    tables: {
      events: [{ id: 3, name: 'Fiesta', slug: 'fiesta', status: 'published', end_date: null, organization_id: 7 }],
      event_tickets: [{ id: 30, event_id: 3, event_date_id: null, ticket_name: 'General', price: 10000, max_quantity: 10, is_gift: false, status: 'available', init_date: null, end_date: null, total_quantity: null }],
      attendees: [],
      event_orders: [],
      event_attendees: [],
      aitickets_discount_codes: code ? [code] : [],
    },
    rpc: {
      aitickets_discount_code_usage: () => [{ uses: 0, buyer_uses: 0 }],
      aitickets_reserve_order: ({ p_order }, state) => {
        const row = { id: 'order-plain', status: 'pending', event_id: 3, ...p_order }
        state.event_orders.push(row)
        reserved.push({ fn: 'v1', p_order })
        return row.id
      },
      aitickets_reserve_order_v2: reserveV2 || (({ p_order, p_discount_code_id, p_discount_amount }, state) => {
        const row = { id: 'order-disc', status: 'pending', event_id: 3, ...p_order, discount_code_id: p_discount_code_id, discount_amount: p_discount_amount, discount_code: 'PROMO25' }
        state.event_orders.push(row)
        reserved.push({ fn: 'v2', p_order, p_discount_code_id, p_discount_amount })
        return row.id
      }),
    },
  })
  return reserved
}

const request = (extra = {}) => new Request('https://example.test/api/purchase-ticket', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-nf-client-connection-ip': '203.0.113.5' },
  body: JSON.stringify({
    eventId: 3,
    buyer: { firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.com' },
    tickets: [{ id: 30, quantity: 2 }],
    termsAccepted: true,
    ...extra,
  }),
})

beforeEach(() => {
  createCheckoutMock.mockClear()
  sendEmailMock.mockClear()
})

describe('purchase-tickets con código de descuento', () => {
  it('descuenta el subtotal, calcula el cargo sobre el monto descontado y cobra ese total en Flow', async () => {
    const reserved = setup()
    const res = await handler(request({ discountCode: ' promo25 ' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.paymentLink).toBe('https://flow.test/pay')

    expect(reserved).toHaveLength(1)
    const [r] = reserved
    expect(r.fn).toBe('v2')
    expect(r.p_discount_code_id).toBe(CODE.id)
    expect(r.p_discount_amount).toBe(5000) // 25% de 20.000
    const fee = computeBuyerTotal(15000)
    expect(r.p_order).toMatchObject({ amount: 15000, ticket_fee: fee.feeNet, service_fee_tax: fee.feeIva })
    // Las líneas guardan el precio de lista
    expect(r.p_order.ticket_details[0]).toMatchObject({ id: 30, price: 10000, quantity: 2, total: 20000 })

    const args = createCheckoutMock.mock.calls[0][1]
    expect(args.total).toBe(fee.total)
    expect(args.subtotal).toBe(15000)
  })

  it('sin código usa la reserva de siempre', async () => {
    const reserved = setup()
    const res = await handler(request())
    expect(res.status).toBe(200)
    expect(reserved[0].fn).toBe('v1')
    expect(reserved[0].p_order.amount).toBe(20000)
  })

  it('100% de descuento => orden gratis: sin Flow, pagada por $0 con entradas y correo', async () => {
    setup({ code: { ...CODE, kind: 'percent', value: 100 } })
    const res = await handler(request({ discountCode: 'PROMO25' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ orderId: 'order-disc', provider: 'free', redirectUrl: '/order/order-disc' })
    expect(createCheckoutMock).not.toHaveBeenCalled()
    const order = db.tables.event_orders.find((o) => o.id === 'order-disc')
    expect(order).toMatchObject({ status: 'paid', amount: 0, ticket_fee: 0, service_fee_tax: 0, total_payment: 0, discount_amount: 20000 })
    expect(db.tables.event_attendees).toHaveLength(2)
    expect(sendEmailMock).toHaveBeenCalledWith('order-disc')
  })

  it('código inexistente u otra organización: 404 con discountError, sin reservar', async () => {
    const reserved = setup({ code: { ...CODE, organization_id: 99 } })
    const res = await handler(request({ discountCode: 'PROMO25' }))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ discountError: true, reason: 'not_found' })
    expect(reserved).toHaveLength(0)
  })

  it('formato inválido: 400 antes de tocar la BD', async () => {
    setup()
    const res = await handler(request({ discountCode: 'no!' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ discountError: true, reason: 'invalid_format' })
  })

  it('el último uso lo toma otra compra durante la reserva: 409 agotado', async () => {
    setup({ reserveV2: () => { throw Object.assign(new Error('DISCOUNT_EXHAUSTED'), { code: 'P0001' }) } })
    const res = await handler(request({ discountCode: 'PROMO25' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ discountError: true, reason: 'exhausted' })
    expect(createCheckoutMock).not.toHaveBeenCalled()
  })

  it('límite por comprador (por email) revisado antes de reservar', async () => {
    setup({ code: { ...CODE, per_buyer_limit: 1 } })
    const original = db.rpc
    db.rpc = async (name, args) => (name === 'aitickets_discount_code_usage'
      ? { data: [{ uses: 1, buyer_uses: args.p_email === 'ana@example.com' ? 1 : 0 }], error: null }
      : original(name, args))
    const res = await handler(request({ discountCode: 'PROMO25' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ reason: 'buyer_limit' })
  })

  it('base sin aitickets_reserve_order_v2: 503 (no se vende sin aplicar el límite)', async () => {
    setup()
    const original = db.rpc
    db.rpc = async (name, args) => (name === 'aitickets_reserve_order_v2'
      ? { data: null, error: { code: 'PGRST202', message: 'no existe' } }
      : original(name, args))
    const res = await handler(request({ discountCode: 'PROMO25' }))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ reason: 'unavailable' })
  })
})
