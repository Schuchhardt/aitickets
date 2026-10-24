// Experiencia del asistente: tipo de orden (gratis = confirmación de asistencia, no compra), sesión de asistente
// ("Mis entradas" con link de acceso por correo), muro de asistentes y lista de órdenes por email.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { orderKind, orderCopy, isPaidKind, shortOrderRef } from '../../netlify/lib/order-kind.mjs'
import { signBuyerLink, verifyBuyerLink, signBuyerSession, verifyBuyerSession, safeBuyerNext } from '../../netlify/lib/buyer-session.mjs'
import { signReviewToken, verifyReviewToken } from '../../netlify/lib/review-token.mjs'
import {
  FEED_EMOJIS,
  normalizeFeedEmoji,
  normalizeFeedMessage,
  normalizeAttendeeMessage,
  summarizeReactions,
  publicFeedPost,
  loadOrderHolder,
  loadFeed,
} from '../../netlify/lib/attendee-community.mjs'
import { groupBuyerOrders, listBuyerOrders } from '../../netlify/lib/buyer-orders.mjs'

const ORDER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('orderKind', () => {
  it('evento gratis (todas las líneas a $0, sin descuento) => rsvp', () => {
    expect(orderKind({ payment_provider: 'free', total_payment: 0, ticket_details: [{ id: 1, price: 0, quantity: 2 }] })).toBe('rsvp')
    expect(orderKind({ payment_provider: 'free', total_payment: 0, ticket_details: [] })).toBe('rsvp')
    expect(orderKind({ payment_provider: 'free', amount: 0, total_payment: null })).toBe('rsvp')
  })

  it('código de 100%: sigue siendo una compra (había precio de lista)', () => {
    expect(orderKind({ payment_provider: 'free', total_payment: 0, discount_amount: 5000, ticket_details: [{ price: 5000, quantity: 1 }] })).toBe('purchase')
    expect(orderKind({ payment_provider: 'free', total_payment: 0, ticket_details: [{ price: 5000, quantity: 1 }] })).toBe('purchase')
  })

  it('cortesía, transferencia y compra', () => {
    expect(orderKind({ payment_provider: 'courtesy', total_payment: 0, ticket_details: [{ price: 0, complimentary: true }] })).toBe('courtesy')
    expect(orderKind({ payment_provider: 'flow', total_payment: 0, ticket_details: [{ price: 9000, transferred_from_order: 'x' }] })).toBe('transfer')
    expect(orderKind({ payment_provider: 'flow', total_payment: 10712, ticket_details: [{ price: 10000 }] })).toBe('purchase')
    expect(orderKind(null)).toBe('purchase')
  })

  it('textos: gratis no habla de compra; la compra sí', () => {
    const rsvp = orderCopy('rsvp', 1)
    expect(rsvp.badge).toBe('Asistencia confirmada')
    expect(Object.values(rsvp).join(' ')).not.toMatch(/compr/i)
    expect(orderCopy('rsvp', 3).headline).toBe('Confirmaste 3 lugares')
    expect(orderCopy('purchase', 2).badge).toBe('Compra confirmada')
    expect(isPaidKind('purchase')).toBe(true)
    expect(isPaidKind('rsvp')).toBe(false)
    expect(shortOrderRef('8f2c1e4a-1234-4c1a-9e1f-0a1b2c3d4e5f')).toBe('8F2C1E4A')
  })
})

describe('sesión de asistente (Mis entradas)', () => {
  beforeEach(() => vi.stubEnv('BUYER_SESSION_SECRET', 'test-secret'))

  it('link de acceso y sesión: ida y vuelta, en minúsculas', () => {
    const link = signBuyerLink(' Ana@Example.COM ')
    expect(verifyBuyerLink(link)).toEqual({ email: 'ana@example.com' })
    const session = signBuyerSession('ana@example.com')
    expect(verifyBuyerSession(session)).toEqual({ email: 'ana@example.com' })
  })

  it('un tipo de token no sirve como otro (link ≠ sesión ≠ reseña)', () => {
    const link = signBuyerLink('ana@example.com')
    const session = signBuyerSession('ana@example.com')
    expect(verifyBuyerSession(link)).toBeNull()
    expect(verifyBuyerLink(session)).toBeNull()
    vi.stubEnv('REVIEW_TOKEN_SECRET', 'test-secret')
    const review = signReviewToken({ eventId: 1, email: 'ana@example.com' })
    expect(verifyBuyerSession(review)).toBeNull()
    expect(verifyReviewToken(session)).toBeNull()
  })

  it('vence: el link a la hora, la sesión a los 90 días', () => {
    const now = new Date('2026-10-24T12:00:00Z')
    const link = signBuyerLink('ana@example.com', { now })
    expect(verifyBuyerLink(link, { now: new Date('2026-10-24T12:59:00Z') })).not.toBeNull()
    expect(verifyBuyerLink(link, { now: new Date('2026-10-24T13:01:00Z') })).toBeNull()
    const session = signBuyerSession('ana@example.com', { now })
    expect(verifyBuyerSession(session, { now: new Date('2027-01-21T12:00:00Z') })).not.toBeNull()
    expect(verifyBuyerSession(session, { now: new Date('2027-01-23T12:00:00Z') })).toBeNull()
  })

  it('firma alterada, email inválido o sin secreto => nada', () => {
    const session = signBuyerSession('ana@example.com')
    const [body] = session.split('.')
    const forged = `${Buffer.from(JSON.stringify({ p: 'bs', m: 'otra@example.com', x: 9999999999 })).toString('base64url')}.${session.split('.')[1]}`
    expect(verifyBuyerSession(forged)).toBeNull()
    expect(verifyBuyerSession(`${body}.x`)).toBeNull()
    expect(signBuyerSession('no-es-email')).toBe('')
    vi.stubEnv('BUYER_SESSION_SECRET', '')
    expect(signBuyerSession('ana@example.com')).toBe('')
    expect(verifyBuyerSession(session)).toBeNull()
  })

  it('destino tras el link: solo Mis entradas, una orden o una entrada', () => {
    expect(safeBuyerNext(`/order/${ORDER}`)).toBe(`/order/${ORDER}`)
    expect(safeBuyerNext(`/ticket/${ORDER}`)).toBe(`/ticket/${ORDER}`)
    for (const bad of ['https://evil.test', '//evil.test', '/dashboard', `/order/${ORDER}/../x`, '/order/123', null]) {
      expect(safeBuyerNext(bad)).toBe('/mis-entradas')
    }
  })
})

describe('muro de asistentes: normalización', () => {
  it('solo emojis de la lista (acepta ❤ sin selector de variación)', () => {
    expect(normalizeFeedEmoji('🔥')).toBe('🔥')
    expect(normalizeFeedEmoji('❤')).toBe('❤️')
    expect(normalizeFeedEmoji('hola')).toBeNull()
    expect(normalizeFeedEmoji('🔥🔥')).toBeNull()
    expect(normalizeFeedEmoji('')).toBeNull()
  })

  it('mensaje del muro: una línea, sin caracteres de control, máx. 280', () => {
    expect(normalizeFeedMessage('  ¡Nos   vemos\nahí!  ')).toBe('¡Nos vemos ahí!')
    expect(normalizeFeedMessage('hola‮olleh\u0000')).toBe('holaolleh')
    expect(normalizeFeedMessage('   ')).toBeNull()
    expect(Array.from(normalizeFeedMessage('😀'.repeat(400))).length).toBe(280)
  })

  it('mensaje a la productora: conserva saltos de línea, exige texto', () => {
    expect(normalizeAttendeeMessage('Hola\r\n\r\n\r\n\r\n¿Hay estacionamiento?')).toBe('Hola\n\n¿Hay estacionamiento?')
    expect(normalizeAttendeeMessage(' a ')).toBeNull()
    expect(normalizeAttendeeMessage('x'.repeat(3000)).length).toBe(2000)
  })

  it('conteo de reacciones y publicación pública (sin email)', () => {
    const rows = [{ emoji: '🎉' }, { emoji: '🔥' }, { emoji: '🎉' }, { emoji: 'otro' }, { emoji: '🔥' }, { emoji: '🙌' }]
    expect(summarizeReactions(rows)).toEqual([{ emoji: '🔥', count: 2 }, { emoji: '🎉', count: 2 }, { emoji: '🙌', count: 1 }])
    const post = publicFeedPost({ id: 'p1', email: 'ana@x.cl', display_name: 'Ana R.', emoji: '🔥', message: 'Vamos', status: 'hidden', created_at: '2026-10-24' }, 'ANA@x.cl')
    expect(post).toEqual({ id: 'p1', name: 'Ana R.', emoji: '🔥', message: 'Vamos', created_at: '2026-10-24', mine: true, hidden: true })
    expect(publicFeedPost({ id: 'p2', email: 'b@x.cl', emoji: '🥳', status: 'visible' }, 'ana@x.cl')).not.toHaveProperty('email')
    expect(FEED_EMOJIS).toHaveLength(8)
  })
})

describe('muro de asistentes: acceso con la orden', () => {
  const setup = (overrides = {}) =>
    createFakeSupabase({
      tables: {
        events: [{ id: 10, name: 'Show', slug: 'show', organization_id: 7 }],
        attendees: [{ id: 1, first_name: 'Ana', last_name: 'Rojas', email: 'ana@x.cl' }],
        event_orders: [{ id: ORDER, event_id: 10, status: 'paid', attendee_id: 1, buyer_first_name: 'Ana María', buyer_last_name: 'Rojas', buyer_email: 'ana@x.cl', payment_provider: 'free', total_payment: 0, ticket_details: [{ price: 0, quantity: 2 }] }],
        event_attendees: [
          { id: 't1', event_order_id: ORDER, status: 'active' },
          { id: 't2', event_order_id: ORDER, status: 'cancelled' },
        ],
        aitickets_event_feed_posts: [
          { id: 'p1', event_id: 10, email: 'b@x.cl', display_name: 'Beto C.', emoji: '🔥', message: 'Vamos', status: 'visible', created_at: '2026-10-20T10:00:00Z' },
          { id: 'p2', event_id: 10, email: 'c@x.cl', display_name: 'Caro D.', emoji: '🙌', message: null, status: 'hidden', created_at: '2026-10-21T10:00:00Z' },
          { id: 'p3', event_id: 11, email: 'd@x.cl', display_name: 'Otro', emoji: '🎉', status: 'visible', created_at: '2026-10-22T10:00:00Z' },
        ],
        ...overrides,
      },
    })

  it('orden pagada con entradas vigentes => titular con nombre público y tipo', async () => {
    const holder = await loadOrderHolder(setup(), ORDER)
    expect(holder).toMatchObject({ email: 'ana@x.cl', displayName: 'Ana R.', liveCount: 1, kind: 'rsvp', event: { id: 10, organization_id: 7 } })
  })

  it('sin pagar, sin entradas vigentes o id inválido => null', async () => {
    expect(await loadOrderHolder(setup(), 'no-uuid')).toBeNull()
    const unpaid = setup({ event_orders: [{ id: ORDER, event_id: 10, status: 'pending', buyer_email: 'ana@x.cl' }] })
    expect(await loadOrderHolder(unpaid, ORDER)).toBeNull()
    const voided = setup({ event_attendees: [{ id: 't1', event_order_id: ORDER, status: 'cancelled' }] })
    expect(await loadOrderHolder(voided, ORDER)).toBeNull()
  })

  it('el muro muestra solo lo visible del evento; la propia aparece aunque esté oculta', async () => {
    const feed = await loadFeed(setup(), 10, 'c@x.cl')
    expect(feed.posts.map((p) => p.id)).toEqual(['p1'])
    expect(feed.reactions).toEqual([{ emoji: '🔥', count: 1 }])
    expect(feed.total).toBe(1)
    expect(feed.mine).toMatchObject({ id: 'p2', mine: true, hidden: true })
    expect(JSON.stringify(feed)).not.toContain('@x.cl')
  })
})

describe('Mis entradas: órdenes por email', () => {
  const now = new Date('2026-10-24T12:00:00Z')
  const event = (id, start, end = null) => ({ id, name: `Evento ${id}`, slug: `e${id}`, image_url: null, start_date: start, end_date: end, location: '' })

  it('separa próximas (de la más cercana) y pasadas (de la más reciente); oculta las sin entradas vigentes', () => {
    const orders = [
      { id: 'o1', status: 'paid', payment_provider: 'flow', total_payment: 1000, ticket_details: [{ price: 1000 }], events: event(1, '2026-12-01T23:00:00Z') },
      { id: 'o2', status: 'paid', payment_provider: 'free', total_payment: 0, ticket_details: [{ price: 0 }], events: event(2, '2026-11-01T23:00:00Z', '2026-11-02T03:00:00Z') },
      { id: 'o3', status: 'paid', payment_provider: 'flow', total_payment: 1000, ticket_details: [{ price: 1000 }], events: event(3, '2026-01-01T23:00:00Z', '2026-01-02T03:00:00Z') },
      { id: 'o4', status: 'paid', payment_provider: 'flow', total_payment: 1000, ticket_details: [{ price: 1000 }], events: event(4, '2026-11-15T23:00:00Z') },
      { id: 'o5', status: 'processing', payment_provider: 'flow', total_payment: 1000, ticket_details: [{ price: 1000 }], events: event(5, '2026-10-30T23:00:00Z') },
    ]
    const live = new Map([['o1', 2], ['o2', 1], ['o3', 1]])
    const { upcoming, past } = groupBuyerOrders(orders, live, now)
    expect(upcoming.map((i) => i.orderId)).toEqual(['o5', 'o2', 'o1'])
    expect(upcoming.find((i) => i.orderId === 'o2')).toMatchObject({ kind: 'rsvp', count: 1 })
    expect(past.map((i) => i.orderId)).toEqual(['o3'])
  })

  it('busca por buyer_email y, en órdenes antiguas, por el registro attendees', async () => {
    const db = createFakeSupabase({
      tables: {
        attendees: [{ id: 1, email: 'Ana@X.cl' }],
        event_orders: [
          { id: 'o1', status: 'paid', buyer_email: 'ana@x.cl', attendee_id: 1, payment_provider: 'free', total_payment: 0, ticket_details: [], created_at: '2026-10-01', events: event(1, '2026-12-01T23:00:00Z') },
          { id: 'o2', status: 'paid', buyer_email: null, attendee_id: 1, payment_provider: 'flow', total_payment: 5000, ticket_details: [{ price: 5000 }], created_at: '2025-01-01', events: event(2, '2025-02-01T23:00:00Z') },
          { id: 'o3', status: 'paid', buyer_email: 'otra@x.cl', attendee_id: 2, payment_provider: 'flow', total_payment: 5000, ticket_details: [], created_at: '2026-10-01', events: event(3, '2026-12-01T23:00:00Z') },
          { id: 'o4', status: 'refunded', buyer_email: 'ana@x.cl', attendee_id: 1, payment_provider: 'flow', total_payment: 5000, ticket_details: [], created_at: '2026-10-01', events: event(4, '2026-12-01T23:00:00Z') },
        ],
        event_attendees: [
          { id: 't1', event_order_id: 'o1', status: 'active' },
          { id: 't2', event_order_id: 'o2', status: 'validated' },
          { id: 't3', event_order_id: 'o3', status: 'active' },
        ],
      },
    })
    const { upcoming, past } = await listBuyerOrders(db, 'ANA@x.cl', { now })
    expect(upcoming.map((i) => i.orderId)).toEqual(['o1'])
    expect(past.map((i) => i.orderId)).toEqual(['o2'])
  })
})
