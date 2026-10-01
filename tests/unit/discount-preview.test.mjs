// POST /api/discount-code: vista previa del código en el checkout (subtotal calculado en el servidor, sin reservar).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { computeDiscountedTotals } from '../../netlify/lib/discounts.mjs'

let db
const rateLimitMock = vi.fn(async () => ({ allowed: true, source: 'db' }))

vi.mock('../../netlify/lib/rate-limit.mjs', () => ({ rateLimit: (...a) => rateLimitMock(...a), hashRateLimitKey: (k) => `h:${k}` }))
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e) }))

const { POST } = await import('../../src/pages/api/discount-code.ts')

const CODE = { id: 'c1', organization_id: 7, event_id: 3, code: 'PROMO10', kind: 'fixed', value: 3000, max_uses: 5, per_buyer_limit: null, starts_at: null, ends_at: null, active: true }

function setup(code = CODE, uses = 0, rateRows = []) {
  db = createFakeSupabase({
    tables: {
      aitickets_rate_limits: rateRows,
      events: [{ id: 3, slug: 'fiesta', status: 'published', organization_id: 7 }, { id: 4, slug: 'otra', status: 'published', organization_id: 7 }],
      event_tickets: [
        { id: 30, event_id: 3, ticket_name: 'General', price: 10000, is_gift: false, status: 'available', init_date: null, end_date: null },
        { id: 31, event_id: 3, ticket_name: 'Retirada', price: 10000, is_gift: false, status: 'unavailable', init_date: null, end_date: null },
        { id: 40, event_id: 4, ticket_name: 'General', price: 8000, is_gift: false, status: 'available', init_date: null, end_date: null },
      ],
      aitickets_discount_codes: [code],
    },
    rpc: { aitickets_discount_code_usage: () => [{ uses, buyer_uses: 0 }] },
  })
}

const call = (body) => POST({ request: new Request('https://example.test/api/discount-code', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-nf-client-connection-ip': '198.51.100.7' },
  body: JSON.stringify(body),
}) })

beforeEach(() => rateLimitMock.mockClear())

describe('/api/discount-code', () => {
  it('devuelve el descuento y los totales calculados con precios de la BD (ignora precios del cliente)', async () => {
    setup()
    const res = await call({ eventId: 3, code: 'promo10', tickets: [{ id: 30, quantity: 2, price: 1 }] })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      valid: true, code: 'PROMO10', kind: 'fixed', value: 3000, label: '$3.000',
      ...computeDiscountedTotals(20000, { kind: 'fixed', value: 3000 }),
    })
    expect(rateLimitMock.mock.calls.map((c) => c[0])).toEqual(['discount:ip', 'discount:ip-event'])
  })

  it('código de un evento no aplica a otro evento', async () => {
    setup()
    const res = await call({ eventId: 4, code: 'PROMO10', tickets: [{ id: 40, quantity: 1 }] })
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ valid: false, reason: 'not_found' })
  })

  it('agotado, inactivo o expirado responden igual que un código inexistente (no confirman el acierto)', async () => {
    const responses = []
    for (const [code, uses] of [[CODE, 5], [{ ...CODE, active: false }, 0], [{ ...CODE, ends_at: '2020-01-01T00:00:00Z' }, 0]]) {
      setup(code, uses)
      const res = await call({ eventId: 3, code: 'PROMO10', tickets: [{ id: 30, quantity: 1 }] })
      responses.push([res.status, await res.json()])
    }
    setup()
    const missing = await call({ eventId: 3, code: 'NOEXISTE', tickets: [{ id: 30, quantity: 1 }] })
    const missingBody = await missing.json()
    expect(missing.status).toBe(404)
    for (const [status, body] of responses) {
      expect(status).toBe(404)
      expect(body).toEqual(missingBody)
    }
  })

  it('cada fallo suma al contador global del evento y de la organización', async () => {
    setup()
    await call({ eventId: 3, code: 'NOEXISTE', tickets: [{ id: 30, quantity: 1 }] })
    expect(rateLimitMock.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ['discount:ip', '198.51.100.7'],
      ['discount:ip-event', '198.51.100.7|3'],
      ['discount:event-fail', 'event:3'],
      ['discount:org-fail', 'org:7'],
    ])
  })

  it('con el tope global de fallos del evento alcanzado (desde cualquier IP) → 429, incluso con un código válido', async () => {
    const windowStart = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString()
    setup(CODE, 0, [{ bucket: 'discount:event-fail', key_hash: 'h:event:3', window_start: windowStart, count: 300 }])
    const res = await call({ eventId: 3, code: 'PROMO10', tickets: [{ id: 30, quantity: 1 }] })
    expect(res.status).toBe(429)
    expect(db.calls.some((c) => c.table === 'aitickets_discount_codes')).toBe(false)
  })

  it('no recibe ni revisa el email del comprador', async () => {
    setup()
    const res = await call({ eventId: 3, code: 'PROMO10', email: 'ana@mail.cl', tickets: [{ id: 30, quantity: 1 }] })
    expect(res.status).toBe(200)
    const rpc = db.calls.find((c) => c.op === 'rpc' && c.values.name === 'aitickets_discount_code_usage')
    expect(rpc.values.args.p_email ?? null).toBeNull()
  })

  it('entrada que no está a la venta', async () => {
    setup()
    const res = await call({ eventId: 3, code: 'PROMO10', tickets: [{ id: 31, quantity: 1 }] })
    expect(res.status).toBe(409)
  })

  it('rate limit', async () => {
    setup()
    rateLimitMock.mockResolvedValueOnce({ allowed: false, source: 'db' })
    const res = await call({ eventId: 3, code: 'PROMO10', tickets: [{ id: 30, quantity: 1 }] })
    expect(res.status).toBe(429)
  })

  it('formato inválido sin consultar la BD', async () => {
    setup()
    const res = await call({ eventId: 3, code: '¡x!', tickets: [{ id: 30, quantity: 1 }] })
    expect(res.status).toBe(400)
    expect(db.calls).toHaveLength(0)
  })
})
