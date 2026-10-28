// Tandas encadenadas (event_tickets.opens_after_ticket_id): la siguiente se abre sola cuando la anterior se agota.
// La regla es una sola (netlify/lib/tickets.mjs) y la usan la compra, la lista de espera y los formularios.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { chainError, isStillSelling, waitingOnPrevious } from '../../netlify/lib/tickets.mjs'
import { buyableTickets } from '../../netlify/lib/waitlist.mjs'
import { validateFormTicketChain } from '../../src/pages/api/_lib/events'
import { chainOptions, pruneChain } from '../../src/components/events/ticketChain.js'

const NOW = new Date('2026-10-27T15:00:00Z')
const ticket = (id, over = {}) => ({
  id, event_id: 8, event_date_id: null, ticket_name: `Tanda ${id}`, price: 5000, max_quantity: null, is_gift: false,
  status: 'available', init_date: null, end_date: null, total_quantity: 100, ...over,
})

describe('regla de la tanda anterior', () => {
  it('la anterior sigue vendiéndose mientras tenga cupo, esté disponible y no haya cerrado', () => {
    expect(isStillSelling(ticket(1), 1, NOW)).toBe(true)
    expect(isStillSelling(ticket(1), 0, NOW)).toBe(false)
    expect(isStillSelling(ticket(1, { end_date: '2026-10-26T00:00:00Z' }), 50, NOW)).toBe(false)
    expect(isStillSelling(ticket(1, { status: 'unavailable' }), 50, NOW)).toBe(false)
    expect(isStillSelling(ticket(1, { total_quantity: null }), null, NOW)).toBe(true)
    // Venta que aún no abre: la siguiente también espera
    expect(isStillSelling(ticket(1, { init_date: '2026-11-01T00:00:00Z' }), 100, NOW)).toBe(true)
  })

  it('una cadena de tres abre de a una', () => {
    const tickets = [ticket(1), ticket(2), ticket(3)]
    const chain = new Map([[2, 1], [3, 2]])
    const waitingWith = (left) => [...waitingOnPrevious(tickets, chain, (t) => left[t.id], NOW).keys()]
    expect(waitingWith({ 1: 5, 2: 100, 3: 100 })).toEqual([2, 3])
    expect(waitingWith({ 1: 0, 2: 100, 3: 100 })).toEqual([3])
    expect(waitingWith({ 1: 0, 2: 0, 3: 100 })).toEqual([])
    // Si se cae una reserva de la primera, vuelve a venderse la más barata primero
    expect(waitingWith({ 1: 1, 2: 0, 3: 100 })).toEqual([2])
  })

  it('valida: misma entrada, cortesías, sin cupo ni cierre y círculos', () => {
    const tickets = [ticket(1), ticket(2), ticket(3, { total_quantity: null }), ticket(4, { is_gift: true })]
    expect(chainError(tickets, new Map(), 2, 1)).toBeNull()
    expect(chainError(tickets, new Map(), 2, null)).toBeNull()
    expect(chainError(tickets, new Map(), 1, 1)).toMatch(/sí misma/)
    expect(chainError(tickets, new Map(), 2, 4)).toMatch(/cortesías/)
    expect(chainError(tickets, new Map(), 2, 3)).toMatch(/nunca se agotaría/)
    expect(chainError(tickets, new Map(), 2, 99)).toMatch(/no es de este evento/)
    expect(chainError(tickets, new Map([[1, 2]]), 2, 1)).toMatch(/círculo/)
    // Sin cupo pero con fecha de cierre sí sirve
    expect(chainError([ticket(1), ticket(5, { total_quantity: null, end_date: '2026-11-01T00:00:00Z' })], new Map(), 1, 5)).toBeNull()
  })

  it('la lista de espera no cuenta una tanda que todavía espera', () => {
    const tickets = [ticket(1), ticket(2)]
    const chain = new Map([[2, 1]])
    expect(buyableTickets(tickets, [{ ticket_id: 1, sold: 100, pending: 0 }], NOW, chain).map((t) => t.id)).toEqual([2])
    expect(buyableTickets(tickets, [{ ticket_id: 1, sold: 60, pending: 0 }], NOW, chain).map((t) => t.id)).toEqual([1])
  })
})

describe('formularios del evento', () => {
  const form = (over = {}) => [
    { id: 11, name: 'Preventa 1', price: 5000, quantity: 100, opensAfterId: '' },
    { id: 1761600000000, name: 'Preventa 2', price: 7000, quantity: 100, opensAfterId: 11 },
    { id: 13, name: 'General', price: 9000, quantity: null, opensAfterId: '' },
    ...(over.extra || []),
  ]

  it('el servidor acepta ids temporales y rechaza una anterior sin cupo', () => {
    expect(() => validateFormTicketChain(form())).not.toThrow()
    expect(() => validateFormTicketChain([{ id: 1, name: 'A', price: 0, quantity: null }, { id: 2, name: 'B', price: 0, quantity: 5, opensAfterId: 1 }])).toThrow(/nunca se agotaría/)
    expect(() => validateFormTicketChain([{ id: 1, name: 'A', price: 0, quantity: 5, opensAfterId: 2 }, { id: 2, name: 'B', price: 0, quantity: 5, opensAfterId: 1 }])).toThrow(/círculo/)
  })

  it('el selector solo ofrece entradas con cupo que no formen un círculo', () => {
    const tickets = form()
    expect(chainOptions(tickets, tickets[0]).map((t) => t.id)).toEqual([])
    expect(chainOptions(tickets, tickets[1]).map((t) => t.id)).toEqual([11])
    expect(chainOptions(tickets, tickets[2]).map((t) => t.id)).toEqual([11, 1761600000000])
  })

  it('si la anterior se borra o queda sin cupo, la tanda vuelve a venderse desde ya', () => {
    const tickets = form()
    tickets[0].quantity = ''
    pruneChain(tickets)
    expect(tickets[1].opensAfterId).toBe('')
  })
})

// Compra: la regla se aplica en el servidor (purchase-tickets), no solo en la página
let db
let soldOfFirst
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
  return {
    ...actual,
    getSupabaseAdmin: () => ({
      ...db,
      from(table) {
        const b = db.from(table)
        b.or = () => b
        return b
      },
    }),
  }
})
const { default: handler } = await import('../../netlify/functions/purchase-tickets/index.mjs')

describe('purchase-tickets con tandas encadenadas', () => {
  beforeEach(() => {
    soldOfFirst = 0
    db = createFakeSupabase({
      tables: {
        events: [{ id: 8, name: 'Concierto', slug: 'concierto', status: 'published', end_date: null, organization_id: 7 }],
        event_tickets: [ticket(80, { total_quantity: 2 }), ticket(81, { opens_after_ticket_id: 80 })],
        attendees: [],
        event_orders: [],
        event_attendees: [],
      },
      rpc: {
        aitickets_ticket_availability: () => [{ ticket_id: 80, sold: soldOfFirst, pending: 0 }, { ticket_id: 81, sold: 0, pending: 0 }],
        aitickets_reserve_order: ({ p_order }, state) => {
          const row = { id: 'order-1', status: 'pending', event_id: 8, ...p_order }
          state.event_orders.push(row)
          return row.id
        },
      },
    })
  })

  const buy = (id) => handler(new Request('https://example.test/api/purchase-ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-nf-client-connection-ip': '203.0.113.7' },
    body: JSON.stringify({ eventId: 8, buyer: { fullName: 'Ana Pérez', email: 'ana@example.com' }, tickets: [{ id, quantity: 1 }], termsAccepted: true }),
  }))

  it('rechaza la siguiente mientras quede cupo en la anterior', async () => {
    soldOfFirst = 1
    const res = await buy(81)
    expect(res.status).toBe(409)
    expect((await res.json()).message).toBe('"Tanda 81" se abre cuando se agote "Tanda 80"')
  })

  it('la vende sola cuando la anterior se agota', async () => {
    soldOfFirst = 2
    expect((await buy(81)).status).toBe(200)
  })
})
