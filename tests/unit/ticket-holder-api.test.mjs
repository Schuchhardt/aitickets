// POST /api/tickets/holder: la persona de un QR completa su nombre y sus respuestas por persona desde /ticket/<id>.
// La llave es el id de la entrada (como la página): solo cambia holder_name y registration_answers de esa entrada,
// con la orden pagada, la entrada vigente y el evento sin terminar.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
const limits = vi.hoisted(() => ({ allowed: true, calls: [] }))

vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db }))
vi.mock('../../src/lib/supabaseServer', () => ({
  jsonResponse: (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))
vi.mock('../../src/lib/sites', () => ({ clientIpFrom: () => '203.0.113.7' }))
vi.mock('../../netlify/lib/rate-limit.mjs', () => ({
  rateLimit: async (bucket, key) => {
    limits.calls.push([bucket, key])
    return { allowed: limits.allowed, source: 'memory' }
  },
}))

const { POST } = await import('../../src/pages/api/tickets/holder.ts')

const GUEST = '11111111-1111-4111-8111-111111111111'
const BUYER = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'
const ORDER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const FIELDS = {
  attendee_names: 'required',
  holders: 'invite',
  questions: [
    { id: 'talla', label: 'Talla', type: 'choice', options: ['S', 'M'], required: true, per: 'attendee' },
    { id: 'como', label: '¿Cómo supiste?', type: 'text', required: true },
  ],
}

const post = (body) => ({
  request: new Request('https://aitickets.test/api/tickets/holder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
})

function setup({ fields = FIELDS, endDate = '2099-01-01T03:00:00Z', orderStatus = 'paid', guestStatus = 'active' } = {}) {
  db = createFakeSupabase({
    tables: {
      events: [{ id: 5, checkout_fields: fields, start_date: '2098-12-31T23:00:00Z', end_date: endDate }],
      event_orders: [{ id: ORDER, event_id: 5, status: orderStatus, buyer_email: 'bea@x.cl', registration_answers: [{ id: 'como', question: '¿Cómo supiste?', answer: 'IG' }] }],
      event_attendees: [
        { id: BUYER, event_id: 5, event_order_id: ORDER, status: 'active', qr_code: 'qr1', holder_name: 'Bea Soto', holder_email: 'bea@x.cl', registration_answers: [{ id: 'talla', question: 'Talla', answer: 'M' }] },
        { id: GUEST, event_id: 5, event_order_id: ORDER, status: guestStatus, qr_code: 'qr2', holder_name: null, holder_email: 'ana@x.cl', registration_answers: null },
      ],
    },
  })
}

beforeEach(() => {
  limits.allowed = true
  limits.calls = []
  setup()
})

describe('POST /api/tickets/holder', () => {
  it('el invitado completa nombre y respuestas; solo cambia su entrada', async () => {
    const res = await POST(post({ ticketId: GUEST, name: ' Ana  Rojas ', answers: { talla: 'S', como: 'nada' }, holder_email: 'otro@x.cl', qr_code: 'hack', status: 'validated' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, name: 'Ana Rojas', answers: [{ id: 'talla', question: 'Talla', answer: 'S' }], missing: [] })
    const guest = db.tables.event_attendees.find((a) => a.id === GUEST)
    expect(guest).toMatchObject({ holder_name: 'Ana Rojas', holder_email: 'ana@x.cl', qr_code: 'qr2', status: 'active', registration_answers: [{ id: 'talla', question: 'Talla', answer: 'S' }] })
    // La otra entrada y la orden no se tocan
    expect(db.tables.event_attendees.find((a) => a.id === BUYER).registration_answers).toEqual([{ id: 'talla', question: 'Talla', answer: 'M' }])
    expect(db.tables.event_orders[0].registration_answers).toEqual([{ id: 'como', question: '¿Cómo supiste?', answer: 'IG' }])
    const updates = db.calls.filter((c) => c.op === 'update')
    expect(updates).toHaveLength(1)
    expect(Object.keys(updates[0].values).sort()).toEqual(['holder_name', 'registration_answers'])
    // Límite por IP y por entrada
    expect(limits.calls).toEqual([['ticket-holder:ip', '203.0.113.7'], ['ticket-holder:ticket', GUEST]])
  })

  it('valida con las reglas del checkout', async () => {
    let res = await POST(post({ ticketId: GUEST, answers: { talla: 'S' } }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ message: 'Escribe tu nombre y apellido.', field: 'name' })
    res = await POST(post({ ticketId: GUEST, name: 'Ana', answers: {} }))
    expect(await res.json()).toEqual({ message: 'Responde "Talla".', field: 'answers' })
    res = await POST(post({ ticketId: GUEST, name: 'Ana', answers: { talla: 'XL' } }))
    expect(res.status).toBe(400)
    expect(db.calls.filter((c) => c.op === 'update')).toHaveLength(0)
  })

  it('id inválido o inexistente', async () => {
    expect((await POST(post({ ticketId: 'no-uuid', name: 'Ana' }))).status).toBe(400)
    expect((await POST(post({ ticketId: OTHER, name: 'Ana' }))).status).toBe(404)
  })

  it('evento terminado, entrada anulada u orden sin pagar: no se cambia nada', async () => {
    setup({ endDate: '2020-01-01T00:00:00Z' })
    let res = await POST(post({ ticketId: GUEST, name: 'Ana', answers: { talla: 'S' } }))
    expect(res.status).toBe(409)
    expect((await res.json()).message).toMatch(/ya terminó/)

    setup({ guestStatus: 'cancelled' })
    expect((await POST(post({ ticketId: GUEST, name: 'Ana', answers: { talla: 'S' } }))).status).toBe(409)

    setup({ orderStatus: 'refunded' })
    expect((await POST(post({ ticketId: GUEST, name: 'Ana', answers: { talla: 'S' } }))).status).toBe(409)

    setup({ fields: { company: true } })
    expect((await POST(post({ ticketId: GUEST, name: 'Ana' }))).status).toBe(409)
    expect(db.calls.filter((c) => c.op === 'update')).toHaveLength(0)
  })

  it('demasiados intentos: 429 sin tocar la base', async () => {
    limits.allowed = false
    const res = await POST(post({ ticketId: GUEST, name: 'Ana', answers: { talla: 'S' } }))
    expect(res.status).toBe(429)
    expect(db.calls).toHaveLength(0)
  })

  it('base sin la columna nueva: 503', async () => {
    db.failOn('event_attendees', 'select', { code: '42703', message: 'column event_attendees.registration_answers does not exist' })
    expect((await POST(post({ ticketId: GUEST, name: 'Ana', answers: { talla: 'S' } }))).status).toBe(503)
  })
})
