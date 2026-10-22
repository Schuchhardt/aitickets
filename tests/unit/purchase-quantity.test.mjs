// Más de una entrada por compra: si el productor no configuró un máximo (max_quantity null o 0), se pueden comprar
// hasta 10 de cada tipo. La regla tiene que coincidir en el servidor de compra, en los datos de la página del
// evento y en el checkout del navegador; si no, la página ofrecería cantidades que la compra rechaza o al revés.
// El flujo en el navegador (desktop y mobile) está en tests/e2e/event-quantity.spec.ts.
import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { maxPerPurchase as serverMax, DEFAULT_MAX_PER_PURCHASE } from '../../netlify/lib/tickets.mjs'
import { maxPerPurchase as checkoutMax } from '../../src/components/Reservation/pricing.js'
import { ticketMax } from '../../src/components/event/eventView.js'
import { toPublicTicket } from '../../src/lib/eventPage'

let db
const reservedLines = []

vi.mock('../../netlify/lib/rate-limit.mjs', () => ({ rateLimit: async () => ({ allowed: true, source: 'db' }) }))
vi.mock('../../netlify/lib/turnstile.mjs', () => ({
  verifyTurnstile: async () => ({ success: true }),
  isTurnstileEnabled: () => false,
  turnstileSiteKey: () => null,
}))
vi.mock('../../netlify/lib/tickets-email.mjs', () => ({ sendOrderTicketsEmail: async () => ({ ok: true, status: 'sent' }) }))
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

const NOT_CONFIGURED = [null, undefined, 0, '']

describe('máximo por compra sin configurar', () => {
  it('el servidor, la página y el checkout permiten 10 por compra', () => {
    expect(DEFAULT_MAX_PER_PURCHASE).toBe(10)
    for (const max_quantity of NOT_CONFIGURED) {
      const row = { id: 1, ticket_name: 'General', price: 4000, max_quantity, total_quantity: null }
      expect(serverMax(row), `servidor con max_quantity=${max_quantity}`).toBe(10)
      expect(checkoutMax(row), `checkout con max_quantity=${max_quantity}`).toBe(10)
      const publicTicket = toPublicTicket(row, { remaining: null, feeAbsorbed: false })
      expect(publicTicket.max_quantity, `página con max_quantity=${max_quantity}`).toBe(10)
      expect(ticketMax(publicTicket), `stepper con max_quantity=${max_quantity}`).toBe(10)
    }
  })

  it('un máximo configurado se respeta en todas partes', () => {
    for (const max_quantity of [1, 3, 25]) {
      const row = { id: 1, ticket_name: 'General', price: 4000, max_quantity, total_quantity: null }
      expect(serverMax(row)).toBe(max_quantity)
      expect(checkoutMax(row)).toBe(max_quantity)
      expect(ticketMax(toPublicTicket(row, { remaining: null, feeAbsorbed: false }))).toBe(max_quantity)
    }
  })

  it('el stock que queda limita la cantidad (nunca más de lo disponible)', () => {
    const row = { id: 1, ticket_name: 'General', price: 4000, max_quantity: null, total_quantity: 300 }
    expect(ticketMax(toPublicTicket(row, { remaining: 4, feeAbsorbed: false }))).toBe(4)
    expect(ticketMax(toPublicTicket(row, { remaining: 250, feeAbsorbed: false }))).toBe(10)
  })
})

function setup({ maxQuantity = null } = {}) {
  reservedLines.length = 0
  db = createFakeSupabase({
    tables: {
      events: [{ id: 8, name: 'Concierto', slug: 'concierto', status: 'published', end_date: null, organization_id: 7 }],
      event_tickets: [{ id: 80, event_id: 8, event_date_id: null, ticket_name: 'General', price: 4000, max_quantity: maxQuantity, is_gift: false, status: 'available', init_date: null, end_date: null, total_quantity: null }],
      attendees: [],
      event_orders: [],
      event_attendees: [],
    },
    rpc: {
      aitickets_reserve_order: ({ p_order, p_lines }, state) => {
        const row = { id: 'order-1', status: 'pending', event_id: 8, ...p_order }
        state.event_orders.push(row)
        reservedLines.push(...p_lines)
        return row.id
      },
    },
  })
}

const purchase = (quantity) => handler(new Request('https://example.test/api/purchase-ticket', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-nf-client-connection-ip': '203.0.113.7' },
  body: JSON.stringify({
    eventId: 8,
    buyer: { fullName: 'Ana Pérez', email: 'ana@example.com' },
    tickets: [{ id: 80, quantity }],
    termsAccepted: true,
  }),
}))

describe('purchase-tickets: cantidad por compra', () => {
  it('sin máximo configurado acepta varias entradas del mismo tipo', async () => {
    for (const quantity of [2, 3, 10]) {
      setup()
      const res = await purchase(quantity)
      expect(res.status, `compra de ${quantity}`).toBe(200)
      expect(reservedLines).toEqual([{ id: 80, quantity }])
    }
  })

  it('sin máximo configurado rechaza más de 10', async () => {
    setup()
    const res = await purchase(11)
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/como máximo 10 entrada/)
    expect(reservedLines).toEqual([])
  })

  it('con máximo configurado rechaza superarlo', async () => {
    setup({ maxQuantity: 2 })
    expect((await purchase(2)).status).toBe(200)
    setup({ maxQuantity: 2 })
    const res = await purchase(3)
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/como máximo 2 entrada/)
  })
})
