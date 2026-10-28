// Invitación masiva al próximo evento: destinatarios (planInvitation), envío (deliverInvitation vía la cola de
// mensajes del productor) y la herramienta invite_past_attendees de la API de productores.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(async () => ({ id: 'mail' })),
  callInternalFunction: vi.fn(async () => ({ ok: true, status: 202, data: {} })),
}))
vi.mock('../../netlify/lib/mailer.mjs', async (importOriginal) => ({ ...(await importOriginal()), sendEmail: mocks.sendEmail }))
vi.mock('../../src/pages/api/_lib/server-utils', () => ({ callInternalFunction: mocks.callInternalFunction }))

const { planInvitation, deliverInvitation, invitationEventUrl } = await import('../../netlify/lib/invitations.mjs')
const { deliverScheduledMessage } = await import('../../netlify/lib/scheduled-messages.mjs')
const { verifyInviteOptoutToken } = await import('../../netlify/lib/review-token.mjs')
const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { reviewTools } = await import('../../src/lib/producer-api/tools/reviews.ts')

const NOW = new Date('2026-10-20T12:00:00Z')
const holder = (id, eventId, email, status = 'active', validated_at = null) => ({
  id: `ea-${eventId}-${id}`,
  event_id: eventId,
  status,
  validated_at,
  attendees: { id, first_name: email.split('@')[0], last_name: 'Test', email },
  event_orders: null,
})

let db
beforeEach(() => {
  vi.stubEnv('REVIEW_TOKEN_SECRET', 'test-secret')
  mocks.sendEmail.mockClear()
  mocks.callInternalFunction.mockClear()
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Prod SpA', email: 'hola@prod.cl' }, { id: 8, public_name: 'Otra' }],
      events: [
        { id: 10, name: 'Show pasado', slug: 'show-pasado', status: 'published', organization_id: 7 },
        { id: 20, name: 'Próximo show', slug: 'proximo', status: 'published', organization_id: 7, image_url: 'https://img.cl/p.jpg' },
        { id: 21, name: 'Borrador', slug: 'borrador', status: 'draft', organization_id: 7 },
        { id: 22, name: 'Ya fue', slug: 'ya-fue', status: 'published', organization_id: 7 },
        { id: 23, name: 'Cancelado', slug: 'cancelado', status: 'published', organization_id: 7, cancelled_at: '2026-10-01T00:00:00Z' },
        { id: 30, name: 'Ajeno', slug: 'ajeno', status: 'published', organization_id: 8 },
      ],
      event_dates: [
        { id: 201, event_id: 20, date: '2026-11-07', start_time: '21:00', end_time: null, event_locations: { display_name: 'Teatro Sur', venues: { name: 'Teatro Sur', city: 'Santiago' } } },
        { id: 221, event_id: 22, date: '2026-10-01', start_time: '21:00', end_time: null },
        { id: 231, event_id: 23, date: '2026-11-07', start_time: '21:00', end_time: null },
      ],
      event_attendees: [
        holder(1, 10, 'ana@x.cl', 'validated', '2026-10-10T23:00:00Z'),
        holder(2, 10, 'beto@x.cl'),
        holder(3, 10, 'caro@x.cl', 'validated'),
        holder(4, 10, 'dani@x.cl'),
        holder(5, 10, 'eli@x.cl'),
        holder(6, 10, 'fran@x.cl', 'cancelled'),
        // Caro ya compró para el próximo
        holder(3, 20, 'CARO@x.cl'),
      ],
      aitickets_event_reviews: [
        { id: 'r1', event_id: 10, email: 'ana@x.cl', rating: 5 },
        { id: 'r2', event_id: 10, email: 'beto@x.cl', rating: 2 },
      ],
      aitickets_org_email_optouts: [{ organization_id: 7, email: 'dani@x.cl' }],
      notification_log: [{ id: 1, event_id: 20, attendee_id: 5, type: 'next_event_invite' }],
      aitickets_scheduled_messages: [],
    },
  })
})

const plan = (args) => planInvitation(db, { organizationId: 7, sourceEventId: 10, targetEventId: 20, now: NOW, ...args })

describe('planInvitation', () => {
  it('excluye bajas, ya invitados, entradas anuladas y quienes ya compraron el evento destino', async () => {
    const p = await plan({ audience: 'all' })
    expect(p.recipients.map((r) => r.email).sort()).toEqual(['ana@x.cl', 'beto@x.cl'])
    expect(p.counts).toEqual({ attendees: 5, recipients: 2, opted_out: 1, already_have_tickets: 1, already_invited: 1 })
  })
  it('audiencias', async () => {
    expect((await plan({ audience: 'promoters' })).recipients.map((r) => r.email)).toEqual(['ana@x.cl'])
    expect((await plan({ audience: 'reviewers' })).recipients.map((r) => r.email).sort()).toEqual(['ana@x.cl', 'beto@x.cl'])
    expect((await plan({ audience: 'checked_in' })).recipients.map((r) => r.email)).toEqual(['ana@x.cl'])
  })
  it('rechaza el mismo evento, borradores, cancelados, terminados y eventos de otra organización', async () => {
    await expect(plan({ targetEventId: 10 })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(plan({ targetEventId: 21 })).rejects.toMatchObject({ code: 'conflict' })
    await expect(plan({ targetEventId: 22 })).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('terminó') })
    await expect(plan({ targetEventId: 23 })).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('cancelado') })
    await expect(plan({ targetEventId: 30 })).rejects.toMatchObject({ code: 'not_found' })
    await expect(plan({ audience: 'todos' })).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('deliverInvitation', () => {
  const message = { id: 'm1', organization_id: 7, event_id: 10, target_event_id: 20, kind: 'invitation', audience: 'all', subject: 'Prod SpA te invita a Próximo show', body: '¡Vuelve!' }

  it('un correo por persona con enlace de baja, List-Unsubscribe y UTM; registra para no repetir', async () => {
    const result = await deliverInvitation(db, message, { now: NOW })
    expect(result).toEqual({ sent: 2, failed: 0, total: 2 })
    const [args] = mocks.sendEmail.mock.calls[0]
    expect(args.replyTo).toBe('hola@prod.cl')
    expect(args.headers['List-Unsubscribe']).toBe('<%recipient.unsubscribe_one_click%>')
    expect(args.html).toContain('%recipient.unsubscribe_url%')
    expect(args.html).toContain(invitationEventUrl('proximo', 10).replace(/&/g, '&amp;'))
    expect(args.html).toContain('¡Vuelve!')
    const vars = args.recipientVariables['ana@x.cl']
    const token = decodeURIComponent(vars.unsubscribe_url.text.split('t=')[1])
    expect(verifyInviteOptoutToken(token)).toEqual({ organizationId: 7, email: 'ana@x.cl' })
    expect(vars.unsubscribe_one_click.text).toMatch(/^https:\/\/aitickets\.cl\/api\/invitaciones\/baja\?t=/)
    const logged = db.tables.notification_log.filter((l) => l.type === 'next_event_invite' && l.event_id === 20).map((l) => l.attendee_id).sort()
    expect(logged).toEqual([1, 2, 5])
    // Repetir el mismo envío no vuelve a escribirles
    mocks.sendEmail.mockClear()
    expect(await deliverInvitation(db, { ...message, id: 'm2' }, { now: NOW })).toEqual({ sent: 0, failed: 0, total: 0 })
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })

  it('sin secreto de firma no envía publicidad sin enlace de baja', async () => {
    vi.stubEnv('REVIEW_TOKEN_SECRET', '')
    const result = await deliverInvitation(db, message, { now: NOW })
    expect(mocks.sendEmail).not.toHaveBeenCalled()
    expect(result.sent).toBe(0)
    expect(result.error).toMatch(/secreto/)
  })

  it('la cola de mensajes entrega las invitaciones y deja el estado final', async () => {
    db.tables.aitickets_scheduled_messages.push({ ...message, status: 'sending' })
    const result = await deliverScheduledMessage(db, { ...message, target_event_id: undefined })
    expect(result).toMatchObject({ status: 'sent', sent: 2, failed: 0 })
    expect(db.tables.aitickets_scheduled_messages[0]).toMatchObject({ status: 'sent', recipients_count: 2, failed_count: 0 })
  })
})

describe('herramientas de la API de productores', () => {
  const actor = { keyId: 'k1', userId: 1, orgId: 7, role: 'producer', name: 'Ana', email: 'ana@prod.cl', scopes: ['read', 'write', 'publish', 'attendees'], eventIds: null }
  const ctx = () => ({ supabase: db, actor, origin: 'https://aitickets.test', requestUrl: new URL('https://aitickets.test/api/mcp'), channel: 'mcp' })
  const tool = (name) => reviewTools.find((t) => t.name === name)

  it('invite_past_attendees pide confirmación con el conteo y luego encola y despacha', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    db.tables.aitickets_api_confirmations = []
    const args = { event_id: 10, target_event_id: 20, audience: 'all', message: '¡Vuelve!' }
    const first = await runTool(tool('invite_past_attendees'), args, ctx())
    expect(first.ok).toBe(true)
    expect(first.result.status).toBe('confirmation_required')
    expect(first.result.summary).toContain('2 asistente(s)')
    const second = await runTool(tool('invite_past_attendees'), { ...args, confirmation_token: first.result.confirmation_token }, ctx())
    expect(second.ok).toBe(true)
    expect(second.result).toMatchObject({ recipients: 2, status: 'sending' })
    const [row] = db.tables.aitickets_scheduled_messages
    expect(row).toMatchObject({ kind: 'invitation', event_id: 10, target_event_id: 20, audience: 'all', subject: 'Prod SpA te invita a Próximo show', body: '¡Vuelve!', created_via: 'mcp' })
    expect(mocks.callInternalFunction).toHaveBeenCalledWith(expect.any(URL), '/.netlify/functions/send-scheduled-messages-background', { messageId: row.id })
  })

  it('update_review_settings y list_event_reviews', async () => {
    const updated = await runTool(tool('update_review_settings'), { event_id: 10, reward_percent: 20, moderate_photos: true }, ctx())
    expect(updated.ok).toBe(true)
    expect(updated.result.settings).toEqual({ enabled: true, reward: { value: 20, valid_days: 60 }, moderate_photos: true, show_while_on_sale: false })
    const removed = await runTool(tool('update_review_settings'), { event_id: 10, reward_percent: 0 }, ctx())
    expect(removed.result.settings.reward).toBeNull()
    db.tables.aitickets_event_review_photos = [{ id: 'p1', event_id: 10, status: 'pending' }]
    const list = await runTool(tool('list_event_reviews'), { event_id: 10, max_rating: 2 }, ctx())
    expect(list.ok).toBe(true)
    expect(list.result.summary).toMatchObject({ count: 2, average: 3.5 })
    expect(list.result.reviews.map((r) => r.email)).toEqual(['beto@x.cl'])
    expect(list.result.photos).toEqual({ total: 1, visible: 0, pending_review: 1 })
  })

  it('otra organización no puede leer las reseñas', async () => {
    const res = await runTool(tool('list_event_reviews'), { event_id: 30 }, ctx())
    expect(res.ok).toBe(false)
    expect(res.code).toBe('not_found')
  })
})
