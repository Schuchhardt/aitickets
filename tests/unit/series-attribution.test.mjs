// Ventas atribuidas a la difusión automática (historias/posts con DM): el ref del link del DM viaja desde la página del
// evento (src/lib/attribution.js) en el body de /api/purchase-ticket, queda en event_orders.ref y attributedSales
// (src/lib/socialSeries.ts) lo cuenta para la serie. El tramo del navegador está en tests/e2e/series-attribution.spec.ts.
import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db

vi.mock('../../netlify/lib/rate-limit.mjs', () => ({ rateLimit: async () => ({ allowed: true, source: 'db' }) }))
vi.mock('../../netlify/lib/turnstile.mjs', () => ({ verifyTurnstile: async () => ({ success: true }), isTurnstileEnabled: () => false, turnstileSiteKey: () => null }))
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
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))

function withOr(fake) {
  return { ...fake, from(table) { const b = fake.from(table); b.or = () => b; return b } }
}

const { default: handler } = await import('../../netlify/functions/purchase-tickets/index.mjs')
const { attributedSales, DM_REFS } = await import('../../src/lib/socialSeries.ts')

function setup() {
  let seq = 0
  db = createFakeSupabase({
    tables: {
      events: [{ id: 134, name: 'Concierto de Primavera', slug: 'concierto-de-primavera-2296', status: 'published', end_date: null, organization_id: 45 }],
      event_tickets: [{ id: 80, event_id: 134, event_date_id: null, ticket_name: 'General', price: 5000, max_quantity: null, is_gift: false, status: 'available', init_date: null, end_date: null, total_quantity: null }],
      attendees: [],
      event_orders: [],
      event_attendees: [],
    },
    rpc: {
      aitickets_reserve_order: ({ p_order }, state) => {
        const row = { id: `order-${++seq}`, status: 'pending', event_id: 134, created_at: new Date().toISOString(), ...p_order }
        state.event_orders.push(row)
        return row.id
      },
    },
  })
}

const purchase = (extra) => handler(new Request('https://aitickets.cl/api/purchase-ticket', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-nf-client-connection-ip': '203.0.113.7' },
  body: JSON.stringify({ eventId: 134, buyer: { fullName: 'Ana Pérez', email: 'ana@example.com' }, tickets: [{ id: 80, quantity: 2 }], termsAccepted: true, ...extra }),
}))

// Flow confirma el pago: lo que importa aquí es que la orden pagada conserva el ref
const markPaid = () => db.tables.event_orders.forEach((o) => { o.status = 'paid'; o.ticket_details = [{ name: 'General', quantity: o.ticket_qty || 2, price: 5000 }] })

describe('venta por el DM de una historia → atribuida a la serie', () => {
  it('ref=ig-story-dm del body queda en la orden y attributedSales la cuenta', async () => {
    setup()
    const res = await purchase({ ref: DM_REFS.story, utm: { source: 'ig' } })
    expect(res.status).toBe(200)
    expect(db.tables.event_orders[0]).toMatchObject({ ref: 'ig-story-dm', utm_source: 'ig' })
    markPaid()
    const sales = await attributedSales(db, [134])
    expect(sales).toMatchObject({ orders: 1, by_ref: { 'ig-story-dm': expect.any(Number) } })
  })

  it('sin ref (llegó directo o por otro canal) no se atribuye a la serie', async () => {
    setup()
    await purchase({ ref: undefined, utm: { source: 'whatsapp' } })
    markPaid()
    expect((await attributedSales(db, [134])).orders).toBe(0)
  })

  it('un ref con caracteres raros se limpia y no se atribuye por error', async () => {
    setup()
    await purchase({ ref: 'ig-story-dm<script>' })
    expect(db.tables.event_orders[0].ref).toBe('ig-story-dmscript')
    markPaid()
    expect((await attributedSales(db, [134])).orders).toBe(0)
  })
})
