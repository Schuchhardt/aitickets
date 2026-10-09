// API de productores: invitados, cortesías y postventa (reembolsos, transferencias, cancelación).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

const mocks = vi.hoisted(() => ({
  sendTicketsEmail: vi.fn(async () => ({ ok: true, status: 200, data: {} })),
  notifySlack: vi.fn(async () => {}),
  callInternalFunction: vi.fn(async () => ({ ok: true, status: 202, data: {} })),
  sendEmail: vi.fn(async () => ({ id: 'mail_1' })),
}))

vi.mock('../../src/pages/api/_lib/server-utils', () => ({
  sendTicketsEmail: mocks.sendTicketsEmail,
  notifySlack: mocks.notifySlack,
  callInternalFunction: mocks.callInternalFunction,
}))
vi.mock('../../netlify/lib/mailer.mjs', async (importOriginal) => ({ ...(await importOriginal()), sendEmail: mocks.sendEmail }))

const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { guestTools, normalizePhone } = await import('../../src/lib/producer-api/tools/guests.ts')
const { postsaleTools } = await import('../../src/lib/producer-api/tools/postsale.ts')

const tool = (name) => [...guestTools, ...postsaleTools].find((t) => t.name === name)
const ORDER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORDER_FREE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const T1 = '11111111-1111-4111-8111-111111111111'
const T2 = '22222222-2222-4222-8222-222222222222'
const T3 = '33333333-3333-4333-8333-333333333333'

let db
let actor
const ctx = () => ({ supabase: db, actor, origin: 'https://aitickets.test', requestUrl: new URL('https://aitickets.test/api/mcp'), channel: 'mcp' })
const call = (name, args) => runTool(tool(name), args, ctx())

/** Llama dos veces (resumen + confirmación) como lo haría el asistente. */
async function confirmAndRun(name, args) {
  const first = await call(name, args)
  expect(first.ok).toBe(true)
  expect(first.result.status).toBe('confirmation_required')
  return call(name, { ...args, confirmation_token: first.result.confirmation_token })
}

beforeEach(() => {
  mocks.sendTicketsEmail.mockClear()
  mocks.notifySlack.mockClear()
  mocks.callInternalFunction.mockClear()
  mocks.sendEmail.mockClear()
  actor = { keyId: 'k1', userId: 1, orgId: 7, role: 'producer', name: 'Ana', email: 'ana@prod.cl', scopes: ['read', 'write', 'publish', 'attendees', 'finance', 'team'], eventIds: null }
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Prod SpA' }],
      events: [
        { id: 10, name: 'Fiesta', slug: 'fiesta', status: 'published', organization_id: 7, cancelled_at: null },
        { id: 11, name: 'Borrador', slug: 'borrador', status: 'draft', organization_id: 7, cancelled_at: null },
        { id: 99, name: 'Ajeno', slug: 'ajeno', status: 'published', organization_id: 8, cancelled_at: null },
      ],
      event_tickets: [{ id: 5, event_id: 10, ticket_name: 'General', price: 10000 }],
      attendees: [{ id: 300, first_name: 'Bea', email: 'bea@mail.cl', created_at: '2026-01-01' }],
      event_orders: [
        {
          id: ORDER_A, event_id: 10, attendee_id: 300, status: 'paid', amount: 20000, ticket_fee: 1600, service_fee_tax: 304, total_payment: 21904,
          ticket_qty: 2, ticket_details: [{ id: 5, name: 'General', price: 10000, quantity: 2, total: 20000 }],
          buyer_first_name: 'Bea', buyer_last_name: 'Soto', buyer_email: 'bea@mail.cl', payment_provider: 'flow', payment_external_id: '777', created_at: '2026-10-01',
        },
        {
          id: ORDER_FREE, event_id: 10, attendee_id: 300, status: 'paid', amount: 0, ticket_fee: 0, service_fee_tax: 0, total_payment: 0,
          ticket_qty: 1, ticket_details: [{ id: 5, name: 'General', price: 0, quantity: 1, total: 0, complimentary: true }],
          buyer_first_name: 'Bea', buyer_email: 'bea@mail.cl', payment_provider: 'courtesy', created_at: '2026-10-02',
        },
      ],
      event_attendees: [
        { id: T1, event_id: 10, event_ticket_id: 5, attendee_id: 300, event_order_id: ORDER_A, qr_code: 'qr1', status: 'active', validated_at: null },
        { id: T2, event_id: 10, event_ticket_id: 5, attendee_id: 300, event_order_id: ORDER_A, qr_code: 'qr2', status: 'validated', validated_at: '2026-10-05' },
        { id: T3, event_id: 10, event_ticket_id: 5, attendee_id: 300, event_order_id: ORDER_FREE, qr_code: 'qr3', status: null, validated_at: null },
      ],
      event_withdrawals: [],
      aitickets_refunds: [],
      aitickets_guests: [],
      aitickets_api_confirmations: [],
      aitickets_api_idempotency: [],
      aitickets_api_audit: [],
    },
  })
})

describe('invitados', () => {
  it('normaliza teléfonos chilenos', () => {
    expect(normalizePhone('9 8765 4321')).toBe('+56987654321')
    expect(normalizePhone('+56 9 8765 4321')).toBe('+56987654321')
    expect(normalizePhone('')).toBeNull()
  })

  it('add_guests omite duplicados y list_guests resume', async () => {
    const r = await call('add_guests', {
      event_id: 10,
      guests: [
        { name: 'Ana', email: 'ANA@x.cl', plus_ones: 1 },
        { name: 'Ana bis', email: 'ana@x.cl' },
        { name: 'Pepe', phone: '987654321' },
        { name: 'Malo', email: 'no-es-email' },
      ],
    })
    expect(r.ok).toBe(true)
    expect(r.result.added_count).toBe(2)
    expect(r.result.skipped.map((s) => s.reason)).toEqual(['ya está en la lista', 'email inválido'])
    const again = await call('add_guests', { event_id: 10, guests: [{ name: 'Pepe 2', phone: '+56987654321' }] })
    expect(again.result.added_count).toBe(0)
    const list = await call('list_guests', { event_id: 10 })
    expect(list.result.summary).toEqual({ pending: 2, invited: 0, people_including_plus_ones: 3 })
  })

  it('no accede a eventos de otra organización', async () => {
    const r = await call('add_guests', { event_id: 99, guests: [{ name: 'X' }] })
    expect(r).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('send_invitations: rechaza borradores', async () => {
    await call('add_guests', { event_id: 11, guests: [{ name: 'Ana', email: 'ana@x.cl' }] })
    const r = await call('send_invitations', { event_id: 11, channel: 'email' })
    expect(r).toMatchObject({ ok: false, code: 'conflict' })
  })

  it('send_invitations por email exige confirmación y marca invitados', async () => {
    await call('add_guests', { event_id: 10, guests: [{ name: 'Ana', email: 'ana@x.cl' }, { name: 'Sin mail', phone: '987654321' }] })
    const first = await call('send_invitations', { event_id: 10, channel: 'email' })
    expect(first.result.status).toBe('confirmation_required')
    expect(mocks.sendEmail).not.toHaveBeenCalled()
    const r = await call('send_invitations', { event_id: 10, channel: 'email', confirmation_token: first.result.confirmation_token })
    expect(r.ok).toBe(true)
    expect(r.result.sent_count).toBe(1)
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendEmail.mock.calls[0][0].recipientVariables['ana@x.cl'].name.text).toBe('Ana')
    expect(db.tables.aitickets_guests.find((g) => g.name === 'Ana').status).toBe('invited')
    expect(db.tables.aitickets_guests.find((g) => g.name === 'Sin mail').status).toBe('pending')
    // El token es de un solo uso: repetir devuelve la misma respuesta (idempotente) sin reenviar.
    // (el fake no aplica UNIQUE: se simula la violación de aitickets_api_idempotency_key)
    db.failOn('aitickets_api_idempotency', 'insert', { code: '23505', message: 'duplicate key' })
    const replay = await call('send_invitations', { event_id: 10, channel: 'email', confirmation_token: first.result.confirmation_token })
    expect(replay.result.idempotent_replay).toBe(true)
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('send_invitations por WhatsApp devuelve links wa.me', async () => {
    await call('add_guests', { event_id: 10, guests: [{ name: 'Pepe', phone: '987654321' }] })
    const r = await confirmAndRun('send_invitations', { event_id: 10, channel: 'whatsapp', message: 'Te esperamos' })
    expect(r.result.links[0].whatsapp_url).toMatch(/^https:\/\/wa\.me\/56987654321\?text=/)
    expect(decodeURIComponent(r.result.links[0].whatsapp_url)).toContain('https://aitickets.test/eventos/fiesta')
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })

  it('issue_complimentary_tickets crea orden de cortesía y envía las entradas', async () => {
    const r = await call('issue_complimentary_tickets', { event_id: 10, ticket_type_id: 5, recipients: [{ name: 'DJ Uno', email: 'dj@x.cl', quantity: 2 }] })
    expect(r.ok).toBe(true)
    expect(r.result.tickets_issued).toBe(2)
    const order = db.tables.event_orders.find((o) => String(o.id) === r.result.results[0].order_id)
    expect(order).toMatchObject({ payment_provider: 'courtesy', amount: 0, buyer_email: 'dj@x.cl', buyer_first_name: 'DJ', buyer_last_name: 'Uno' })
    expect(db.tables.event_attendees.filter((a) => a.event_order_id === order.id && a.is_complimentary)).toHaveLength(2)
    expect(mocks.sendTicketsEmail).toHaveBeenCalledWith(expect.any(URL), String(order.id))
  })

  it('un validador (puerta) no puede gestionar invitados', async () => {
    actor.role = 'validator'
    const r = await call('add_guests', { event_id: 10, guests: [{ name: 'X' }] })
    expect(r).toMatchObject({ ok: false, code: 'forbidden' })
  })
})

describe('postventa', () => {
  it('get_order por email del comprador', async () => {
    const r = await call('get_order', { event_id: 10, buyer_email: 'BEA@mail.cl' })
    expect(r.ok).toBe(true)
    expect(r.result.count).toBe(2)
    const a = r.result.orders.find((o) => o.id === ORDER_A)
    expect(a.tickets.map((t) => t.status)).toEqual(['active', 'validated'])
    expect(a.amounts.service_fee_clp).toBe(1904)
  })

  it('resend_tickets reenvía con force', async () => {
    const r = await call('resend_tickets', { order_id: ORDER_A })
    expect(r.ok).toBe(true)
    expect(mocks.sendTicketsEmail).toHaveBeenCalledWith(expect.any(URL), ORDER_A, true)
  })

  it('transfer_ticket mueve la entrada a una orden nueva con QR nuevo', async () => {
    const r = await call('transfer_ticket', { ticket_id: T1, new_holder_name: 'Carla Pérez', new_holder_email: 'carla@x.cl' })
    expect(r.ok).toBe(true)
    const ticket = db.tables.event_attendees.find((a) => a.id === T1)
    expect(ticket.event_order_id).toBe(r.result.new_order_id)
    expect(ticket.qr_code).not.toBe('qr1')
    expect(db.tables.event_orders.find((o) => o.id === ORDER_A).ticket_qty).toBe(1)
    expect(db.tables.event_orders.find((o) => o.id === r.result.new_order_id)).toMatchObject({ amount: 0, buyer_email: 'carla@x.cl', status: 'paid' })
    expect(mocks.sendTicketsEmail).toHaveBeenCalledWith(expect.any(URL), r.result.new_order_id)
  })

  it('transfer_ticket acepta entradas antiguas (status NULL) y rechaza las ya usadas', async () => {
    expect((await call('transfer_ticket', { ticket_id: T2, new_holder_name: 'X', new_holder_email: 'x@x.cl' })).code).toBe('conflict')
    expect((await call('transfer_ticket', { ticket_id: T3, new_holder_name: 'X', new_holder_email: 'x@x.cl' })).ok).toBe(true)
  })

  it('refund_order parcial: proporcional, anula la entrada y no toca el estado de la orden', async () => {
    const r = await confirmAndRun('refund_order', { order_id: ORDER_A, ticket_ids: [T1], refund_service_fee: true })
    expect(r.ok).toBe(true)
    expect(r.result).toMatchObject({ kind: 'partial', ticket_amount_clp: 10000, service_fee_refund_clp: 952, total_clp: 10952, order_status: 'paid', refund_status: 'requested' })
    expect(db.tables.event_attendees.find((a) => a.id === T1).status).toBe('cancelled')
    expect(db.tables.event_orders.find((o) => o.id === ORDER_A).status).toBe('paid')
    expect(db.tables.aitickets_refunds).toHaveLength(1)
    expect(mocks.notifySlack).toHaveBeenCalled()
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('refund_order: entradas usadas requieren force; total marca la orden refunded', async () => {
    const blocked = await call('refund_order', { order_id: ORDER_A })
    expect(blocked).toMatchObject({ ok: false, code: 'conflict' })
    const r = await confirmAndRun('refund_order', { order_id: ORDER_A, force: true })
    expect(r.result).toMatchObject({ kind: 'full', ticket_amount_clp: 20000, service_fee_refund_clp: 0, order_status: 'refunded' })
    expect(db.tables.event_orders.find((o) => o.id === ORDER_A).status).toBe('refunded')
  })

  it('refund_order no supera lo que aún no se le transfirió al productor', async () => {
    db.tables.event_withdrawals.push({ id: 1, event_id: 10, amount: 15000, status: 'paid' })
    const r = await call('refund_order', { order_id: ORDER_A, ticket_ids: [T1] })
    expect(r).toMatchObject({ ok: false, code: 'conflict' })
    expect(r.message).toMatch(/soporte/)
  })

  it('refund_order exige rol de finanzas o dueño', async () => {
    actor.role = 'admin'
    expect((await call('refund_order', { order_id: ORDER_A, ticket_ids: [T1] })).code).toBe('forbidden')
    actor.role = 'finance'
    expect((await call('refund_order', { order_id: ORDER_A, ticket_ids: [T1] })).result.status).toBe('confirmation_required')
  })

  it('refund_order: el token no sirve con otros argumentos', async () => {
    const first = await call('refund_order', { order_id: ORDER_A, ticket_ids: [T1] })
    const r = await call('refund_order', { order_id: ORDER_A, ticket_ids: [T1], refund_service_fee: true, confirmation_token: first.result.confirmation_token })
    expect(r).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(db.tables.event_attendees.find((a) => a.id === T1).status).toBe('active')
  })

  it('cancel_event: solo dueño/finanzas; anula todo, reembolsa y avisa incluyendo entradas anuladas', async () => {
    actor.role = 'admin'
    expect((await call('cancel_event', { event_id: 10, reason: 'Lluvia' })).code).toBe('forbidden')
    actor.role = 'producer'
    const r = await confirmAndRun('cancel_event', { event_id: 10, reason: 'Suspendido por lluvia' })
    expect(r.ok).toBe(true)
    expect(r.result).toMatchObject({ orders_refunded: 2, refunds_created: 1, refund_total_clp: 21904, buyers_notification_queued: true })
    expect(db.tables.events.find((e) => e.id === 10)).toMatchObject({ status: 'draft', cancellation_reason: 'Suspendido por lluvia' })
    expect(db.tables.event_attendees.every((a) => a.status === 'cancelled')).toBe(true)
    expect(db.tables.event_orders.every((o) => o.event_id !== 10 || o.status === 'refunded')).toBe(true)
    expect(mocks.callInternalFunction.mock.calls[0][2]).toMatchObject({ eventId: 10, changeType: 'cancellation', includeCancelled: true })
    expect((await call('cancel_event', { event_id: 10, reason: 'otra vez' })).code).toBe('conflict')
  })
})

describe('postventa: casos de borde de reembolsos y cancelación', () => {
  it('dos reembolsos confirmados en paralelo de la misma entrada: solo uno se ejecuta', async () => {
    const args = { order_id: ORDER_A, ticket_ids: [T1] }
    const a = await call('refund_order', args)
    const b = await call('refund_order', args)
    const [ra, rb] = await Promise.all([
      call('refund_order', { ...args, confirmation_token: a.result.confirmation_token }),
      call('refund_order', { ...args, confirmation_token: b.result.confirmation_token }),
    ])
    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1)
    expect(db.tables.aitickets_refunds).toHaveLength(1)
    expect(db.tables.event_attendees.find((x) => x.id === T1).status).toBe('cancelled')
  })

  it('cargo absorbido: el reembolso total devuelve lo que pagó el comprador (neto del productor + cargo)', async () => {
    Object.assign(db.tables.event_orders.find((o) => o.id === ORDER_A), { amount: 18096, total_payment: 20000, fee_absorbed: true })
    const r = await confirmAndRun('refund_order', { order_id: ORDER_A, force: true })
    expect(r.result).toMatchObject({ kind: 'full', ticket_amount_clp: 18096, service_fee_refund_clp: 1904, total_clp: 20000 })
    const partial = db.tables.event_orders.find((o) => o.id === ORDER_A)
    expect(partial.status).toBe('refunded')
  })

  it('cargo absorbido parcial: proporcional, cargo incluido aunque refund_service_fee=false', async () => {
    Object.assign(db.tables.event_orders.find((o) => o.id === ORDER_A), { amount: 18096, total_payment: 20000, fee_absorbed: true })
    const r = await confirmAndRun('refund_order', { order_id: ORDER_A, ticket_ids: [T1] })
    expect(r.result).toMatchObject({ kind: 'partial', ticket_amount_clp: 9048, service_fee_refund_clp: 952, total_clp: 10000 })
  })

  it('tras transferir una entrada, reembolsar el resto es parcial y la orden sigue pagada', async () => {
    const t = await call('transfer_ticket', { ticket_id: T1, new_holder_name: 'Carla', new_holder_email: 'carla@x.cl' })
    expect(t.ok).toBe(true)
    const r = await confirmAndRun('refund_order', { order_id: ORDER_A, force: true })
    expect(r.result).toMatchObject({ kind: 'partial', ticket_amount_clp: 10000, order_status: 'paid' })
    expect(db.tables.event_orders.find((o) => o.id === ORDER_A).status).toBe('paid')
    // La entrada transferida sigue vigente
    expect(db.tables.event_attendees.find((x) => x.id === T1).status).toBe('active')
  })

  it('un reembolso fallido no cuenta: se puede volver a reembolsar y no resta saldo', async () => {
    db.tables.aitickets_refunds.push({ id: 'r-old', organization_id: 7, event_id: 10, order_id: ORDER_A, kind: 'partial', ticket_amount: 10000, fee_amount: 0, total_amount: 10000, status: 'failed' })
    const r = await confirmAndRun('refund_order', { order_id: ORDER_A, ticket_ids: [T1] })
    expect(r.result.ticket_amount_clp).toBe(10000)
    const { computeEventLedger, isActiveRefund } = await import('../../src/lib/producer-api/ledger.ts')
    expect(isActiveRefund({ status: 'failed' })).toBe(false)
    expect(isActiveRefund({ status: 'completed' })).toBe(true)
    const ledger = await computeEventLedger(db, 7, 10)
    expect(ledger.partial_refunds).toBe(10000)
  })

  it('cancel_event exige el permiso finance de la conexión', async () => {
    actor.scopes = ['read', 'write', 'publish', 'attendees']
    expect((await call('cancel_event', { event_id: 10, reason: 'Lluvia' })).code).toBe('forbidden')
  })

  it('cancel_event a medias se completa al reintentar, sin duplicar reembolsos', async () => {
    db.failOn('aitickets_refunds', 'insert', { code: 'XX000', message: 'boom' })
    const first = await confirmAndRun('cancel_event', { event_id: 10, reason: 'Lluvia' })
    expect(first).toMatchObject({ ok: false, code: 'internal' })
    expect(db.tables.events.find((e) => e.id === 10).cancelled_at).toBeTruthy()
    expect(db.tables.event_orders.find((o) => o.id === ORDER_A).status).toBe('paid')

    const retry = await confirmAndRun('cancel_event', { event_id: 10, reason: 'Lluvia' })
    expect(retry.ok).toBe(true)
    expect(retry.result).toMatchObject({ resumed: true, refunds_created: 1, refund_total_clp: 21904 })
    expect(db.tables.aitickets_refunds).toHaveLength(1)
    expect(db.tables.event_orders.filter((o) => o.event_id === 10).every((o) => o.status === 'refunded')).toBe(true)
    // El primer intento falló antes del aviso: el reintento lo encola (una sola vez en total)
    expect(mocks.callInternalFunction).toHaveBeenCalledTimes(1)
  })

  it('cancel_event no le avisa a quienes ya estaban reembolsados', async () => {
    db.tables.event_orders.find((o) => o.id === ORDER_FREE).status = 'refunded'
    db.tables.aitickets_refunds.push({ id: 'r-prev', organization_id: 7, event_id: 10, order_id: ORDER_FREE, kind: 'full', ticket_amount: 0, fee_amount: 0, total_amount: 0, source: 'refund_order', status: 'completed' })
    const r = await confirmAndRun('cancel_event', { event_id: 10, reason: 'Lluvia' })
    expect(r.ok).toBe(true)
    expect(mocks.callInternalFunction.mock.calls[0][2].excludeOrderIds).toEqual([ORDER_FREE])
    expect(db.tables.event_orders.find((o) => o.id === ORDER_FREE).status).toBe('refunded')
  })
})
