// Funciones de Netlify del equipo de puerta y avisos a asistentes: validate-ticket, confirm-ticket,
// get-event-attendees (CHECKIN_ROLES + acceso por evento) y send-event-notification (EVENT_MANAGER_ROLES, o llamada
// interna con x-internal-secret). Corren las funciones reales con su sesión real (cookie sb-access-token →
// auth.getUser → public.users, con refresco por sb-refresh-token): solo el cliente de Supabase es falso
// (@supabase/supabase-js → BD en memoria) y la background function a la que se reenvía el aviso.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { fakePassword, fakeSecret } from '../fixtures/fake-credentials.mjs'
const IN_A_MONTH = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10) // fecha de función siempre futura
const INTERNAL_SECRET = fakeSecret('internal')
const FORGED_SECRET = fakeSecret('forged')

const h = vi.hoisted(() => {
  /** .or('status.is.null,status.eq.active') → .in('status', [null, 'active']) (una sola columna, eq/is). */
  const orAware = (b) => {
    b.or = (expr) => {
      const parts = String(expr).split(',').map((p) => {
        const [col, op, ...rest] = p.split('.')
        return { col, op, value: rest.join('.') }
      })
      const col = parts[0].col
      if (parts.some((p) => p.col !== col || !['eq', 'is'].includes(p.op))) throw new Error(`or() no soportado en este test: ${expr}`)
      return b.in(col, parts.map((p) => (p.op === 'is' && p.value === 'null' ? null : p.value)))
    }
    return b
  }
  return { db: null, tokens: {}, refresh: {}, orAware }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => h.orAware(h.db.from(table)),
    rpc: (...args) => h.db.rpc(...args),
    auth: {
      getUser: async (token) => {
        const user = h.tokens[token]
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } }
      },
      refreshSession: async ({ refresh_token }) => {
        const session = h.refresh[refresh_token]
        return session ? { data: { session }, error: null } : { data: { session: null }, error: { message: 'Invalid Refresh Token' } }
      },
    },
  }),
}))

const validateTicket = (await import('../../netlify/functions/validate-ticket/index.mjs')).default
const confirmTicket = (await import('../../netlify/functions/confirm-ticket/index.mjs')).default
const getEventAttendees = (await import('../../netlify/functions/get-event-attendees/index.mjs')).default
const sendEventNotification = (await import('../../netlify/functions/send-event-notification/index.mjs')).default
const sendEventNotificationBackground = (await import('../../netlify/functions/send-event-notification-background/index.mjs')).default

const ALL_ROLES = ['producer', 'admin', 'finance', 'editor', 'validator', 'viewer']
const CHECKIN = ['admin', 'producer', 'editor', 'validator']
const EMR = ['admin', 'producer', 'editor']
const outside = (allowed) => ALL_ROLES.filter((r) => !allowed.includes(r))

const A1 = '11111111-1111-4111-8111-111111111111' // activa, evento 10
const A2 = '22222222-2222-4222-8222-222222222222' // ya validada, evento 10
const A3 = '33333333-3333-4333-8333-333333333333' // anulada, evento 10
const B1 = '44444444-4444-4444-8444-444444444444' // evento 20 (otra organización)
const C1 = '55555555-5555-4555-8555-555555555555' // evento 11 (misma organización)
const EARLIER = '2026-11-07T23:30:00.000Z'

let db
let nextUserId

const general = () => ({ ticket_name: 'General', price: 10000, event_date_id: null })
const attendee = (id, eventId, qr, status, extra = {}) => ({
  id, event_id: eventId, event_ticket_id: eventId * 10, qr_code: qr, status, validated_at: status === 'validated' ? EARLIER : null,
  event_order_id: `o-${qr}`, is_complimentary: false, holder_name: null, holder_email: null, seat_number: null,
  attendees: { first_name: 'Ana', last_name: 'Pérez', email: `${qr}@x.cl` }, event_tickets: general(), ...extra,
})

function seed() {
  db = createFakeSupabase({
    tables: {
      users: [],
      events: [
        { id: 10, organization_id: 7, name: 'Viernes Techno' },
        { id: 11, organization_id: 7, name: 'Sábado Indie' },
        { id: 20, organization_id: 8, name: 'Evento Ajeno' },
      ],
      event_dates: [{ id: 501, event_id: 10, date: IN_A_MONTH, start_time: '23:00:00' }],
      event_tickets: [
        { id: 100, event_id: 10, ticket_name: 'General', price: 10000, event_date_id: null, entry_until: null },
        { id: 110, event_id: 11, ticket_name: 'General', price: 10000, event_date_id: null, entry_until: null },
        { id: 200, event_id: 20, ticket_name: 'General', price: 10000, event_date_id: null, entry_until: null },
      ],
      event_attendees: [
        attendee(A1, 10, 'qr-a1', 'active'),
        attendee(A2, 10, 'qr-a2', 'validated'),
        attendee(A3, 10, 'qr-a3', 'cancelled'),
        attendee(B1, 20, 'qr-b1', 'active'),
        attendee(C1, 11, 'qr-c1', 'active'),
      ],
      aitickets_attendee_checkins: [],
      aitickets_event_staff: [],
    },
  })
  h.db = db
  h.tokens = {}
  h.refresh = {}
  nextUserId = 1
}

/** Crea un usuario con sesión y devuelve su cookie. */
function login(role, { orgId = 7, active = true, staffEvents = [] } = {}) {
  const id = nextUserId++
  db.tables.users.push({ id, auth_user_id: `auth-${id}`, organization_id: orgId, role, active, name: `Usuario ${id}`, email: `u${id}@x.cl` })
  for (const eventId of staffEvents) db.tables.aitickets_event_staff.push({ user_id: id, event_id: eventId })
  h.tokens[`tok-${id}`] = { id: `auth-${id}` }
  return { id, cookie: `sb-access-token=tok-${id}` }
}

const writes = () => db.calls.filter((c) => c.op !== 'select' && c.op !== 'rpc')
const row = (id) => db.tables.event_attendees.find((a) => a.id === id)
const post = (handler, path, body, cookie, headers = {}) =>
  handler(new Request(`https://aitickets.cl${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }))
const get = (handler, path, cookie) => handler(new Request(`https://aitickets.cl${path}`, { headers: cookie ? { cookie } : {} }))

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://proj.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test')
  seed()
})

// ---------------------------------------------------------------------------
// validate-ticket
// ---------------------------------------------------------------------------
describe('POST /api/validate-ticket', () => {
  const call = (body, cookie) => post(validateTicket, '/api/validate-ticket', body, cookie)

  it('solo POST; sin sesión, token inválido o usuario inactivo: 401', async () => {
    const { cookie } = login('producer')
    expect((await get(validateTicket, '/api/validate-ticket', cookie)).status).toBe(405)
    expect((await call({ qr_code: 'qr-a1', event_id: 10 })).status).toBe(401)
    expect((await call({ qr_code: 'qr-a1', event_id: 10 }, 'sb-access-token=falso')).status).toBe(401)
    const inactive = login('producer', { active: false })
    expect((await call({ qr_code: 'qr-a1', event_id: 10 }, inactive.cookie)).status).toBe(401)
  })

  it('finance y viewer: 403; admin, producer, editor y validator ven la entrada', async () => {
    for (const role of outside(CHECKIN)) {
      expect((await call({ qr_code: 'qr-a1', event_id: 10 }, login(role).cookie)).status, role).toBe(403)
    }
    for (const role of CHECKIN) {
      const res = await call({ qr_code: 'qr-a1', event_id: 10 }, login(role).cookie)
      expect(res.status, role).toBe(200)
      expect((await res.json()).ticket).toMatchObject({
        id: A1, event_id: 10, qr_code: 'qr-a1', status: 'active', validated_at: null, full_name: 'Ana Pérez', email: 'qr-a1@x.cl',
        ticket_name: 'General', price: 10000, function_mismatch: false,
      })
    }
    expect(writes()).toEqual([])
  })

  it('evento de otra organización: 403; QR de otro evento: 404; datos faltantes 400', async () => {
    const { cookie } = login('validator')
    expect((await call({ qr_code: 'qr-b1', event_id: 20 }, cookie)).status).toBe(403)
    expect((await call({ qr_code: 'qr-b1', event_id: 10 }, cookie)).status).toBe(404)
    expect((await call({ qr_code: 'qr-c1', event_id: 10 }, cookie)).status).toBe(404)
    expect((await call({ qr_code: '', event_id: 10 }, cookie)).status).toBe(400)
    expect((await call({ qr_code: 'qr-a1' }, cookie)).status).toBe(400)
    expect((await call('{', cookie)).status).toBe(400)
  })

  it('miembro de puerta asignado a otro evento: 403 en este, 200 en el suyo', async () => {
    const { cookie } = login('validator', { staffEvents: [11] })
    expect((await call({ qr_code: 'qr-a1', event_id: 10 }, cookie)).status).toBe(403)
    expect((await call({ qr_code: 'qr-c1', event_id: 11 }, cookie)).status).toBe(200)
  })

  it('ya validada y anulada se informan con su estado', async () => {
    const { cookie } = login('validator')
    expect((await (await call({ qr_code: 'qr-a2', event_id: 10 }, cookie)).json()).ticket).toMatchObject({ status: 'validated', validated_at: EARLIER })
    expect((await (await call({ qr_code: 'qr-a3', event_id: 10 }, cookie)).json()).ticket.status).toBe('cancelled')
  })

  it('access token vencido: se refresca con el refresh token y devuelve las cookies nuevas', async () => {
    const { id } = login('validator')
    h.refresh['ref-1'] = { access_token: `tok-${id}`, refresh_token: 'ref-2' }
    const res = await call({ qr_code: 'qr-a1', event_id: 10 }, 'sb-access-token=vencido; sb-refresh-token=ref-1')
    expect(res.status).toBe(200)
    const cookies = res.headers.getSetCookie()
    expect(cookies).toHaveLength(2)
    expect(cookies[0]).toMatch(new RegExp(`^sb-access-token=tok-${id}; Path=/; HttpOnly; SameSite=Lax;.*Secure$`))
    expect(cookies[1]).toMatch(/^sb-refresh-token=ref-2;/)
    expect((await call({ qr_code: 'qr-a1', event_id: 10 }, 'sb-access-token=vencido; sb-refresh-token=robado')).status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// confirm-ticket
// ---------------------------------------------------------------------------
describe('POST /api/confirm-ticket', () => {
  const call = (body, cookie) => post(confirmTicket, '/api/confirm-ticket', body, cookie)

  it('solo POST; sin sesión 401; finance y viewer 403; nada se valida', async () => {
    expect((await get(confirmTicket, '/api/confirm-ticket', login('producer').cookie)).status).toBe(405)
    expect((await call({ ticket_id: A1, event_id: 10 })).status).toBe(401)
    for (const role of outside(CHECKIN)) {
      expect((await call({ ticket_id: A1, event_id: 10 }, login(role).cookie)).status, role).toBe(403)
    }
    expect(writes()).toEqual([])
    expect(row(A1).status).toBe('active')
  })

  it('entrada de otra organización: 403 (su evento) o 404 (con mi evento); no se toca', async () => {
    const { cookie } = login('validator')
    expect((await call({ ticket_id: B1, event_id: 20 }, cookie)).status).toBe(403)
    const res = await call({ ticket_id: B1, event_id: 10 }, cookie)
    expect(res.status).toBe(404)
    expect((await res.json()).message).toBe('La entrada no pertenece a este evento')
    expect(writes()).toEqual([])
    expect(row(B1)).toMatchObject({ status: 'active', validated_at: null })
  })

  it('miembro de puerta asignado a otro evento: 403 sin validar; en su evento sí', async () => {
    const { cookie } = login('validator', { staffEvents: [11] })
    expect((await call({ ticket_id: A1, event_id: 10 }, cookie)).status).toBe(403)
    expect(writes()).toEqual([])
    expect(row(A1).status).toBe('active')
    expect((await call({ ticket_id: C1, event_id: 11 }, cookie)).status).toBe(200)
    expect(row(C1).status).toBe('validated')
  })

  it('caso feliz para cada rol de check-in: queda validada con la hora del dispositivo (offline) si es razonable', async () => {
    for (const role of CHECKIN) {
      row(A1).status = 'active'
      row(A1).validated_at = null
      const at = new Date(Date.now() - 10 * 60 * 1000).toISOString()
      const res = await call({ ticket_id: A1, event_id: 10, validated_at: at }, login(role).cookie)
      expect(res.status, role).toBe(200)
      expect(await res.json()).toMatchObject({ message: 'Entrada validada exitosamente', validated_at: at, function_mismatch: false })
      expect(row(A1)).toMatchObject({ status: 'validated', validated_at: at })
    }
    // Hora absurda del dispositivo (de hace una semana): se usa la del servidor
    row(A1).status = 'active'
    const res = await call({ ticket_id: A1, event_id: 10, validated_at: '2026-01-01T00:00:00Z' }, login('validator').cookie)
    expect(Date.now() - Date.parse((await res.json()).validated_at)).toBeLessThan(60_000)
    const updates = writes().filter((w) => w.table === 'event_attendees')
    expect(updates.every((w) => w.filters.some((f) => f.col === 'event_id' && f.value === 10))).toBe(true)
  })

  it('ya validada: 409 already_validated; anulada: 409 invalid_status; ninguna cambia', async () => {
    const { cookie } = login('validator')
    const again = await call({ ticket_id: A2, event_id: 10 }, cookie)
    expect(again.status).toBe(409)
    expect(await again.json()).toMatchObject({ code: 'already_validated', validated_at: EARLIER })
    const voided = await call({ ticket_id: A3, event_id: 10 }, cookie)
    expect(voided.status).toBe(409)
    expect(await voided.json()).toMatchObject({ code: 'invalid_status', status: 'cancelled' })
    expect(writes()).toEqual([])
    expect(row(A2).validated_at).toBe(EARLIER)
  })

  it('ticket_id que no es UUID o sin event_id: 400', async () => {
    const { cookie } = login('validator')
    expect((await call({ ticket_id: '1', event_id: 10 }, cookie)).status).toBe(400)
    expect((await call({ ticket_id: A1 }, cookie)).status).toBe(400)
    expect((await call('nope', cookie)).status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// get-event-attendees
// ---------------------------------------------------------------------------
describe('GET /api/get-event-attendees', () => {
  const call = (eventId, cookie) => get(getEventAttendees, `/api/get-event-attendees?event_id=${eventId}`, cookie)

  it('solo GET; sin sesión 401; finance y viewer 403', async () => {
    expect((await post(getEventAttendees, '/api/get-event-attendees?event_id=10', {}, login('producer').cookie)).status).toBe(405)
    expect((await call(10)).status).toBe(401)
    for (const role of outside(CHECKIN)) {
      expect((await call(10, login(role).cookie)).status, role).toBe(403)
    }
  })

  it('evento de otra organización 403; miembro asignado a otro evento 403; sin event_id 400', async () => {
    expect((await call(20, login('producer').cookie)).status).toBe(403)
    const staff = login('validator', { staffEvents: [11] })
    expect((await call(10, staff.cookie)).status).toBe(403)
    expect((await call(11, staff.cookie)).status).toBe(200)
    expect((await call('x', login('producer').cookie)).status).toBe(400)
  })

  it('caso feliz para cada rol de check-in: solo las entradas y funciones de ese evento', async () => {
    for (const role of CHECKIN) {
      const res = await call(10, login(role).cookie)
      expect(res.status, role).toBe(200)
      const data = await res.json()
      expect(data.attendees.map((a) => a.id)).toEqual([A1, A2, A3])
      expect(data.dates.map((d) => d.id)).toEqual([501])
      expect(Date.parse(data.rendered_at)).toBeGreaterThan(0)
      expect(JSON.stringify(data)).not.toContain('qr-b1')
    }
    expect(writes()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// send-event-notification
// ---------------------------------------------------------------------------
describe('POST /api/send-event-notification', () => {
  const BODY = { eventId: 10, changeType: 'date_change', changeDescription: 'Se cambia al sábado 5 a las 22:00' }
  const BG = 'https://deploy--aitickets.netlify.app/.netlify/functions/send-event-notification-background'
  const call = (body, cookie, headers) => post(sendEventNotification, '/api/send-event-notification', body, cookie, headers)
  /** Background function falsa: registra lo que se encola. */
  const background = (status = 202) => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) })
      return new Response('', { status })
    }))
    return calls
  }

  beforeEach(() => {
    vi.stubEnv('INTERNAL_API_SECRET', INTERNAL_SECRET)
    vi.stubEnv('DEPLOY_URL', 'https://deploy--aitickets.netlify.app')
  })

  it('solo POST; body inválido 400; sin sesión 401; validator, finance y viewer 403; nada se encola', async () => {
    const calls = background()
    expect((await get(sendEventNotification, '/api/send-event-notification', login('producer').cookie)).status).toBe(405)
    expect((await call({ ...BODY, changeType: 'spam' }, login('producer').cookie)).status).toBe(400)
    expect((await call({ ...BODY, changeDescription: '  ' }, login('producer').cookie)).status).toBe(400)
    expect((await call(BODY)).status).toBe(401)
    for (const role of outside(EMR)) {
      expect((await call(BODY, login(role).cookie)).status, role).toBe(403)
    }
    expect(calls).toEqual([])
  })

  it('evento de otra organización o fuera de los eventos asignados: 404 sin encolar', async () => {
    const calls = background()
    expect((await call({ ...BODY, eventId: 20 }, login('producer').cookie)).status).toBe(404)
    const staff = login('editor', { staffEvents: [11] })
    expect((await call(BODY, staff.cookie)).status).toBe(404)
    expect(calls).toEqual([])
    expect((await call({ ...BODY, eventId: 11 }, staff.cookie)).status).toBe(202)
    expect(calls).toHaveLength(1)
  })

  it('caso feliz para admin, producer y editor: encola en la background function del deploy con el secreto interno', async () => {
    for (const role of EMR) {
      const calls = background()
      const user = login(role)
      const res = await call(BODY, user.cookie)
      expect(res.status, role).toBe(202)
      expect(await res.json()).toMatchObject({ queued: true })
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe(BG)
      expect(calls[0].headers['x-internal-secret']).toBe(INTERNAL_SECRET)
      expect(calls[0].body).toEqual({ ...BODY, requestedBy: { type: 'user', userId: user.id, organizationId: 7 } })
    }
    expect(writes()).toEqual([])
  })

  it('llamada interna con el secreto: sin sesión; un secreto falso cae a la sesión (401)', async () => {
    const calls = background()
    const res = await call({ ...BODY, eventId: 20 }, null, { 'x-internal-secret': INTERNAL_SECRET })
    expect(res.status).toBe(202)
    expect(calls[0].body.requestedBy).toEqual({ type: 'internal' })
    expect((await call(BODY, null, { 'x-internal-secret': FORGED_SECRET })).status).toBe(401)
    expect(calls).toHaveLength(1)
  })

  it('sin secreto interno configurado 503; la background function falla 502', async () => {
    const calls = background(500)
    const { cookie } = login('producer')
    expect((await call(BODY, cookie)).status).toBe(502)
    expect(calls).toHaveLength(1)
    vi.stubEnv('INTERNAL_API_SECRET', '')
    expect((await call(BODY, cookie)).status).toBe(503)
    expect(calls).toHaveLength(1)
  })

  it('la background function solo acepta la llamada interna con el secreto', async () => {
    const body = { ...BODY, requestedBy: { type: 'user', userId: 1, organizationId: 7 } }
    const bg = (headers) => post(sendEventNotificationBackground, '/.netlify/functions/send-event-notification-background', body, login('producer').cookie, headers)
    expect((await bg()).status).toBe(401)
    expect((await bg({ 'x-internal-secret': FORGED_SECRET })).status).toBe(401)
    expect(writes()).toEqual([])
  })
})
