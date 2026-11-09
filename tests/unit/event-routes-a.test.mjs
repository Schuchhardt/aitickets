// Rutas del panel que ejecutan herramientas de la API de productores con la sesión del usuario (dashboardToolContext +
// runTool): /api/events/agenda, /attest, /certificates, /social-series y /api/payouts/request.
// Se usa la sesión REAL (getSessionContext: cookie, usuario activo, organización verificada) y el acceso por evento
// REAL (aitickets_event_staff → actor.eventIds); solo se simulan Supabase (en memoria), correo, Slack y Zernio.
// Por cada ruta: 401 sin sesión, 403 para los roles sin el permiso de la herramienta, otra organización → 404 sin
// escribir, miembro limitado a otro evento → 403, y el camino feliz con lo que queda escrito.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { fakePassword, fakeSecret } from '../fixtures/fake-credentials.mjs'
const CERT_SIGNING_SECRET = fakeSecret('cert')

let db
const mocks = vi.hoisted(() => ({ notifySlack: vi.fn(async () => {}), sendEmail: vi.fn(async () => ({ id: 'mail-1' })), zernio: vi.fn() }))
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))
vi.mock('../../src/pages/api/_lib/server-utils', async (orig) => ({ ...(await orig()), notifySlack: mocks.notifySlack }))
vi.mock('../../netlify/lib/mailer.mjs', async (orig) => ({ ...(await orig()), sendEmail: mocks.sendEmail }))
vi.mock('../../netlify/lib/zernio-ads.mjs', async (orig) => ({ ...(await orig()), zernioRequest: mocks.zernio }))

const agenda = await import('../../src/pages/api/events/agenda.ts')
const attest = await import('../../src/pages/api/events/attest.ts')
const certificates = await import('../../src/pages/api/events/certificates.ts')
const socialSeries = await import('../../src/pages/api/events/social-series.ts')
const payoutRequest = await import('../../src/pages/api/payouts/request.ts')
const { santiagoToDate } = await import('../../src/pages/api/_lib/server-utils.ts')

const DAY = 86400000
const iso = (ms) => new Date(Date.now() + ms).toISOString()
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// ---------------------------------------------------------------------------
// Sesión real: cada usuario entra con su cookie; el token se resuelve en db.auth.getUser
// ---------------------------------------------------------------------------
const WHO = { producer: 1, admin: 2, editor: 3, finance: 4, validator: 5, viewer: 6, staff: 7, staffFinance: 8 }
const ROLE_OF = { producer: 'producer', admin: 'admin', editor: 'editor', finance: 'finance', validator: 'validator', viewer: 'viewer', staff: 'editor', staffFinance: 'finance' }
const tokens = new Map()
let tokenSeq = 0

function cookiesFor(who) {
  if (!who) return { get: () => undefined, set() {}, delete() {} }
  const token = `tok-${who}-${++tokenSeq}` // token nuevo por llamada: la caché de sesiones no cruza tests
  tokens.set(token, `auth-${WHO[who]}`)
  return { get: (name) => (name === 'sb-access-token' ? { value: token } : undefined), set() {}, delete() {} }
}

async function hit(handler, who, { method = 'GET', path = '/api/x', query = {}, body, rawBody } = {}) {
  const url = new URL(`https://aitickets.test${path}`)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v))
  const init = { method }
  if (body !== undefined) Object.assign(init, { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
  if (rawBody !== undefined) Object.assign(init, { body: rawBody, headers: { 'Content-Type': 'application/json' } })
  const res = await handler({ request: new Request(url, init), url, cookies: cookiesFor(who), locals: {}, redirect: (to, status = 302) => new Response(null, { status, headers: { Location: to } }) })
  const type = res.headers.get('Content-Type') || ''
  return { status: res.status, res, body: type.includes('json') ? await res.json() : null }
}

const writesTo = (table) => db.calls.filter((c) => c.table === table && ['insert', 'update', 'upsert', 'delete'].includes(c.op))

function baseTables() {
  const users = Object.entries(WHO).map(([who, uid]) => ({
    id: uid, auth_user_id: `auth-${uid}`, name: who, email: `${who}@sur.cl`, organization_id: 7, role: ROLE_OF[who], active: true,
  }))
  return {
    organizations: [
      { id: 7, public_name: 'Productora Sur', email: 'hola@sur.cl', email_verified_at: '2026-01-01T00:00:00Z', terms_accepted_at: '2026-01-01T00:00:00Z', zernio_profile_id: 'prof-7' },
      { id: 8, public_name: 'Otra', email: 'otra@x.cl', email_verified_at: '2026-01-01T00:00:00Z', terms_accepted_at: '2026-01-01T00:00:00Z' },
    ],
    users: [...users, { id: 90, auth_user_id: 'auth-90', name: 'Ajeno', email: 'a@otra.cl', organization_id: 8, role: 'producer', active: true }],
    // staff y staffFinance solo tienen acceso al evento 11
    aitickets_event_staff: [
      { organization_id: 7, event_id: 11, user_id: 7 },
      { organization_id: 7, event_id: 11, user_id: 8 },
    ],
    aitickets_api_audit: [],
    aitickets_api_confirmations: [],
    aitickets_api_idempotency: [],
  }
}

function seed(tables = {}, opts = {}) {
  db = createFakeSupabase({
    ...opts,
    tables: { ...baseTables(), ...tables },
    unique: { aitickets_api_idempotency: [['organization_id', 'tool', 'idem_key']], ...(opts.unique || {}) },
  })
  db.auth = {
    getUser: async (token) =>
      tokens.has(token) ? { data: { user: { id: tokens.get(token), email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } },
  }
}

/** Mismas denegaciones para varios roles; además, sin escrituras en `table`. */
async function expectDenied(handler, roles, opts, { status = 403, table } = {}) {
  for (const who of roles) {
    const before = table ? writesTo(table).length : 0
    const out = await hit(handler, who, opts)
    expect(out.status, `${who} → ${opts.method || 'GET'} ${JSON.stringify(opts.query || opts.body || {})}`).toBe(status)
    if (status === 403 && out.body?.error) expect(out.body.error.code).toBe('forbidden')
    if (table) expect(writesTo(table).length, `${who} escribió en ${table}`).toBe(before)
  }
}

beforeEach(() => {
  tokens.clear()
  mocks.notifySlack.mockClear()
  mocks.sendEmail.mockClear()
  mocks.zernio.mockReset()
  mocks.zernio.mockImplementation(async (path, opts = {}) => {
    if (opts.method === 'DELETE') return { success: true }
    if (path.startsWith('/comment-automations/')) return { automation: { stats: {} } }
    return { success: true }
  })
})

// ---------------------------------------------------------------------------
// Eventos base: 10 (org 7, ya terminó), 11 (org 7, el único del miembro limitado) y 20 (org 8)
// ---------------------------------------------------------------------------
const EVENTS = [
  { id: 10, organization_id: 7, name: 'Congreso RRHH', slug: 'congreso', status: 'published', start_date: '2026-10-01T12:00:00Z', end_date: '2026-10-02T15:30:00Z', cancelled_at: null },
  { id: 11, organization_id: 7, name: 'Jornada', slug: 'jornada', status: 'published', start_date: '2026-10-05T12:00:00Z', end_date: '2026-10-05T15:00:00Z', cancelled_at: null },
  { id: 20, organization_id: 8, name: 'Ajeno', slug: 'ajeno', status: 'published', start_date: '2026-10-01T12:00:00Z', end_date: '2026-10-01T15:00:00Z', cancelled_at: null },
]
const DATES = [
  { id: 501, event_id: 10, date: '2026-10-01', start_time: '09:00:00', end_time: '13:00:00' },
  { id: 502, event_id: 10, date: '2026-10-02', start_time: '09:00:00', end_time: '12:30:00' },
  { id: 511, event_id: 11, date: '2026-10-05', start_time: '09:00:00', end_time: '12:00:00' },
  { id: 520, event_id: 20, date: '2026-10-01', start_time: '09:00:00', end_time: '12:00:00' },
]

describe('sesión (getSessionContext real)', () => {
  it('sin cookie, token inválido, usuario inactivo u organización sin verificar: 401', async () => {
    seed({ events: EVENTS, event_dates: DATES })
    expect((await hit(agenda.GET, null, { query: { event_id: 10 } })).status).toBe(401)
    const bad = await agenda.GET({ request: new Request('https://aitickets.test/api/events/agenda?event_id=10'), url: new URL('https://aitickets.test/api/events/agenda?event_id=10'), cookies: { get: () => ({ value: 'no-existe' }) } })
    expect(bad.status).toBe(401)
    db.tables.users.find((u) => u.id === 3).active = false
    expect((await hit(agenda.GET, 'editor', { query: { event_id: 10 } })).status).toBe(401)
    db.tables.users.find((u) => u.id === 90).organization_id = 9
    db.tables.organizations.push({ id: 9, public_name: 'Sin verificar', email_verified_at: null, terms_accepted_at: '2026-01-01T00:00:00Z' })
    tokens.set('tok-ajeno', 'auth-90')
    const unverified = await agenda.GET({ request: new Request('https://aitickets.test/api/events/agenda?event_id=10'), url: new URL('https://aitickets.test/api/events/agenda?event_id=10'), cookies: { get: () => ({ value: 'tok-ajeno' }) } })
    expect(unverified.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
describe('/api/events/agenda (get_event_agenda / update_event_agenda)', () => {
  const BLOCKS = [
    { function_id: 501, start: '09:00', end: '09:30', title: 'Bienvenida', speakers: 'Ana Pérez', room: 'Sala 1' },
    { function_id: null, start: '08:30', title: 'Acreditación' },
  ]
  const put = (who, body) => hit(agenda.PUT, who, { method: 'PUT', body })
  beforeEach(() => seed({ events: EVENTS, event_dates: DATES, aitickets_event_agenda: [] }))

  it('GET sin sesión: 401; cualquier rol del equipo la lee (events.read)', async () => {
    expect((await hit(agenda.GET, null, { query: { event_id: 10 } })).status).toBe(401)
    for (const who of ['producer', 'admin', 'editor', 'finance', 'validator', 'viewer']) {
      const out = await hit(agenda.GET, who, { query: { event_id: 10 } })
      expect(out.status, who).toBe(200)
      expect(out.body.data).toMatchObject({ event_id: 10, event_name: 'Congreso RRHH', total_blocks: 0 })
      expect(out.body.data.functions.map((f) => f.id)).toEqual([501, 502])
    }
  })

  it('GET de otra organización: 404; miembro limitado a otro evento: 403', async () => {
    expect((await hit(agenda.GET, 'producer', { query: { event_id: 20 } })).status).toBe(404)
    expect((await hit(agenda.GET, 'staff', { query: { event_id: 10 } })).status).toBe(403)
    expect((await hit(agenda.GET, 'staff', { query: { event_id: 11 } })).status).toBe(200)
  })

  it('PUT sin sesión: 401; finanzas, puerta y solo lectura: 403 sin escribir', async () => {
    expect((await put(null, { event_id: 10, blocks: BLOCKS })).status).toBe(401)
    await expectDenied(agenda.PUT, ['finance', 'validator', 'viewer'], { method: 'PUT', body: { event_id: 10, blocks: BLOCKS } }, { table: 'aitickets_event_agenda' })
    expect(db.tables.aitickets_event_agenda).toHaveLength(0)
  })

  it('PUT a otra organización: 404; miembro limitado: 403 en otro evento y 200 en el suyo; nada se escribe al negar', async () => {
    expect((await put('producer', { event_id: 20, blocks: [{ start: '10:00', title: 'Hack' }] })).status).toBe(404)
    expect((await put('staff', { event_id: 10, blocks: [{ start: '10:00', title: 'Hack' }] })).status).toBe(403)
    expect(writesTo('aitickets_event_agenda')).toHaveLength(0)
    expect((await put('staff', { event_id: 11, blocks: [{ function_id: 511, start: '10:00', title: 'Charla' }] })).status).toBe(200)
    expect(db.tables.aitickets_event_agenda.map((b) => b.event_id)).toEqual([11])
  })

  it('PUT feliz (producer, admin y editor): guarda la agenda completa, ordenada, con bitácora del panel', async () => {
    for (const who of ['producer', 'admin', 'editor']) {
      const out = await put(who, { event_id: 10, blocks: BLOCKS })
      expect(out.status, who).toBe(200)
      expect(out.body.ok).toBe(true)
      expect(out.body.data).toMatchObject({ event_id: 10, total_blocks: 2 })
      expect(out.body.data.blocks.map((b) => b.title)).toEqual(['Acreditación', 'Bienvenida'])
    }
    // Reemplaza (no acumula)
    expect(db.tables.aitickets_event_agenda.filter((b) => b.event_id === 10)).toHaveLength(2)
    expect(db.tables.aitickets_api_audit.at(-1)).toMatchObject({ tool: 'update_event_agenda', channel: 'dashboard', organization_id: 7, user_id: 3, ok: true })
  })

  it('PUT con una función de otro evento: 400', async () => {
    const out = await put('producer', { event_id: 10, blocks: [{ function_id: 520, start: '10:00', title: 'X' }] })
    expect(out.status).toBe(400)
    expect(db.tables.aitickets_event_agenda).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('/api/events/attest (attest_function_held, finance.manage)', () => {
  const post = (who, body) => hit(attest.POST, who, { method: 'POST', body })
  beforeEach(() => seed({ events: EVENTS.map((e) => ({ ...e })), event_dates: DATES.map((d) => ({ ...d })), event_orders: [] }))

  it('sin sesión: 401; administrador, marketing, puerta y solo lectura: 403 sin escribir', async () => {
    expect((await post(null, { event_id: 10, note: 'Se realizó' })).status).toBe(401)
    for (const table of ['events', 'event_dates']) {
      await expectDenied(attest.POST, ['admin', 'editor', 'validator', 'viewer'], { method: 'POST', body: { event_id: 10, note: 'Se realizó' } }, { table })
    }
    expect(db.tables.events.find((e) => e.id === 10).held_attested_at).toBeUndefined()
  })

  it('otra organización: 404; finanzas limitado a otro evento: 403; sin escribir', async () => {
    expect((await post('producer', { event_id: 20, note: 'Se realizó' })).status).toBe(404)
    expect((await post('staffFinance', { event_id: 10, note: 'Se realizó' })).status).toBe(403)
    expect(writesTo('events')).toHaveLength(0)
    expect(db.tables.events.find((e) => e.id === 20).held_attested_at).toBeUndefined()
  })

  it('feliz: finanzas acredita todo el evento y el dueño una función; queda en la bitácora y avisa a AI Tickets', async () => {
    const all = await post('finance', { event_id: 10, note: 'Fueron 200 personas, fotos en Drive' })
    expect(all.status).toBe(200)
    expect(all.body.data).toMatchObject({ event_id: 10, event_date_id: null, attested_at: expect.any(String), available_now: expect.any(Number) })
    expect(db.tables.events.find((e) => e.id === 10)).toMatchObject({ held_attested_at: expect.any(String), held_attested_by: 4 })

    const fn = await post('producer', { event_id: 10, event_date_id: 501, note: 'Función del día 1 realizada' })
    expect(fn.status).toBe(200)
    expect(db.tables.event_dates.find((d) => d.id === 501)).toMatchObject({ held_attested_by: 1, held_attested_note: 'Función del día 1 realizada' })
    expect(db.tables.event_dates.find((d) => d.id === 502).held_attested_at).toBeUndefined()
    expect(mocks.notifySlack).toHaveBeenCalledTimes(2)
    expect(db.tables.aitickets_api_audit.filter((a) => a.tool === 'attest_function_held' && a.ok).map((a) => a.channel)).toEqual(['dashboard', 'dashboard'])
  })

  it('función de otro evento: 404; nota vacía: 400', async () => {
    expect((await post('producer', { event_id: 10, event_date_id: 520, note: 'Se realizó' })).status).toBe(404)
    expect((await post('producer', { event_id: 10, note: '' })).status).toBe(400)
    expect(writesTo('event_dates')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('/api/events/certificates', () => {
  const buyer = (first_name, last_name, email) => ({ attendees: { first_name, last_name, email } })
  beforeEach(() => {
    vi.stubEnv('INTERNAL_API_SECRET', CERT_SIGNING_SECRET)
    seed({
      events: EVENTS,
      event_dates: DATES,
      event_tickets: [{ id: 1, event_id: 10, ticket_name: 'Pase completo', event_date_id: null }, { id: 9, event_id: 20, ticket_name: 'Ajeno', event_date_id: null }],
      event_attendees: [
        { id: id(1), event_id: 10, event_ticket_id: 1, status: 'validated', validated_at: '2026-10-01T12:05:00Z', holder_name: 'Carolina Muñoz', holder_email: 'caro@x.cl', ...buyer('Pedro', 'Compras', 'pedro@x.cl') },
        { id: id(2), event_id: 10, event_ticket_id: 1, status: 'validated', validated_at: '2026-10-01T12:10:00Z', ...buyer('Diego', 'Fuentes', 'diego@x.cl') },
        { id: id(3), event_id: 10, event_ticket_id: 1, status: 'active', ...buyer('Ana', 'Soto', 'ana@x.cl') },
        { id: id(9), event_id: 20, event_ticket_id: 9, status: 'validated', validated_at: '2026-10-01T12:00:00Z', ...buyer('Ajeno', 'X', 'ajeno@x.cl') },
      ],
      aitickets_attendee_checkins: [
        { id: 1, event_attendee_id: id(1), event_id: 10, event_date_id: 501, checked_in_at: '2026-10-01T12:05:00Z' },
        { id: 2, event_attendee_id: id(2), event_id: 10, event_date_id: 501, checked_in_at: '2026-10-01T12:10:00Z' },
        { id: 9, event_attendee_id: id(9), event_id: 20, event_date_id: 520, checked_in_at: '2026-10-01T12:00:00Z' },
      ],
      aitickets_certificate_sends: [],
    })
  })

  it('GET (JSON) sin sesión: 401; puerta y solo lectura: 403 (attendees.read); finanzas y marketing sí', async () => {
    expect((await hit(certificates.GET, null, { query: { event_id: 10 } })).status).toBe(401)
    await expectDenied(certificates.GET, ['validator', 'viewer'], { query: { event_id: 10 } })
    for (const who of ['producer', 'admin', 'editor', 'finance']) {
      const out = await hit(certificates.GET, who, { query: { event_id: 10 } })
      expect(out.status, who).toBe(200)
      expect(out.body.data).toMatchObject({ event_id: 10, event_ended: true, summary: { checked_in: 2, eligible: 2 } })
      expect(out.body.data.certificates.map((c) => c.name).sort()).toEqual(['Carolina Muñoz', 'Diego Fuentes'])
    }
  })

  it('GET (JSON y PDF) de otra organización: 404; miembro limitado a otro evento: 403; sin datos ajenos', async () => {
    const foreign = await hit(certificates.GET, 'producer', { query: { event_id: 20 } })
    expect(foreign.status).toBe(404)
    expect(JSON.stringify(foreign.body)).not.toContain('ajeno@x.cl')
    expect((await hit(certificates.GET, 'producer', { query: { event_id: 20, format: 'pdf' } })).status).toBe(404)
    expect((await hit(certificates.GET, 'staff', { query: { event_id: 10 } })).status).toBe(403)
    expect((await hit(certificates.GET, 'staff', { query: { event_id: 10, format: 'pdf' } })).status).toBe(403)
  })

  it('GET PDF: sin sesión 401, puerta 403, el dueño descarga un PDF', async () => {
    expect((await hit(certificates.GET, null, { query: { event_id: 10, format: 'pdf' } })).status).toBe(401)
    expect((await hit(certificates.GET, 'validator', { query: { event_id: 10, format: 'pdf' } })).status).toBe(403)
    const out = await hit(certificates.GET, 'producer', { query: { event_id: 10, format: 'pdf' } })
    expect(out.status).toBe(200)
    expect(out.res.headers.get('Content-Type')).toBe('application/pdf')
    expect(out.res.headers.get('Content-Disposition')).toMatch(/attachment; filename=".+\.pdf"/)
    expect(Buffer.from(await out.res.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('POST send: acción inválida 400; sin sesión 401; finanzas, puerta y solo lectura 403 (messages.send) sin enviar', async () => {
    expect((await hit(certificates.POST, 'producer', { method: 'POST', body: { action: 'otra', event_id: 10 } })).status).toBe(400)
    expect((await hit(certificates.POST, null, { method: 'POST', body: { action: 'send', event_id: 10 } })).status).toBe(401)
    await expectDenied(certificates.POST, ['finance', 'validator', 'viewer'], { method: 'POST', body: { action: 'send', event_id: 10 } }, { table: 'aitickets_api_confirmations' })
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })

  it('POST send de otra organización: 404; miembro limitado: 403; sin correos ni confirmaciones', async () => {
    expect((await hit(certificates.POST, 'producer', { method: 'POST', body: { action: 'send', event_id: 20 } })).status).toBe(404)
    expect((await hit(certificates.POST, 'staff', { method: 'POST', body: { action: 'send', event_id: 10 } })).status).toBe(403)
    expect(db.tables.aitickets_api_confirmations).toHaveLength(0)
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })

  it('POST send feliz: confirmación en dos pasos, envía a cada asistente y registra el envío', async () => {
    const first = await hit(certificates.POST, 'editor', { method: 'POST', body: { action: 'send', event_id: 10, note: '¡Gracias por venir!' } })
    expect(first.status).toBe(200)
    expect(first.body.data).toMatchObject({ status: 'confirmation_required', details: { recipients: 2, certificates: 2 } })
    expect(mocks.sendEmail).not.toHaveBeenCalled()

    const done = await hit(certificates.POST, 'editor', {
      method: 'POST',
      body: { action: 'send', event_id: 10, note: '¡Gracias por venir!', confirmation_token: first.body.data.confirmation_token },
    })
    expect(done.status).toBe(200)
    expect(done.body.data).toMatchObject({ event_id: 10, sent: 2, failed: 0, certificates: 2, remaining: 0 })
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendEmail.mock.calls[0][0].to.join(' ')).toMatch(/caro@x\.cl/)
    expect(db.tables.aitickets_certificate_sends).toEqual([expect.objectContaining({ event_id: 10, organization_id: 7, recipients_count: 2, created_by: 3 })])
  })
})

// ---------------------------------------------------------------------------
describe('/api/events/social-series', () => {
  // Evento 12: publicado, en 20 días, con Instagram conectado (requisito para preparar la serie)
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date(Date.now() + 20 * DAY))
  const start = santiagoToDate(day, '20:00').toISOString()
  const EVENT_12 = {
    id: 12, organization_id: 7, name: 'Concierto de Primavera', slug: 'concierto', status: 'published', description: '<p>Concierto al aire libre.</p>',
    start_date: start, end_date: santiagoToDate(day, '22:00').toISOString(), image_url: null, cancelled_at: null, archived_at: null, location: 'Teatro Sur, Santiago',
    event_dates: [{ date: day, start_time: '20:00:00', end_time: '22:00:00' }], event_locations: [{ venues: { name: 'Teatro Sur', city: 'Santiago' } }],
  }
  const post = (who, body) => hit(socialSeries.POST, who, { method: 'POST', body })

  beforeEach(() => {
    vi.stubEnv('ZERNIO_API_KEY', 'zk_test')
    vi.stubEnv('SUPABASE_URL', 'https://proj.supabase.co')
    seed(
      {
        events: [...EVENTS, EVENT_12],
        event_dates: [...DATES, { id: 512, event_id: 12, date: day, start_time: '20:00:00', end_time: '22:00:00' }],
        event_tickets: [{ id: 50, event_id: 12, ticket_name: 'General', price: 5000, total_quantity: 350, is_gift: false, status: 'available' }],
        event_orders: [],
        event_visits: [],
        social_accounts: [{ id: 1, organization_id: 7, platform: 'instagram', zernio_account_id: 'acc-ig-7', account_name: '@sur', status: 'active' }],
        aitickets_sites: [],
        aitickets_platform_settings: [],
        aitickets_social_series: [],
        aitickets_social_series_slots: [],
      },
      {
        rpc: { aitickets_ticket_availability: () => [{ ticket_id: 50, sold: 10, pending: 0 }] },
        defaults: {
          aitickets_social_series: { feed_posts_enabled: true, sold_out_story_enabled: false, keyword: 'ENTRADAS', extra_keywords: ['entrada', 'link'], cadence_config: {}, status: 'draft' },
          aitickets_social_series_slots: { variant: 'countdown', attempts: 0 },
        },
      },
    )
    db.storage = {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: (path) => ({ data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/Events/${path}` } }),
      }),
    }
  })

  it('POST valida la sesión antes que la acción: anónimo 401 aunque la acción no exista; con sesión, 400', async () => {
    expect((await post(null, { action: 'no-existe', event_id: 12 })).status).toBe(401)
    expect((await post('producer', { action: 'no-existe', event_id: 12 })).status).toBe(400)
  })

  it('acción inválida: 400 (antes de mirar la sesión); sin sesión: 401', async () => {
    expect((await post('producer', { action: 'borrar', event_id: 12 })).status).toBe(400)
    expect((await post(null, { action: 'prepare', event_id: 12 })).status).toBe(401)
    expect((await hit(socialSeries.GET, null, { query: { event_id: 12 } })).status).toBe(401)
  })

  it('prepare: finanzas, puerta y solo lectura 403 (events.write); otra organización 404; limitado 403; sin crear series', async () => {
    await expectDenied(socialSeries.POST, ['finance', 'validator', 'viewer'], { method: 'POST', body: { action: 'prepare', event_id: 12 } }, { table: 'aitickets_social_series' })
    expect((await post('producer', { action: 'prepare', event_id: 20 })).status).toBe(404)
    expect((await post('staff', { action: 'prepare', event_id: 12 })).status).toBe(403)
    expect(db.tables.aitickets_social_series).toHaveLength(0)
  })

  it('approve/pause/resume/cancel: finanzas, puerta y solo lectura 403 (events.publish)', async () => {
    for (const action of ['approve', 'pause', 'resume', 'cancel']) {
      await expectDenied(socialSeries.POST, ['finance', 'validator', 'viewer'], { method: 'POST', body: { action, event_id: 12 } }, { table: 'aitickets_social_series' })
    }
    expect(mocks.zernio).not.toHaveBeenCalled()
  })

  it('approve/pause/resume/cancel de otra organización: 404; miembro limitado: 403; la serie no cambia', async () => {
    db.tables.aitickets_social_series.push({ id: 900, organization_id: 8, event_id: 20, status: 'active' }, { id: 901, organization_id: 7, event_id: 12, status: 'active' })
    for (const action of ['approve', 'pause', 'resume', 'cancel']) {
      expect((await post('producer', { action, event_id: 20 })).status, action).toBe(404)
      expect((await post('staff', { action, event_id: 12 })).status, action).toBe(403)
    }
    expect(db.tables.aitickets_social_series.map((s) => s.status)).toEqual(['active', 'active'])
    expect(writesTo('aitickets_social_series')).toHaveLength(0)
  })

  it('cancel feliz: confirmación en dos pasos y la serie queda cancelada con el motivo', async () => {
    expect((await post('producer', { action: 'prepare', event_id: 12 })).status).toBe(200)
    const first = await post('admin', { action: 'cancel', event_id: 12, reason: 'cambio de planes' })
    expect(first.body.data).toMatchObject({ status: 'confirmation_required' })
    expect(db.tables.aitickets_social_series[0].status).toBe('draft')
    const done = await post('admin', { action: 'cancel', event_id: 12, reason: 'cambio de planes', confirmation_token: first.body.data.confirmation_token })
    expect(done.status).toBe(200)
    expect(done.body.data.result).toBe('cancelled')
    expect(db.tables.aitickets_social_series[0]).toMatchObject({ status: 'cancelled', cancel_reason: 'cambio de planes' })
  })

  it('GET: cualquier rol lo lee; otra organización 404; limitado 403', async () => {
    expect((await hit(socialSeries.GET, 'viewer', { query: { event_id: 12 } })).status).toBe(200)
    expect((await hit(socialSeries.GET, 'producer', { query: { event_id: 20 } })).status).toBe(404)
    expect((await hit(socialSeries.GET, 'staff', { query: { event_id: 12 } })).status).toBe(403)
  })

  it('feliz: marketing prepara el borrador (sin publicar nada) y aprobar pide confirmación', async () => {
    const prepared = await post('editor', { action: 'prepare', event_id: 12, keyword: 'PRIMAVERA', feed_posts_enabled: false, ignorado: 'x' })
    expect(prepared.status).toBe(200)
    expect(prepared.body.data.series).toMatchObject({ status: 'draft' })
    expect(db.tables.aitickets_social_series).toEqual([expect.objectContaining({ event_id: 12, organization_id: 7, status: 'draft', keyword: 'PRIMAVERA', feed_posts_enabled: false, created_by: 3, created_via: 'dashboard' })])

    const view = await hit(socialSeries.GET, 'producer', { query: { event_id: 12 } })
    expect(view.status).toBe(200)
    expect(view.body.data.series).toMatchObject({ status: 'draft' })

    const approve = await post('producer', { action: 'approve', event_id: 12 })
    expect(approve.status).toBe(200)
    expect(approve.body.data).toMatchObject({ status: 'confirmation_required', confirmation_token: expect.stringMatching(/^aitconf_/) })
    expect(db.tables.aitickets_social_series[0].status).toBe('draft')
  })
})

// ---------------------------------------------------------------------------
describe('/api/payouts/request (request_payout, finance.manage)', () => {
  const post = (who, body) => hit(payoutRequest.POST, who, { method: 'POST', body })
  beforeEach(() =>
    seed({
      organizations: [
        { ...baseTables().organizations[0], identity_status: 'approved', identity_verified_at: '2026-01-02T00:00:00Z' },
        baseTables().organizations[1],
      ],
      events: [
        { id: 10, name: 'Pasado', status: 'published', organization_id: 7, end_date: iso(-5 * DAY), fee_absorbed: false },
        { id: 11, name: 'Jornada', status: 'published', organization_id: 7, end_date: iso(-6 * DAY), fee_absorbed: false },
        { id: 20, name: 'Ajeno', status: 'published', organization_id: 8, end_date: iso(-5 * DAY) },
      ],
      event_dates: [],
      event_orders: [
        { id: 'o1', event_id: 10, status: 'paid', amount: 50000, ticket_qty: 5, ticket_fee: 4000, service_fee_tax: 760, created_at: iso(-30 * DAY) },
        { id: 'o2', event_id: 11, status: 'paid', amount: 8000, ticket_qty: 1, ticket_fee: 640, service_fee_tax: 122, created_at: iso(-31 * DAY) },
        { id: 'o9', event_id: 20, status: 'paid', amount: 999999, ticket_qty: 1, created_at: iso(-40 * DAY) },
      ],
      aitickets_refunds: [],
      event_withdrawals: [],
      organization_payout_accounts: [
        {
          organization_id: 7, legal_name: 'Productora Sur SpA', legal_rut: '76.123.456-7', bank_name: 'BancoEstado', bank_account_type: 'Cuenta Corriente',
          bank_account_number: '000123456789', bank_account_holder: 'Ana Pérez', bank_account_rut: '12.345.678-9',
          verified_at: iso(-10 * DAY), verified_by: 'ops', bank_changed_at: iso(-10 * DAY), removed_at: null, holder_match_status: 'match',
        },
      ],
      aitickets_payouts: [],
    }),
  )

  it('sin sesión: 401; JSON inválido: 400; administrador, marketing, puerta y solo lectura: 403 sin retiros', async () => {
    expect((await post(null, {})).status).toBe(401)
    expect((await hit(payoutRequest.POST, 'producer', { method: 'POST', rawBody: '{no es json' })).status).toBe(400)
    await expectDenied(payoutRequest.POST, ['admin', 'editor', 'validator', 'viewer'], { method: 'POST', body: { amount: 1000 } }, { table: 'aitickets_payouts' })
    expect(db.tables.aitickets_api_confirmations).toHaveLength(0)
  })

  it('feliz (finanzas): confirma y retira solo saldo de la organización, con idempotencia', async () => {
    const first = await post('finance', { amount: 30000 })
    expect(first.status).toBe(200)
    expect(first.body.data).toMatchObject({ status: 'confirmation_required', details: { amount: 30000, bank: 'BancoEstado', account_last4: '6789' } })
    expect(db.tables.aitickets_payouts).toHaveLength(0)

    const args = { amount: 30000, confirmation_token: first.body.data.confirmation_token, idempotency_key: 'payout-test-0001' }
    const done = await post('finance', args)
    expect(done.status).toBe(200)
    expect(done.body.data).toMatchObject({ status: 'requested', amount: 30000 })
    expect(db.tables.aitickets_payouts).toEqual([expect.objectContaining({ organization_id: 7, amount: 30000, status: 'requested', requested_by: 4, requested_via: 'dashboard', bank_account_last4: '6789' })])
    const rows = db.tables.event_withdrawals
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(30000)
    expect(rows.every((r) => [10, 11].includes(r.event_id))).toBe(true)
    expect(JSON.stringify(rows)).not.toContain('000123456789')

    // Reintento con la misma clave: misma respuesta, sin otro retiro
    const replay = await post('finance', args)
    expect(replay.body.data).toMatchObject({ payout_id: done.body.data.payout_id, idempotent_replay: true })
    expect(db.tables.aitickets_payouts).toHaveLength(1)
  })

  it('un monto mayor al disponible: 409 sin retiro', async () => {
    expect((await post('producer', { amount: 999999 })).status).toBe(409)
    expect(db.tables.aitickets_payouts).toHaveLength(0)
  })

  // request_payout calcula el saldo solo con los eventos asignados (actor.eventIds), igual que get_balance: un miembro
  // de finanzas limitado al evento 11 no retira el saldo del evento 10. Antes retiraba el de toda la organización.
  it('finanzas limitado a un evento: solo retira el saldo de sus eventos', async () => {
    const out = await post('staffFinance', {})
    expect(out.status).toBe(200)
    const allocated = out.body.data.details.events.map((e) => e.event_id)
    expect(allocated.length).toBeGreaterThan(0)
    expect(allocated.filter((eventId) => eventId !== 11)).toEqual([])
  })
})
