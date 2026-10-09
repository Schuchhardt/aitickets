// API de productores: comunicación con asistentes (mensajes/recordatorios), ciclo de vida del evento
// (duplicar, archivar, eliminar, editar lugar) y auditoría/exportación. Sin red ni BD.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
const internalCalls = []
const sentEmails = []
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))
vi.mock('../../src/pages/api/_lib/server-utils', async (importOriginal) => ({
  ...(await importOriginal()),
  callInternalFunction: async (_url, path, body) => {
    internalCalls.push({ path, body })
    return { ok: true, status: 202, data: null }
  },
  notifySlack: async () => {},
}))
vi.mock('../../netlify/lib/mailer.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  sendEmail: async (msg) => {
    sentEmails.push(msg)
    return { id: `m${sentEmails.length}` }
  },
}))
vi.mock('../../src/lib/eventDuplicate', () => ({
  DUPLICATE_SOURCE_COLUMNS: 'id, name',
  duplicateEventAsDraft: async (supabase, source, opts) => {
    const { data } = await supabase.from('events').insert({ name: opts.name || `${source.name} (copia)`, status: 'draft', slug: 'copia-1', organization_id: opts.organizationId }).select('id').single()
    return { id: data.id, slug: 'copia-1', name: opts.name || `${source.name} (copia)`, locationIds: ['loc-new'] }
  },
}))

const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { messagingTools } = await import('../../src/lib/producer-api/tools/messaging.ts')
const { lifecycleTools } = await import('../../src/lib/producer-api/tools/lifecycle.ts')
const { auditTools } = await import('../../src/lib/producer-api/tools/audit.ts')
const { eventTools } = await import('../../src/lib/producer-api/tools/events.ts')
const { deliverScheduledMessage } = await import('../../netlify/lib/scheduled-messages.mjs')
const exportRoute = await import('../../src/pages/api/exports/orders.ts')
const { verifyExportToken, signExportToken } = await import('../../src/lib/ordersExport.ts')

const tools = Object.fromEntries([...messagingTools, ...lifecycleTools, ...auditTools, ...eventTools].map((t) => [t.name, t]))
const FUTURE_DAY = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10)
const PAST = new Date(Date.now() - 10 * 86400_000).toISOString()

function seed() {
  db = createFakeSupabase({
    unique: { aitickets_api_idempotency: [['organization_id', 'tool', 'idem_key']] },
    tables: {
      organizations: [{ id: 7, public_name: 'Mi Productora', email: 'hola@prod.cl' }],
      users: [
        { id: 1, name: 'Ana', email: 'ana@prod.cl', organization_id: 7, role: 'producer', active: true },
        { id: 2, name: 'Fin', email: 'fin@prod.cl', organization_id: 7, role: 'finance', active: true },
      ],
      events: [
        { id: 10, name: 'Fiesta', slug: 'fiesta', status: 'published', organization_id: 7, location: 'Club', end_date: new Date(Date.now() + 11 * 86400_000).toISOString() },
        { id: 11, name: 'Pasado', slug: 'pasado', status: 'published', organization_id: 7, end_date: PAST },
        { id: 12, name: 'Borrador', slug: 'borr', status: 'draft', organization_id: 7 },
        { id: 20, name: 'Ajeno', slug: 'ajeno', status: 'published', organization_id: 8 },
      ],
      event_dates: [{ id: 501, event_id: 10, date: FUTURE_DAY, start_time: '21:00:00', end_time: null, event_locations: { venues: { name: 'Club Uno', address_line1: 'Calle 1', city: 'Santiago' } } }],
      event_attendees: [
        { id: 'a1', event_id: 10, status: 'active', event_order_id: 'o1', attendees: { id: 1, first_name: 'Pía', last_name: 'R', email: 'pia@x.cl' } },
        { id: 'a2', event_id: 10, status: 'validated', event_order_id: 'o1', attendees: { id: 1, first_name: 'Pía', last_name: 'R', email: 'PIA@x.cl' } },
        { id: 'a3', event_id: 10, status: 'validated', event_order_id: 'o2', attendees: { id: 2, first_name: 'Juan', last_name: 'P', email: 'juan@x.cl' } },
        { id: 'a4', event_id: 10, status: 'cancelled', event_order_id: 'o3', attendees: { id: 3, first_name: 'Ex', last_name: '', email: 'ex@x.cl' } },
      ],
      event_orders: [
        { id: 'o1', event_id: 10, status: 'paid', created_at: '2026-10-01T15:00:00Z', amount: 20000, ticket_fee: 1600, service_fee_tax: 304, total_payment: 21904, ticket_qty: 2, ticket_details: [{ name: 'General', quantity: 2 }], buyer_first_name: 'Pía', buyer_email: 'pia@x.cl', payment_provider: 'flow', fee_absorbed: false },
        { id: 'o2', event_id: 10, status: 'refunded', created_at: '2026-10-02T15:00:00Z', amount: 9048, ticket_fee: 800, service_fee_tax: 152, total_payment: 10000, ticket_qty: 1, ticket_details: [{ name: 'General', quantity: 1 }], buyer_first_name: 'Juan', buyer_email: 'juan@x.cl', payment_provider: 'flow', fee_absorbed: true },
        { id: 'o9', event_id: 20, status: 'paid', created_at: '2026-10-02T15:00:00Z', amount: 5000, ticket_fee: 400, total_payment: 5476, ticket_qty: 1 },
      ],
      event_tickets: [{ id: 300, event_id: 12, ticket_name: 'General' }],
      event_locations: [],
      event_withdrawals: [],
      aitickets_scheduled_messages: [],
      aitickets_api_confirmations: [],
      aitickets_api_idempotency: [],
      aitickets_api_audit: [
        { id: 1, organization_id: 7, user_id: 1, tool: 'set_event_status', channel: 'mcp', ok: true, event_id: 10, summary: 'Publicado', created_at: '2026-10-03T12:00:00Z' },
        { id: 2, organization_id: 8, user_id: 9, tool: 'set_event_status', channel: 'mcp', ok: true, event_id: 20, created_at: '2026-10-03T13:00:00Z' },
      ],
      aitickets_payouts: [{ id: 'p1', organization_id: 7, amount: 50000, status: 'paid', requested_by: 2, requested_via: 'mcp', created_at: '2026-10-04T12:00:00Z', paid_at: '2026-10-06T12:00:00Z' }],
      aitickets_refunds: [{ id: 'r1', organization_id: 7, event_id: 10, order_id: 'o2', kind: 'full', total_amount: 10000, status: 'requested', source: 'refund_order', requested_by: 1, requested_via: 'mcp', created_at: '2026-10-05T12:00:00Z' }],
      aitickets_event_preview_links: [],
      notification_log: [],
      venues: [
        { id: '11111111-1111-1111-1111-111111111111', name: 'Club Uno', organization_id: 7 },
        { id: '22222222-2222-2222-2222-222222222222', name: 'Compartido', organization_id: null },
      ],
    },
  })
}

const ctx = (role = 'producer', userId = 1, scopes = ['read', 'write', 'publish', 'attendees', 'finance', 'team']) => ({
  supabase: db,
  actor: { keyId: 'k1', userId, orgId: 7, role, name: 'Ana', email: 'ana@prod.cl', scopes, eventIds: null },
  origin: 'https://aitickets.test',
  requestUrl: new URL('https://aitickets.test/api/mcp'),
  channel: 'mcp',
})
const call = (name, args, c = ctx()) => runTool(tools[name], args, c)

beforeEach(() => {
  seed()
  internalCalls.length = 0
  sentEmails.length = 0
  vi.stubEnv('INTERNAL_API_SECRET', 'secreto-de-prueba-0123456789')
})

describe('send_attendee_message', () => {
  it('pide confirmación con el conteo de destinatarios y luego envía', async () => {
    const args = { event_id: 10, subject: 'Cambio de hora', message: 'Ahora empezamos a las 22:00.' }
    const first = await call('send_attendee_message', args)
    expect(first.ok).toBe(true)
    expect(first.result.status).toBe('confirmation_required')
    expect(first.result.details.recipients_now).toBe(2) // pia (dedupe) + juan; la anulada no
    expect(db.tables.aitickets_scheduled_messages).toHaveLength(0)

    const second = await call('send_attendee_message', { ...args, confirmation_token: first.result.confirmation_token })
    expect(second.ok).toBe(true)
    expect(second.result.message.status).toBe('sending')
    expect(db.tables.aitickets_scheduled_messages[0]).toMatchObject({ kind: 'message', status: 'sending', organization_id: 7, created_by: 1 })
    expect(internalCalls[0].path).toBe('/.netlify/functions/send-scheduled-messages-background')

    // Reintento con el mismo token: misma respuesta, sin otro mensaje
    const again = await call('send_attendee_message', { ...args, confirmation_token: first.result.confirmation_token })
    expect(again.result.idempotent_replay).toBe(true)
    expect(db.tables.aitickets_scheduled_messages).toHaveLength(1)
  })

  it('solo a quienes no han ingresado', async () => {
    const r = await call('send_attendee_message', { event_id: 10, subject: 'Te esperamos', message: 'La puerta abre a las 21.', audience: 'not_checked_in' })
    expect(r.result.details.recipients_now).toBe(1)
  })

  it('tope de mensajes por evento', async () => {
    for (let i = 0; i < 5; i++) db.tables.aitickets_scheduled_messages.push({ id: `m${i}`, event_id: 10, kind: 'message', status: 'sent', created_at: new Date().toISOString() })
    const r = await call('send_attendee_message', { event_id: 10, subject: 'Otro', message: 'Otro mensaje más.' })
    expect(r).toMatchObject({ ok: false, code: 'rate_limited' })
  })

  it('el rol de finanzas no puede enviar mensajes', async () => {
    const r = await call('send_attendee_message', { event_id: 10, subject: 'Hola', message: 'Mensaje de prueba.' }, ctx('finance', 2))
    expect(r).toMatchObject({ ok: false, code: 'forbidden' })
  })

  it('no permite eventos de otra organización', async () => {
    const r = await call('send_attendee_message', { event_id: 20, subject: 'Hola', message: 'Mensaje de prueba.' })
    expect(r).toMatchObject({ ok: false, code: 'not_found' })
  })
})

describe('schedule_reminder y cancelación', () => {
  it('por defecto: el día de la función a las 10:00 de Chile, con texto estándar', async () => {
    const first = await call('schedule_reminder', { event_id: 10 })
    expect(first.result.status).toBe('confirmation_required')
    const r = await call('schedule_reminder', { event_id: 10, confirmation_token: first.result.confirmation_token })
    expect(r.ok).toBe(true)
    const row = db.tables.aitickets_scheduled_messages[0]
    expect(row).toMatchObject({ kind: 'reminder', status: 'scheduled' })
    const local = new Date(row.send_at).toLocaleString('en-CA', { timeZone: 'America/Santiago', hour12: false })
    expect(local).toContain(FUTURE_DAY)
    expect(local).toMatch(/10:00/)
    expect(row.body).toContain('Club Uno')
    expect(internalCalls).toHaveLength(0)

    const missing = await call('cancel_scheduled_message', { message_id: '44444444-4444-4444-4444-444444444444' })
    expect(missing).toMatchObject({ ok: false, code: 'not_found' })

    row.id = '33333333-3333-3333-3333-333333333333'
    const ok = await call('cancel_scheduled_message', { message_id: row.id })
    expect(ok.result.status).toBe('cancelled')
    expect(row.status).toBe('cancelled')
  })

  it('rechaza un envío que ya pasó o después del inicio', async () => {
    const r = await call('schedule_reminder', { event_id: 10, send_at: new Date(Date.now() - 3600_000).toISOString() })
    expect(r).toMatchObject({ ok: false, code: 'invalid_input' })
    const late = await call('schedule_reminder', { event_id: 10, send_at: `${FUTURE_DAY}T23:59:00-03:00` })
    expect(late).toMatchObject({ ok: false, code: 'invalid_input' })
  })
})

describe('deliverScheduledMessage', () => {
  it('envía por lotes, deja status sent y registra notification_log', async () => {
    const msg = { id: 'msg-1', organization_id: 7, event_id: 10, kind: 'message', subject: 'Hola <b>', body: 'Línea 1\n<script>x</script>', audience: 'all', status: 'sending' }
    db.tables.aitickets_scheduled_messages.push({ ...msg })
    const r = await deliverScheduledMessage(db, msg)
    expect(r).toMatchObject({ status: 'sent', sent: 2, failed: 0 })
    expect(sentEmails[0].to).toHaveLength(2)
    expect(sentEmails[0].html).not.toContain('<script>')
    expect(sentEmails[0].replyTo).toBe('hola@prod.cl')
    expect(db.tables.aitickets_scheduled_messages[0]).toMatchObject({ status: 'sent', recipients_count: 2, failed_count: 0 })
    expect(db.tables.notification_log).toHaveLength(2)
  })
})

describe('ciclo de vida', () => {
  it('archive_event: no archiva un publicado vigente; sí uno pasado; list_events lo oculta', async () => {
    expect(await call('archive_event', { event_id: 10 })).toMatchObject({ ok: false, code: 'conflict' })
    const r = await call('archive_event', { event_id: 11 })
    expect(r.result.archived).toBe(true)
    const list = await call('list_events', {})
    expect(list.result.events.map((e) => e.id)).not.toContain(11)
    const all = await call('list_events', { include_archived: true })
    expect(all.result.events.find((e) => e.id === 11).archived).toBe(true)
    const un = await call('archive_event', { event_id: 11, archived: false })
    expect(un.result.archived).toBe(false)
  })

  it('delete_event: rechaza con órdenes y borra un borrador limpio tras confirmar', async () => {
    db.tables.events.find((e) => e.id === 10).status = 'draft'
    expect(await call('delete_event', { event_id: 10 })).toMatchObject({ ok: false, code: 'conflict' })

    const first = await call('delete_event', { event_id: 12 })
    expect(first.result.details.ticket_types).toBe(1)
    expect(db.tables.events.some((e) => e.id === 12)).toBe(true)
    const r = await call('delete_event', { event_id: 12, confirmation_token: first.result.confirmation_token })
    expect(r.result.deleted).toBe(true)
    expect(db.tables.events.some((e) => e.id === 12)).toBe(false)
    expect(db.tables.event_tickets).toHaveLength(0)
  })

  it('duplicate_event crea el borrador con la nueva función', async () => {
    const r = await call('duplicate_event', { event_id: 11, date: FUTURE_DAY, start_time: '20:00' })
    expect(r.ok).toBe(true)
    expect(r.result).toMatchObject({ status: 'draft', function_created: true, is_published: false })
    expect(db.tables.event_dates.find((d) => d.event_id === r.result.event_id)).toMatchObject({ start_time: '20:00', event_location_id: 'loc-new' })
    expect(await call('duplicate_event', { event_id: 11, date: FUTURE_DAY })).toMatchObject({ ok: false, code: 'invalid_input' })
  })

  it('update_venue: edita un lugar propio y rechaza uno compartido con otra organización', async () => {
    db.tables.event_locations.push(
      { id: 'l1', event_id: 10, venue_id: '11111111-1111-1111-1111-111111111111', events: { organization_id: 7 }, 'events.organization_id': 7 },
      { id: 'l2', event_id: 10, venue_id: '22222222-2222-2222-2222-222222222222', events: { organization_id: 7 }, 'events.organization_id': 7 },
      { id: 'l3', event_id: 20, venue_id: '22222222-2222-2222-2222-222222222222', events: { organization_id: 8 }, 'events.organization_id': 8 },
    )
    const r = await call('update_venue', { venue_id: '11111111-1111-1111-1111-111111111111', address: 'Av. Nueva 123', city: 'Ñuñoa' })
    expect(r.ok).toBe(true)
    expect(db.tables.venues[0]).toMatchObject({ address_line1: 'Av. Nueva 123', city: 'Ñuñoa' })
    const shared = await call('update_venue', { venue_id: '22222222-2222-2222-2222-222222222222', name: 'Otro nombre' })
    expect(shared).toMatchObject({ ok: false, code: 'conflict' })
  })
})

describe('auditoría y exportación', () => {
  it('list_audit_log une acciones de la API con retiros y reembolsos, solo de la organización', async () => {
    const r = await call('list_audit_log', {}, ctx('finance', 2))
    expect(r.ok).toBe(true)
    const actions = r.result.entries.map((e) => e.action)
    expect(actions).toEqual(['payout_paid', 'refund_requested', 'payout_requested', 'set_event_status'])
    expect(r.result.entries.find((e) => e.action === 'payout_requested').user).toBe('Fin')
    expect(r.result.entries.find((e) => e.action === 'set_event_status').user).toBe('Ana')
  })

  it('list_audit_log no está disponible para marketing', async () => {
    expect(await call('list_audit_log', {}, ctx('editor'))).toMatchObject({ ok: false, code: 'forbidden' })
  })

  it('export_orders: totales, CSV pequeño en línea y link firmado que descarga', async () => {
    const r = await call('export_orders', {})
    expect(r.ok).toBe(true)
    expect(r.result.row_count).toBe(2) // la orden de otra organización no aparece
    expect(r.result.totals).toMatchObject({ orders: 2, total_paid_clp: 31904, producer_net_clp: 20000, refunded_clp: 10000 })
    expect(r.result.csv).toContain('Neto productor')
    const lines = r.result.csv.split('\r\n')
    expect(lines[2]).toContain('Reembolsada')
    expect(lines[2]).toContain(';10000;') // subtotal de lista con cargo absorbido
    const token = new URL(r.result.download_url).searchParams.get('token')
    expect(verifyExportToken(token)).toMatchObject({ org: 7, uid: 1, events: null })

    const res = await exportRoute.GET({ url: new URL(r.result.download_url) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(await res.text()).toContain('pia@x.cl')
  })

  it('el link vencido o de un usuario sin acceso no descarga', async () => {
    const { token } = signExportToken({ org: 7, uid: 1, events: null, from: null, to: null }, Date.now() - 3600_000)
    expect((await exportRoute.GET({ url: new URL(`https://aitickets.test/api/exports/orders?token=${token}`) })).status).toBe(410)
    const fresh = signExportToken({ org: 7, uid: 1, events: null, from: null, to: null })
    db.tables.users[0].active = false
    expect((await exportRoute.GET({ url: new URL(`https://aitickets.test/api/exports/orders?token=${fresh.token}`) })).status).toBe(403)
  })
})
