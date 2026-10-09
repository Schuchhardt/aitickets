// API de productores, categoría "asistentes y acceso": list_attendees, check_in_attendee, get_checkin_stats,
// links de escáner de puerta (create/list/revoke) y las rutas sin cuenta /api/door/<token>/*.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))

const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { accessTools } = await import('../../src/lib/producer-api/tools/access.ts')
const checkinAccess = await import('../../src/lib/checkinAccess.ts')
const doorConfirm = await import('../../src/pages/api/door/[token]/confirm.ts')
const doorValidate = await import('../../src/pages/api/door/[token]/validate.ts')
const doorAttendees = await import('../../src/pages/api/door/[token]/attendees.ts')

const tool = (name) => accessTools.find((t) => t.name === name)
const sha = (v) => createHash('sha256').update(v).digest('hex')

const T1 = '11111111-1111-4111-8111-111111111111'
const T2 = '22222222-2222-4222-8222-222222222222'
const T3 = '33333333-3333-4333-8333-333333333333'
const T9 = '99999999-9999-4999-8999-999999999999'

function seed() {
  db = createFakeSupabase({
    tables: {
      events: [
        { id: 10, name: 'Fiesta', slug: 'fiesta', organization_id: 7, capacity: 100, end_date: '2026-11-02T05:00:00Z' },
        { id: 11, name: 'Otra', slug: 'otra', organization_id: 7, capacity: 50 },
        { id: 20, name: 'Ajeno', slug: 'ajeno', organization_id: 8 },
      ],
      event_tickets: [
        { id: 100, event_id: 10, ticket_name: 'General', event_date_id: null, total_quantity: 80 },
        { id: 101, event_id: 10, ticket_name: 'VIP', event_date_id: 500, total_quantity: 20 },
      ],
      event_dates: [{ id: 500, event_id: 10, date: '2026-11-01', start_time: '22:00:00', end_time: '04:00:00' }],
      event_attendees: [
        { id: T1, event_id: 10, event_ticket_id: 100, qr_code: 'qr-one', status: 'active', created_at: '2026-10-01T00:00:00Z', is_complimentary: false, event_order_id: 'o1', attendees: { first_name: 'Ana', last_name: 'Pérez', email: 'ana@x.cl' }, event_tickets: { ticket_name: 'General', event_date_id: null } },
        { id: T2, event_id: 10, event_ticket_id: 101, qr_code: 'qr-two', status: null, created_at: '2026-10-02T00:00:00Z', is_complimentary: true, event_order_id: 'o2', attendees: { first_name: 'Beto', last_name: 'Soto', email: 'beto@x.cl' }, event_tickets: { ticket_name: 'VIP', event_date_id: 500 } },
        { id: T3, event_id: 10, event_ticket_id: 100, qr_code: 'qr-three', status: 'cancelled', created_at: '2026-10-03T00:00:00Z', is_complimentary: false, attendees: { first_name: 'Ceci', last_name: '', email: 'c@x.cl' }, event_tickets: { ticket_name: 'General', event_date_id: null } },
        { id: T9, event_id: 20, event_ticket_id: 999, qr_code: 'qr-ajeno', status: 'active', attendees: { first_name: 'Z' } },
      ],
      aitickets_checkin_links: [],
      aitickets_api_audit: [],
    },
  })
}

const ctx = (over = {}) => ({
  supabase: db,
  actor: { keyId: 'k', userId: 1, orgId: 7, role: 'producer', name: 'Ana', email: 'a@p.cl', scopes: ['read', 'write', 'publish', 'attendees'], eventIds: null, ...over },
  origin: 'https://aitickets.test',
  requestUrl: new URL('https://aitickets.test/api/mcp'),
  channel: 'mcp',
})

beforeEach(seed)

describe('list_attendees', () => {
  it('lista con filtros y no ve eventos de otra organización', async () => {
    const all = await runTool(tool('list_attendees'), { event_id: 10 }, ctx())
    expect(all.ok).toBe(true)
    expect(all.result.total).toBe(3)
    expect(all.result.attendees.find((a) => a.ticket_id === T2)).toMatchObject({ status: 'active', complimentary: true, function: { id: 500 } })
    expect(all.result.attendees.find((a) => a.ticket_id === T3).status).toBe('cancelled')

    const pending = await runTool(tool('list_attendees'), { event_id: 10, checked_in: false }, ctx())
    expect(pending.result.attendees.map((a) => a.ticket_id).sort()).toEqual([T1, T2])

    const search = await runTool(tool('list_attendees'), { event_id: 10, search: 'beto@' }, ctx())
    expect(search.result.attendees.map((a) => a.ticket_id)).toEqual([T2])

    const byFn = await runTool(tool('list_attendees'), { event_id: 10, function_id: 500 }, ctx())
    expect(byFn.result.attendees.map((a) => a.ticket_id)).toEqual([T2])

    const foreign = await runTool(tool('list_attendees'), { event_id: 20 }, ctx())
    expect(foreign).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('respeta los permisos por rol y el acceso por evento', async () => {
    expect(await runTool(tool('list_attendees'), { event_id: 10 }, ctx({ role: 'viewer' }))).toMatchObject({ ok: false, code: 'forbidden' })
    // Puerta controla el acceso pero no lista datos de compradores
    expect(await runTool(tool('list_attendees'), { event_id: 10 }, ctx({ role: 'validator' }))).toMatchObject({ ok: false, code: 'forbidden' })
    expect((await runTool(tool('list_attendees'), { event_id: 10 }, ctx({ role: 'editor' }))).ok).toBe(true)
    expect(await runTool(tool('list_attendees'), { event_id: 10 }, ctx({ role: 'editor', eventIds: [11] }))).toMatchObject({ ok: false, code: 'forbidden' })
  })
})

describe('check_in_attendee', () => {
  it('marca el ingreso una sola vez (por id y por QR, incluido status NULL)', async () => {
    const first = await runTool(tool('check_in_attendee'), { event_id: 10, ticket_id: T1 }, ctx({ role: 'validator' }))
    expect(first.ok).toBe(true)
    expect(db.tables.event_attendees.find((a) => a.id === T1).status).toBe('validated')

    const again = await runTool(tool('check_in_attendee'), { event_id: 10, ticket_id: T1 }, ctx())
    expect(again).toMatchObject({ ok: false, code: 'conflict' })
    expect(again.message).toMatch(/ya ingresó/)

    const byQr = await runTool(tool('check_in_attendee'), { event_id: 10, qr_code: 'qr-two' }, ctx())
    expect(byQr.ok).toBe(true)
    expect(byQr.result.holder).toBe('Beto Soto')
    expect(db.tables.event_attendees.find((a) => a.id === T2).status).toBe('validated')
    expect(db.tables.aitickets_api_audit.at(-1)).toMatchObject({ tool: 'check_in_attendee', ok: true })
  })

  it('rechaza anuladas, entradas de otro evento y argumentos ambiguos', async () => {
    expect(await runTool(tool('check_in_attendee'), { event_id: 10, ticket_id: T3 }, ctx())).toMatchObject({ ok: false, code: 'conflict' })
    expect(await runTool(tool('check_in_attendee'), { event_id: 10, ticket_id: T9 }, ctx())).toMatchObject({ ok: false, code: 'not_found' })
    expect(await runTool(tool('check_in_attendee'), { event_id: 10 }, ctx())).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(await runTool(tool('check_in_attendee'), { event_id: 10, ticket_id: T1 }, ctx({ role: 'finance' }))).toMatchObject({ ok: false, code: 'forbidden' })
    expect(db.tables.event_attendees.find((a) => a.id === T9).status).toBe('active')
  })
})

describe('get_checkin_stats', () => {
  it('cuenta emitidas, ingresadas, aforo y llegadas recientes', async () => {
    const now = new Date()
    db.tables.event_attendees[0].status = 'validated'
    db.tables.event_attendees[0].validated_at = new Date(now.getTime() - 10 * 60_000).toISOString()
    const res = await runTool(tool('get_checkin_stats'), { event_id: 10 }, ctx())
    expect(res.ok).toBe(true)
    expect(res.result).toMatchObject({ issued: 2, checked_in: 1, pending: 1, cancelled: 1, capacity: 100, occupancy_pct: 1 })
    expect(res.result.arrivals_last_3h).toHaveLength(12)
    expect(res.result.arrivals_last_3h.reduce((s, b) => s + b.count, 0)).toBe(1)
    expect(res.result.by_function.find((f) => f.function.id === 500)).toMatchObject({ issued: 1, checked_in: 0 })
  })
})

describe('links de escáner de puerta', () => {
  it('crea (solo guarda el hash), lista y revoca', async () => {
    const res = await runTool(tool('create_checkin_link'), { event_id: 10, label: 'Puerta norte' }, ctx({ role: 'editor' }))
    expect(res.ok).toBe(true)
    const token = res.result.scanner_url.split('/puerta/')[1]
    expect(token).toMatch(checkinAccess.CHECKIN_TOKEN_RE)
    const row = db.tables.aitickets_checkin_links[0]
    row.id = '55555555-5555-4555-8555-555555555555' // la BD real genera un uuid
    expect(row.token_hash).toBe(sha(token))
    expect(JSON.stringify(row)).not.toContain(token)
    // vence 24 h después del fin de la última función (2026-11-02 04:00 Chile) o, si eso ya pasó, en 24 h
    expect(new Date(row.expires_at).getTime()).toBeGreaterThan(Date.now())

    const list = await runTool(tool('list_checkin_links'), { event_id: 10 }, ctx())
    expect(list.result.links).toEqual([expect.objectContaining({ label: 'Puerta norte', status: 'active' })])
    expect(JSON.stringify(list.result)).not.toContain(token)

    const revoked = await runTool(tool('revoke_checkin_link'), { link_id: row.id }, ctx())
    expect(revoked.ok).toBe(true)
    expect(await checkinAccess.resolveCheckinToken(db, token)).toBeNull()
  })

  it('un viewer no crea links y no se revoca un link de otra organización', async () => {
    expect(await runTool(tool('create_checkin_link'), { event_id: 10 }, ctx({ role: 'viewer' }))).toMatchObject({ ok: false, code: 'forbidden' })
    expect(await runTool(tool('create_checkin_link'), { event_id: 10 }, ctx({ role: 'validator' }))).toMatchObject({ ok: false, code: 'forbidden' })
    expect(await runTool(tool('create_checkin_link'), { event_id: 10, expires_in_hours: 200 }, ctx())).toMatchObject({ ok: false, code: 'invalid_input' })
    db.tables.aitickets_checkin_links.push({ id: '44444444-4444-4444-8444-444444444444', organization_id: 8, event_id: 20, token_hash: sha('x'), expires_at: '2099-01-01T00:00:00Z' })
    expect(await runTool(tool('revoke_checkin_link'), { link_id: '44444444-4444-4444-8444-444444444444' }, ctx())).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('defaultCheckinExpiry: función que cruza la medianoche', async () => {
    const exp = await checkinAccess.defaultCheckinExpiry(db, { id: 10, end_date: null }, new Date('2026-10-01T00:00:00Z'))
    // fin 2026-11-02 04:00 en Chile (UTC-3) = 07:00Z, + 24 h
    expect(exp.toISOString()).toBe('2026-11-03T07:00:00.000Z')
  })
})

describe('/api/door/<token>', () => {
  async function makeLink(expiresAt = '2099-01-01T00:00:00Z') {
    const created = await checkinAccess.createCheckinLink(db, { eventId: 10, orgId: 7, userId: 1, label: null, expiresAt: new Date(expiresAt), origin: 'https://aitickets.test' })
    return created.url.split('/puerta/')[1]
  }
  const post = (token, path, body) => ({
    params: { token },
    request: new Request(`https://aitickets.test/api/door/${token}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })

  it('lista sin emails, valida y confirma solo entradas del evento del link', async () => {
    const token = await makeLink()
    const list = await doorAttendees.GET({ params: { token }, request: new Request(`https://aitickets.test/api/door/${token}/attendees`) })
    expect(list.status).toBe(200)
    const body = await list.json()
    expect(body.attendees.map((a) => a.id).sort()).toEqual([T1, T2, T3])
    expect(JSON.stringify(body)).not.toContain('@x.cl')
    // Nunca el QR en claro: solo su sha256 (un link filtrado no permite clonar entradas)
    expect(JSON.stringify(body)).not.toContain('qr-one')
    expect(body.attendees.find((a) => a.id === T1).qr_hash).toBe(sha('qr-one'))

    const found = await doorValidate.POST(post(token, 'validate', { qr_code: 'qr-one' }))
    expect((await found.json()).ticket).toMatchObject({ id: T1, full_name: 'Ana Pérez', status: 'active' })
    expect((await doorValidate.POST(post(token, 'validate', { qr_code: 'qr-ajeno' }))).status).toBe(404)

    const ok = await doorConfirm.POST(post(token, 'confirm', { ticket_id: T1 }))
    expect(ok.status).toBe(200)
    const dup = await doorConfirm.POST(post(token, 'confirm', { ticket_id: T1 }))
    expect(dup.status).toBe(409)
    expect((await dup.json()).code).toBe('already_validated')
    expect((await doorConfirm.POST(post(token, 'confirm', { ticket_id: T9 }))).status).toBe(404)
    expect(db.tables.aitickets_checkin_links[0].scan_count).toBeGreaterThan(0)
  })

  it('token inválido, vencido o revocado: 401', async () => {
    expect((await doorConfirm.POST(post('x'.repeat(32), 'confirm', { ticket_id: T1 }))).status).toBe(401)
    const expired = await makeLink('2020-01-01T00:00:00Z')
    expect((await doorConfirm.POST(post(expired, 'confirm', { ticket_id: T1 }))).status).toBe(401)
    const token = await makeLink()
    db.tables.aitickets_checkin_links.at(-1).revoked_at = new Date().toISOString()
    expect((await doorValidate.POST(post(token, 'validate', { qr_code: 'qr-one' }))).status).toBe(401)
    expect(db.tables.event_attendees.find((a) => a.id === T1).status).toBe('active')
  })
})
