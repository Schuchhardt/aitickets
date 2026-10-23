// Registro de entrega de correos de entradas (aitickets_email_log), webhook de Resend y get_order.email_delivery.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

const mocks = vi.hoisted(() => ({
  db: null,
  sendEmail: vi.fn(async () => ({ id: 're_msg_1' })),
  notifySlack: vi.fn(async () => {}),
  serverEnv: vi.fn(() => undefined),
  sendTicketsEmail: vi.fn(async () => ({ ok: true, status: 200, data: {} })),
}))

vi.mock('../../netlify/lib/supabase.mjs', () => ({ getSupabaseAdmin: () => mocks.db }))
vi.mock('../../netlify/lib/mailer.mjs', async (importOriginal) => ({ ...(await importOriginal()), sendEmail: mocks.sendEmail }))
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => mocks.db }))
vi.mock('../../src/pages/api/_lib/server-utils', () => ({
  notifySlack: mocks.notifySlack,
  serverEnv: mocks.serverEnv,
  sendTicketsEmail: mocks.sendTicketsEmail,
  callInternalFunction: vi.fn(async () => ({ ok: true, status: 202, data: {} })),
}))

const { logEmailAttempt, applyProviderEvent, summarizeEmailDelivery, loadOrderEmailLog } = await import('../../netlify/lib/email-log.mjs')
const { verifyWebhookSignature, signWebhookPayload } = await import('../../netlify/lib/resend-webhook.mjs')
const { sendOrderTicketsEmail } = await import('../../netlify/lib/tickets-email.mjs')
const { POST: webhookPost } = await import('../../src/pages/api/webhooks/resend.ts')
const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { postsaleTools } = await import('../../src/lib/producer-api/tools/postsale.ts')

const SECRET = `whsec_${Buffer.from('clave-de-prueba-del-webhook-32by').toString('base64')}`
const ORDER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const nowSec = () => String(Math.floor(Date.now() / 1000))

/** Fake con .or() ignorado (tickets-email filtra entradas anuladas con or(); aquí no hay anuladas). */
function dbWithOr(opts) {
  const db = createFakeSupabase(opts)
  const from = db.from
  db.from = (table) => {
    const b = from(table)
    b.or = () => b
    return b
  }
  return db
}

function logRow(over = {}) {
  return { id: 1, kind: 'tickets', order_id: ORDER, event_id: 10, recipient: 'bea@mail.cl', provider: 'resend', provider_message_id: 're_msg_1', status: 'sent', error: null, events: [], last_event_at: null, created_at: '2026-10-20T10:00:00.000Z', ...over }
}

beforeEach(() => {
  mocks.sendEmail.mockReset()
  mocks.sendEmail.mockResolvedValue({ id: 're_msg_1' })
  mocks.notifySlack.mockClear()
  mocks.serverEnv.mockReset()
  mocks.serverEnv.mockImplementation(() => undefined)
})

describe('logEmailAttempt', () => {
  it('registra el intento con el id de Resend y trunca el error', async () => {
    const db = createFakeSupabase({ tables: { aitickets_email_log: [] } })
    expect(await logEmailAttempt(db, { orderId: ORDER, eventId: '10', recipient: 'bea@mail.cl', providerMessageId: 're_1', status: 'sent' })).toBe(true)
    expect(await logEmailAttempt(db, { orderId: ORDER, eventId: 10, recipient: 'bea@mail.cl', status: 'failed', error: 'x'.repeat(900) })).toBe(true)
    const [sent, failed] = db.tables.aitickets_email_log
    expect(sent).toMatchObject({ kind: 'tickets', order_id: ORDER, event_id: 10, provider: 'resend', provider_message_id: 're_1', status: 'sent' })
    expect(failed.error).toHaveLength(500)
  })

  it('nunca falla: tabla inexistente o cliente que lanza', async () => {
    const db = createFakeSupabase()
    db.failOn('aitickets_email_log', 'insert', { code: '42P01', message: 'no existe' })
    expect(await logEmailAttempt(db, { orderId: ORDER, status: 'sent' })).toBe(false)
    const broken = { from: () => { throw new Error('sin conexión') } }
    expect(await logEmailAttempt(broken, { orderId: ORDER, status: 'sent' })).toBe(false)
  })
})

describe('applyProviderEvent', () => {
  it('delivered promueve; un delayed posterior no lo degrada; repetir el mismo evento no hace nada', async () => {
    const db = createFakeSupabase({ tables: { aitickets_email_log: [logRow()] } })
    const r1 = await applyProviderEvent(db, { messageId: 're_msg_1', type: 'email.delivered', at: '2026-10-20T10:01:00Z', eventId: 'msg_a' })
    expect(r1).toMatchObject({ ok: true, updated: true, previousStatus: 'sent' })
    expect(db.tables.aitickets_email_log[0].status).toBe('delivered')

    const r2 = await applyProviderEvent(db, { messageId: 're_msg_1', type: 'email.delivery_delayed', at: '2026-10-20T10:00:30Z', eventId: 'msg_b' })
    expect(r2.updated).toBe(true)
    expect(db.tables.aitickets_email_log[0].status).toBe('delivered')
    expect(db.tables.aitickets_email_log[0].last_event_at).toBe('2026-10-20T10:01:00.000Z')
    expect(db.tables.aitickets_email_log[0].events.map((e) => e.type)).toEqual(['email.delivered', 'email.delivery_delayed'])

    const r3 = await applyProviderEvent(db, { messageId: 're_msg_1', type: 'email.delivered', eventId: 'msg_a' })
    expect(r3).toMatchObject({ updated: false, reason: 'duplicate' })
  })

  it('un delivered que llega en paralelo no pisa un bounced ya aplicado', async () => {
    const db = createFakeSupabase({ tables: { aitickets_email_log: [logRow()] } })
    // Simula la carrera: este evento leyó 'sent', pero antes de escribir otro evento dejó la fila en 'bounced'
    const from = db.from
    db.from = (table) => {
      const b = from(table)
      const update = b.update
      b.update = (values, opts) => {
        if (values.status === 'delivered') db.tables.aitickets_email_log[0].status = 'bounced'
        return update(values, opts)
      }
      return b
    }
    const r = await applyProviderEvent(db, { messageId: 're_msg_1', type: 'email.delivered', eventId: 'msg_r' })
    expect(r).toMatchObject({ ok: true, updated: true })
    expect(r.row.status).toBeNull()
    expect(db.tables.aitickets_email_log[0].status).toBe('bounced')
    expect(db.tables.aitickets_email_log[0].events.map((e) => e.id)).toEqual(['msg_r'])
  })

  it('bounced guarda el motivo', async () => {
    const db = createFakeSupabase({ tables: { aitickets_email_log: [logRow()] } })
    await applyProviderEvent(db, { messageId: 're_msg_1', type: 'email.bounced', eventId: 'msg_c', data: { bounce: { type: 'Permanent', subType: 'General', message: 'Mailbox does not exist' } } })
    expect(db.tables.aitickets_email_log[0]).toMatchObject({ status: 'bounced', error: 'Permanent · General · Mailbox does not exist' })
  })

  it('ignora tipos sin efecto, correos no registrados y la tabla inexistente', async () => {
    const db = createFakeSupabase({ tables: { aitickets_email_log: [logRow()] } })
    expect(await applyProviderEvent(db, { messageId: 're_msg_1', type: 'email.opened' })).toMatchObject({ ok: true, updated: false, reason: 'ignored_type' })
    expect(await applyProviderEvent(db, { messageId: 're_otro', type: 'email.delivered' })).toMatchObject({ ok: true, updated: false, reason: 'unknown_message' })
    db.failOn('aitickets_email_log', 'select', { code: 'PGRST205', message: 'no existe' })
    expect(await applyProviderEvent(db, { messageId: 're_msg_1', type: 'email.delivered' })).toMatchObject({ ok: true, updated: false, reason: 'missing_table' })
    db.failOn('aitickets_email_log', 'select', { code: '08006', message: 'conexión' })
    expect(await applyProviderEvent(db, { messageId: 're_msg_1', type: 'email.delivered' })).toMatchObject({ ok: false })
  })
})

describe('summarizeEmailDelivery', () => {
  it('sin registro disponible o sin intentos usa email_sent_at', () => {
    expect(summarizeEmailDelivery(null, { emailSentAt: '2026-10-01T00:00:00Z' })).toMatchObject({ tracked: false, last_status: 'sent' })
    expect(summarizeEmailDelivery([], {})).toMatchObject({ tracked: false, last_status: null, attempts: [] })
  })

  it('un rebote pide otra dirección', () => {
    const s = summarizeEmailDelivery([logRow({ status: 'bounced', error: 'Mailbox does not exist', events: [{ id: 'm', type: 'email.bounced', at: '2026-10-20T10:02:00Z' }] })])
    expect(s).toMatchObject({ tracked: true, last_status: 'bounced', recipient: 'bea@mail.cl', last_error: 'Mailbox does not exist' })
    expect(s.action_needed).toMatch(/otra dirección/)
    expect(s.attempts[0].provider_events).toEqual([{ type: 'email.bounced', at: '2026-10-20T10:02:00Z' }])
  })

  it('loadOrderEmailLog devuelve null si la tabla no existe', async () => {
    const db = createFakeSupabase()
    db.failOn('aitickets_email_log', 'select', { code: '42P01', message: 'no existe' })
    expect(await loadOrderEmailLog(db, ORDER)).toBeNull()
  })
})

describe('firma del webhook (Svix)', () => {
  const body = '{"type":"email.delivered"}'

  it('acepta una firma válida (también entre varias) y rechaza las inválidas', () => {
    const ts = nowSec()
    const sig = signWebhookPayload(SECRET, 'msg_1', ts, body)
    expect(verifyWebhookSignature({ secret: SECRET, id: 'msg_1', timestamp: ts, signature: `v1,${sig}`, body })).toEqual({ ok: true })
    expect(verifyWebhookSignature({ secret: SECRET, id: 'msg_1', timestamp: ts, signature: `v1,AAAA v1,${sig}`, body })).toEqual({ ok: true })
    expect(verifyWebhookSignature({ secret: SECRET, id: 'msg_1', timestamp: ts, signature: `v1,${sig}`, body: `${body} ` })).toEqual({ ok: false, reason: 'bad_signature' })
    expect(verifyWebhookSignature({ secret: SECRET, id: 'msg_2', timestamp: ts, signature: `v1,${sig}`, body })).toEqual({ ok: false, reason: 'bad_signature' })
    expect(verifyWebhookSignature({ secret: SECRET, id: 'msg_1', timestamp: ts, signature: `v2,${sig}`, body })).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('rechaza timestamps fuera de la ventana de 5 minutos y headers faltantes', () => {
    const old = String(Math.floor(Date.now() / 1000) - 6 * 60)
    const sig = signWebhookPayload(SECRET, 'msg_1', old, body)
    expect(verifyWebhookSignature({ secret: SECRET, id: 'msg_1', timestamp: old, signature: `v1,${sig}`, body })).toEqual({ ok: false, reason: 'stale_timestamp' })
    expect(verifyWebhookSignature({ secret: SECRET, id: 'msg_1', timestamp: 'abc', signature: `v1,${sig}`, body })).toEqual({ ok: false, reason: 'stale_timestamp' })
    expect(verifyWebhookSignature({ secret: SECRET, id: null, timestamp: old, signature: `v1,${sig}`, body })).toEqual({ ok: false, reason: 'missing_headers' })
  })
})

describe('POST /api/webhooks/resend', () => {
  const request = (payload, { secret = SECRET, id = 'msg_w1', ts = nowSec(), tamper = false, raw } = {}) => {
    const body = raw ?? JSON.stringify(payload)
    const sig = signWebhookPayload(secret, id, ts, body)
    return new Request('https://aitickets.cl/api/webhooks/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${tamper ? 'x' : ''}${sig}` },
      body,
    })
  }
  const call = (req) => webhookPost({ request: req })

  beforeEach(() => {
    mocks.db = createFakeSupabase({ tables: { aitickets_email_log: [logRow()] } })
  })

  it('404 si RESEND_WEBHOOK_SECRET no está configurado', async () => {
    const res = await call(request({ type: 'email.delivered', data: { email_id: 're_msg_1' } }))
    expect(res.status).toBe(404)
  })

  it('401 con firma inválida y 400 con JSON inválido', async () => {
    mocks.serverEnv.mockImplementation((name) => (name === 'RESEND_WEBHOOK_SECRET' ? SECRET : undefined))
    expect((await call(request({ type: 'email.delivered' }, { tamper: true }))).status).toBe(401)
    expect((await call(request(null, { raw: '{no es json' }))).status).toBe(400)
    expect(mocks.db.tables.aitickets_email_log[0].status).toBe('sent')
  })

  it('aplica delivered y, ante un rebote de un correo de entradas, avisa a Slack una vez', async () => {
    mocks.serverEnv.mockImplementation((name) => (name === 'RESEND_WEBHOOK_SECRET' ? SECRET : undefined))
    const ok = await call(request({ type: 'email.delivered', created_at: '2026-10-20T10:01:00Z', data: { email_id: 're_msg_1' } }))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ ok: true, applied: true })
    expect(mocks.db.tables.aitickets_email_log[0].status).toBe('delivered')
    expect(mocks.notifySlack).not.toHaveBeenCalled()

    const bounce = { type: 'email.bounced', created_at: '2026-10-20T10:02:00Z', data: { email_id: 're_msg_1', bounce: { message: 'Mailbox does not exist' } } }
    expect((await call(request(bounce, { id: 'msg_w2' }))).status).toBe(200)
    expect(mocks.db.tables.aitickets_email_log[0].status).toBe('bounced')
    expect(mocks.notifySlack).toHaveBeenCalledTimes(1)
    expect(mocks.notifySlack.mock.calls[0][0]).toContain(ORDER)
    expect(mocks.notifySlack.mock.calls[0][0]).not.toContain('bea@mail.cl')

    // Reintento de Svix con el mismo id: no se repite el aviso
    expect((await call(request(bounce, { id: 'msg_w2' }))).status).toBe(200)
    expect(mocks.notifySlack).toHaveBeenCalledTimes(1)
  })

  it('500 si la BD falla, para que Svix reintente', async () => {
    mocks.serverEnv.mockImplementation((name) => (name === 'RESEND_WEBHOOK_SECRET' ? SECRET : undefined))
    mocks.db.failOn('aitickets_email_log', 'select', { code: '08006', message: 'conexión' })
    expect((await call(request({ type: 'email.delivered', data: { email_id: 're_msg_1' } }))).status).toBe(500)
  })
})

describe('sendOrderTicketsEmail registra cada intento', () => {
  const order = {
    id: ORDER, created_at: '2026-10-01T12:00:00Z', status: 'paid', event_id: 10, attendee_id: 300, amount: 10000, ticket_fee: 800, service_fee_tax: 152,
    total_payment: 10952, ticket_details: [{ id: 5, price: 10000, quantity: 1 }], email_sent_at: null,
    buyer_first_name: 'Bea', buyer_last_name: 'Soto', buyer_email: 'bea@mail.cl',
    events: { id: 10, name: 'Fiesta', slug: 'fiesta', description: 'Una fiesta', location: 'Santiago', secret_location: null, start_date: '2026-12-01T23:00:00Z', end_date: null, organization_id: 7 },
  }
  const tables = () => ({
    event_orders: [{ ...order }],
    event_attendees: [{ id: 't1', event_order_id: ORDER, event_ticket_id: 5, qr_code: 'qr-1', status: 'active', event_tickets: { ticket_name: 'General', price: 10000, event_date_id: null } }],
    event_dates: [],
    users: [],
    aitickets_email_log: [],
  })

  it('envío exitoso (también con force) queda como sent con el id de Resend', async () => {
    mocks.db = dbWithOr({ tables: tables() })
    const r = await sendOrderTicketsEmail(ORDER, { force: true })
    expect(r).toMatchObject({ ok: true, status: 'sent' })
    expect(mocks.db.tables.aitickets_email_log).toHaveLength(1)
    expect(mocks.db.tables.aitickets_email_log[0]).toMatchObject({ kind: 'tickets', order_id: ORDER, event_id: 10, recipient: 'bea@mail.cl', provider_message_id: 're_msg_1', status: 'sent', error: null })
    // Nunca el contenido del correo ni los QR
    expect(JSON.stringify(mocks.db.tables.aitickets_email_log[0])).not.toContain('qr-1')
  })

  it('un fallo de Resend queda como failed con el error y no rompe la respuesta', async () => {
    mocks.db = dbWithOr({ tables: tables() })
    mocks.sendEmail.mockRejectedValue(new Error('Resend 422: Invalid `to` field'))
    const r = await sendOrderTicketsEmail(ORDER, { force: true })
    expect(r).toMatchObject({ ok: false, status: 'error' })
    expect(mocks.db.tables.aitickets_email_log[0]).toMatchObject({ status: 'failed', error: 'Resend 422: Invalid `to` field', provider_message_id: null })
  })

  it('sin la tabla de registro, el correo se envía igual', async () => {
    mocks.db = dbWithOr({ tables: tables() })
    mocks.db.failOn('aitickets_email_log', 'insert', { code: '42P01', message: 'no existe' })
    const r = await sendOrderTicketsEmail(ORDER, { force: true })
    expect(r).toMatchObject({ ok: true, status: 'sent' })
    expect(mocks.db.tables.event_orders[0].email_sent_at).toBeTruthy()
  })

  it('comprador sin correo válido queda como failed', async () => {
    const t = tables()
    t.event_orders[0].buyer_email = 'no-es-correo'
    mocks.db = dbWithOr({ tables: t })
    const r = await sendOrderTicketsEmail(ORDER, { force: true })
    expect(r).toMatchObject({ ok: false, status: 'error' })
    expect(mocks.sendEmail).not.toHaveBeenCalled()
    expect(mocks.db.tables.aitickets_email_log[0]).toMatchObject({ status: 'failed', recipient: 'no-es-correo' })
  })
})

describe('get_order.email_delivery y resend_tickets', () => {
  const actor = { keyId: 'k1', userId: 1, orgId: 7, role: 'producer', name: 'Ana', email: 'ana@prod.cl', scopes: ['read', 'write', 'publish', 'attendees', 'finance', 'team'], eventIds: null }
  const call = (name, args) =>
    runTool(postsaleTools.find((t) => t.name === name), args, { supabase: mocks.db, actor, origin: 'https://aitickets.test', requestUrl: new URL('https://aitickets.test/api/mcp'), channel: 'mcp' })
  const base = (logRows) => ({
    events: [{ id: 10, name: 'Fiesta', slug: 'fiesta', status: 'published', organization_id: 7, cancelled_at: null }],
    event_orders: [{ id: ORDER, event_id: 10, status: 'paid', amount: 10000, buyer_email: 'bea@mail.cl', email_sent_at: '2026-10-20T10:00:05Z', created_at: '2026-10-20T10:00:00Z' }],
    event_attendees: [],
    event_tickets: [],
    aitickets_refunds: [],
    aitickets_api_audit: [],
    ...(logRows ? { aitickets_email_log: logRows } : {}),
  })

  beforeEach(() => mocks.sendTicketsEmail.mockClear())

  it('get_order resume la entrega del correo de entradas', async () => {
    mocks.db = createFakeSupabase({ tables: base([logRow({ status: 'delivered', events: [{ id: 'm', type: 'email.delivered', at: '2026-10-20T10:01:00Z' }] })]) })
    const r = await call('get_order', { order_id: ORDER })
    expect(r.ok).toBe(true)
    expect(r.result.orders[0].email_delivery).toMatchObject({ tracked: true, last_status: 'delivered', recipient: 'bea@mail.cl' })
    expect(r.result.orders[0].tickets_email_sent_at).toBe('2026-10-20T10:00:05Z')
  })

  it('get_order funciona sin la tabla de registro (deploy preview sin migrar)', async () => {
    mocks.db = createFakeSupabase({ tables: base(null) })
    mocks.db.failOn('aitickets_email_log', 'select', { code: '42P01', message: 'no existe' })
    const r = await call('get_order', { order_id: ORDER })
    expect(r.ok).toBe(true)
    expect(r.result.orders[0].email_delivery).toMatchObject({ tracked: false, last_status: 'sent' })
  })

  it('resend_tickets advierte si el último correo rebotó, y no si se entregó', async () => {
    mocks.db = createFakeSupabase({ tables: base([logRow({ status: 'bounced', error: 'Mailbox does not exist' })]) })
    const bounced = await call('resend_tickets', { order_id: ORDER })
    expect(bounced.ok).toBe(true)
    expect(mocks.sendTicketsEmail).toHaveBeenCalledWith(expect.any(URL), ORDER, true)
    expect(bounced.result.warning).toMatch(/rebotó \(Mailbox does not exist\).*transfer_ticket/)

    mocks.db = createFakeSupabase({ tables: base([logRow({ status: 'delivered' })]) })
    const delivered = await call('resend_tickets', { order_id: ORDER })
    expect(delivered.ok).toBe(true)
    expect(delivered.result.warning).toBeUndefined()
  })
})
