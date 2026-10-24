// Rutas públicas del asistente: muro (/api/orders/feed), mensaje a la productora (/api/orders/message) y link de
// acceso a "Mis entradas" (/api/buyer/access-link). Se autorizan con el link de una orden pagada con entradas vigentes.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
const mocks = vi.hoisted(() => ({ sendEmail: vi.fn(async () => ({ id: 'mail' })) }))

vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db }))
vi.mock('../../src/lib/supabaseServer', () => ({
  jsonResponse: (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))
vi.mock('../../src/lib/sites', () => ({ clientIpFrom: () => '203.0.113.7' }))
vi.mock('../../netlify/lib/rate-limit.mjs', () => ({ rateLimit: async () => ({ allowed: true, source: 'memory' }) }))
vi.mock('../../netlify/lib/mailer.mjs', async (importOriginal) => ({ ...(await importOriginal()), sendEmail: mocks.sendEmail }))

const feedApi = await import('../../src/pages/api/orders/feed.ts')
const messageApi = await import('../../src/pages/api/orders/message.ts')
const accessApi = await import('../../src/pages/api/buyer/access-link.ts')
const { verifyBuyerLink } = await import('../../netlify/lib/buyer-session.mjs')

const ORDER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const UNPAID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const post = (path, body) => ({
  request: new Request(`https://aitickets.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  url: new URL(`https://aitickets.test${path}`),
  locals: {},
})

beforeEach(() => {
  vi.stubEnv('BUYER_SESSION_SECRET', 'test-secret')
  mocks.sendEmail.mockClear()
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Prod SpA' }],
      users: [
        { id: 1, organization_id: 7, role: 'admin', email: 'dueno@prod.cl', active: true },
        { id: 2, organization_id: 7, role: 'validator', email: 'puerta@prod.cl', active: true },
        { id: 3, organization_id: 7, role: 'producer', email: 'ex@prod.cl', active: false },
      ],
      events: [{ id: 10, name: 'Show', slug: 'show', organization_id: 7 }],
      attendees: [{ id: 1, first_name: 'Ana', last_name: 'Rojas', email: 'ana@x.cl' }],
      event_orders: [
        { id: ORDER, event_id: 10, status: 'paid', attendee_id: 1, buyer_first_name: 'Ana', buyer_last_name: 'Rojas', buyer_email: 'ana@x.cl', payment_provider: 'free', total_payment: 0, ticket_details: [{ price: 0, quantity: 2 }], created_at: '2026-10-01', events: { id: 10, name: 'Show', start_date: '2099-01-01T23:00:00Z' } },
        { id: UNPAID, event_id: 10, status: 'pending', attendee_id: 1, buyer_email: 'ana@x.cl' },
      ],
      event_attendees: [
        { id: 't1', event_order_id: ORDER, status: 'active' },
        { id: 't2', event_order_id: ORDER, status: 'active' },
      ],
      aitickets_event_feed_posts: [],
      aitickets_attendee_messages: [],
    },
    unique: { aitickets_event_feed_posts: [['event_id', 'email']] },
    defaults: { aitickets_event_feed_posts: { status: 'visible' } },
  })
})

describe('POST /api/orders/feed', () => {
  it('publica la reacción como el comprador (nombre público, sin email en la respuesta) y la actualiza', async () => {
    const res = await feedApi.POST(post('/api/orders/feed', { orderId: ORDER, action: 'react', emoji: '🔥', message: '  ¡Nos vemos!  ' }))
    expect(res.status).toBe(200)
    const { feed } = await res.json()
    expect(feed.mine).toMatchObject({ name: 'Ana R.', emoji: '🔥', message: '¡Nos vemos!', mine: true })
    expect(feed.total).toBe(1)
    expect(JSON.stringify(feed)).not.toContain('ana@x.cl')
    expect(db.tables.aitickets_event_feed_posts[0]).toMatchObject({ event_id: 10, organization_id: 7, order_id: ORDER, email: 'ana@x.cl', status: 'visible' })

    const again = await feedApi.POST(post('/api/orders/feed', { orderId: ORDER, action: 'react', emoji: '🥳' }))
    expect((await again.json()).feed.mine).toMatchObject({ emoji: '🥳', message: null })
    expect(db.tables.aitickets_event_feed_posts).toHaveLength(1)
  })

  it('borra la propia; rechaza emojis fuera de la lista y órdenes sin pagar', async () => {
    await feedApi.POST(post('/api/orders/feed', { orderId: ORDER, action: 'react', emoji: '🔥' }))
    const del = await feedApi.POST(post('/api/orders/feed', { orderId: ORDER, action: 'delete' }))
    expect((await del.json()).feed).toMatchObject({ mine: null, total: 0 })
    expect(db.tables.aitickets_event_feed_posts).toHaveLength(0)

    expect((await feedApi.POST(post('/api/orders/feed', { orderId: ORDER, action: 'react', emoji: '<script>' }))).status).toBe(400)
    expect((await feedApi.POST(post('/api/orders/feed', { orderId: UNPAID, action: 'react', emoji: '🔥' }))).status).toBe(404)
    expect((await feedApi.POST(post('/api/orders/feed', { orderId: 'x', action: 'react', emoji: '🔥' }))).status).toBe(400)
  })

  it('una reacción oculta por la productora sigue oculta al editarla', async () => {
    await feedApi.POST(post('/api/orders/feed', { orderId: ORDER, action: 'react', emoji: '🔥' }))
    db.tables.aitickets_event_feed_posts[0].status = 'hidden'
    const res = await feedApi.POST(post('/api/orders/feed', { orderId: ORDER, action: 'react', emoji: '🙌', message: 'otra vez' }))
    const { feed } = await res.json()
    expect(db.tables.aitickets_event_feed_posts[0].status).toBe('hidden')
    expect(feed.total).toBe(0)
    expect(feed.mine).toMatchObject({ hidden: true })
  })
})

describe('POST /api/orders/message', () => {
  it('guarda el mensaje y lo envía al equipo activo de la productora con Reply-To del asistente', async () => {
    const res = await messageApi.POST(post('/api/orders/message', { orderId: ORDER, message: '¿Se puede entrar con niños?\nGracias' }))
    expect(res.status).toBe(200)
    expect((await res.json()).message).toContain('Prod SpA')
    const [saved] = db.tables.aitickets_attendee_messages
    expect(saved).toMatchObject({ event_id: 10, organization_id: 7, order_id: ORDER, email: 'ana@x.cl', name: 'Ana Rojas', message: '¿Se puede entrar con niños?\nGracias' })
    expect(saved.delivered_at).toBeTruthy()
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
    const mail = mocks.sendEmail.mock.calls[0][0]
    expect(mail.to).toEqual(['dueno@prod.cl'])
    expect(mail.replyTo).toContain('ana@x.cl')
    expect(mail.html).toContain('2 entradas · Asistencia confirmada')
  })

  it('mensaje vacío => 400; orden sin entradas vigentes => 404 (sin guardar ni enviar)', async () => {
    expect((await messageApi.POST(post('/api/orders/message', { orderId: ORDER, message: ' ' }))).status).toBe(400)
    expect((await messageApi.POST(post('/api/orders/message', { orderId: UNPAID, message: 'Hola, una consulta' }))).status).toBe(404)
    expect(db.tables.aitickets_attendee_messages).toHaveLength(0)
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })
})

describe('POST /api/buyer/access-link', () => {
  it('con la orden: envía el link al comprador (sin escribir el email) y lleva de vuelta a la orden', async () => {
    const res = await accessApi.POST(post('/api/buyer/access-link', { orderId: ORDER }))
    expect(res.status).toBe(200)
    expect((await res.json()).message).toContain('an*@x.cl')
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
    const mail = mocks.sendEmail.mock.calls[0][0]
    expect(mail.to).toBe('ana@x.cl')
    const url = new URL(mail.html.match(/href="([^"]*mis-entradas\/acceso[^"]*)"/)[1].replace(/&amp;/g, '&'))
    expect(url.searchParams.get('next')).toBe(`/order/${ORDER}`)
    expect(verifyBuyerLink(url.searchParams.get('t'))).toEqual({ email: 'ana@x.cl' })
  })

  it('con email: misma respuesta tenga o no entradas, pero solo envía si tiene', async () => {
    const yes = await accessApi.POST(post('/api/buyer/access-link', { email: 'ANA@x.cl' }))
    const no = await accessApi.POST(post('/api/buyer/access-link', { email: 'nadie@x.cl' }))
    expect(yes.status).toBe(200)
    expect(await no.json()).toEqual(await yes.json())
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendEmail.mock.calls[0][0].to).toBe('ana@x.cl')
    expect((await accessApi.POST(post('/api/buyer/access-link', { email: 'malo' }))).status).toBe(400)
  })
})
