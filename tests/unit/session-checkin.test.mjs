// Ingreso por función de las entradas multifunción (ítem 16): un pase de 3 días entra una vez cada día; el
// segundo escaneo del mismo día dice "Ya ingresó hoy". Lógica pura (src/lib/sessionCheckin.mjs), checkInTicket
// (panel, asistente de IA y escáner de puerta) y la vista del escáner. Sin red ni BD.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { isMultiSession, pickSession, sessionView, addLocalSessionCheckin } from '../../src/lib/sessionCheckin.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))

const { checkInTicket } = await import('../../src/lib/checkinAccess.ts')
const { attachSessionCheckins, ticketSessionState } = await import('../../netlify/lib/checkin.mjs')
const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { accessTools } = await import('../../src/lib/producer-api/tools/access.ts')

const PASS = '11111111-1111-4111-8111-111111111111'
const SINGLE = '22222222-2222-4222-8222-222222222222'
const VOID = '33333333-3333-4333-8333-333333333333'

// Seminario de 3 días (jue 5 a sáb 7 de noviembre de 2026), 09:00
const DATES = [
  { id: 501, event_id: 10, date: '2026-11-05', start_time: '09:00:00' },
  { id: 502, event_id: 10, date: '2026-11-06', start_time: '09:00:00' },
  { id: 503, event_id: 10, date: '2026-11-07', start_time: '09:00:00' },
]
// 10:00 en Santiago (UTC-3) de cada día
const at = (day, hhmm = '10:00') => new Date(`2026-11-0${day}T${hhmm}:00-03:00`)

function seed({ withTable = true } = {}) {
  db = createFakeSupabase({
    tables: {
      events: [{ id: 10, name: 'Seminario', slug: 'seminario', organization_id: 7 }],
      event_dates: DATES.map((d) => ({ ...d })),
      event_tickets: [
        { id: 100, event_id: 10, ticket_name: 'Pase 3 días', event_date_id: null },
        { id: 101, event_id: 10, ticket_name: 'Solo viernes', event_date_id: 502 },
      ],
      event_attendees: [
        { id: PASS, event_id: 10, event_ticket_id: 100, qr_code: 'qr-pass', status: 'active', attendees: { first_name: 'Ana', last_name: 'Pérez' }, event_tickets: { ticket_name: 'Pase 3 días', event_date_id: null } },
        { id: SINGLE, event_id: 10, event_ticket_id: 101, qr_code: 'qr-single', status: null, attendees: { first_name: 'Beto', last_name: '' }, event_tickets: { ticket_name: 'Solo viernes', event_date_id: 502 } },
        { id: VOID, event_id: 10, event_ticket_id: 100, qr_code: 'qr-void', status: 'cancelled', attendees: { first_name: 'Ceci' }, event_tickets: { ticket_name: 'Pase 3 días', event_date_id: null } },
      ],
      ...(withTable ? { aitickets_attendee_checkins: [] } : {}),
      aitickets_api_audit: [],
    },
    unique: { aitickets_attendee_checkins: [['event_attendee_id', 'event_date_id']] },
  })
  if (!withTable) db.failOn('aitickets_attendee_checkins', 'insert', { code: '42P01', message: 'relation "aitickets_attendee_checkins" does not exist' }, { once: false })
}

const checkIn = (ticketId) => checkInTicket(db, 10, { ticketId })

beforeEach(() => {
  vi.useFakeTimers()
  seed()
})
afterEach(() => vi.useRealTimers())

describe('qué función se valida', () => {
  it('la de hoy; con dos el mismo día, la que ya empezó o empieza dentro de 2 horas', () => {
    expect(isMultiSession(null, DATES)).toBe(true)
    expect(isMultiSession(502, DATES)).toBe(false)
    expect(isMultiSession(null, DATES.slice(0, 1))).toBe(false)
    expect(pickSession(DATES, at(6)).id).toBe(502)

    const twoToday = [
      { id: 1, date: '2026-11-05', start_time: '10:00:00' },
      { id: 2, date: '2026-11-05', start_time: '19:00:00' },
    ]
    expect(pickSession(twoToday, at(5, '08:30')).id).toBe(1)
    expect(pickSession(twoToday, at(5, '17:15')).id).toBe(2)
  })

  it('si hoy no hay función, la más cercana (a igual distancia, la que viene)', () => {
    expect(pickSession(DATES, new Date('2026-11-03T12:00:00-03:00')).id).toBe(501)
    expect(pickSession(DATES, new Date('2026-11-10T12:00:00-03:00')).id).toBe(503)
    const gap = [
      { id: 1, date: '2026-11-04', start_time: '09:00:00' },
      { id: 2, date: '2026-11-06', start_time: '09:00:00' },
    ]
    expect(pickSession(gap, at(5)).id).toBe(2)
  })

  it('el escáner ve el estado de la función de hoy, también sin conexión', () => {
    const pass = { id: PASS, status: 'validated', event_tickets: { event_date_id: null }, session_checkins: [{ event_date_id: 501, checked_in_at: at(5).toISOString() }] }
    expect(sessionView(pass, DATES, at(5))).toMatchObject({ status: 'validated', session_date_id: 501, sessions_attended: 1, sessions_total: 3 })
    const friday = sessionView(pass, DATES, at(6))
    expect(friday).toMatchObject({ status: 'active', validated_at: null, session_date_id: 502, ticket_status: 'validated' })
    // Validado offline el viernes
    const local = sessionView(addLocalSessionCheckin(friday, DATES, at(6).toISOString(), at(6)), DATES, at(6))
    expect(local).toMatchObject({ status: 'validated', sessions_attended: 2 })
    // Sin session_checkins (tabla sin migrar) o anulada: tal cual
    expect(sessionView({ id: 'x', status: 'validated', event_tickets: { event_date_id: null } }, DATES, at(6)).status).toBe('validated')
    expect(sessionView({ ...pass, status: 'cancelled' }, DATES, at(6)).status).toBe('cancelled')
  })
})

describe('checkInTicket con un pase de 3 días', () => {
  it('entra una vez cada día; el segundo escaneo del mismo día dice "Ya ingresó hoy"', async () => {
    vi.setSystemTime(at(5))
    const day1 = await checkIn(PASS)
    expect(day1).toMatchObject({ ok: true, sessions_attended: 1, sessions_total: 3, function_label: 'Jue 5 nov · 09:00' })
    expect(db.tables.event_attendees.find((a) => a.id === PASS)).toMatchObject({ status: 'validated', validated_at: at(5).toISOString() })

    vi.setSystemTime(at(5, '11:30'))
    const again = await checkIn(PASS)
    expect(again).toMatchObject({ ok: false, code: 'already_validated', message: 'Ya ingresó hoy.', validated_at: at(5).toISOString() })

    vi.setSystemTime(at(6))
    expect(await checkIn(PASS)).toMatchObject({ ok: true, sessions_attended: 2 })
    vi.setSystemTime(at(7))
    expect(await checkIn(PASS)).toMatchObject({ ok: true, sessions_attended: 3 })

    expect(db.tables.aitickets_attendee_checkins.map((c) => c.event_date_id)).toEqual([501, 502, 503])
    // validated_at sigue siendo el primer ingreso (asistió)
    expect(db.tables.event_attendees.find((a) => a.id === PASS).validated_at).toBe(at(5).toISOString())
  })

  it('una validación offline se registra en la función del día en que se escaneó', async () => {
    vi.setSystemTime(at(6, '08:00'))
    const res = await checkInTicket(db, 10, { ticketId: PASS }, at(5, '18:00').toISOString())
    expect(res).toMatchObject({ ok: true, function_label: 'Jue 5 nov · 09:00' })
    expect(db.tables.aitickets_attendee_checkins[0]).toMatchObject({ event_date_id: 501 })
  })

  it('las entradas de una función y las anuladas siguen con la regla de siempre', async () => {
    vi.setSystemTime(at(6))
    expect(await checkIn(SINGLE)).toMatchObject({ ok: true, function_mismatch: false })
    expect(await checkIn(SINGLE)).toMatchObject({ ok: false, code: 'already_validated' })
    expect(await checkIn(VOID)).toMatchObject({ ok: false, code: 'invalid_status' })
    expect(db.tables.aitickets_attendee_checkins).toHaveLength(0)
  })

  it('sin la tabla migrada vuelve a un solo ingreso', async () => {
    seed({ withTable: false })
    vi.setSystemTime(at(5))
    expect(await checkIn(PASS)).toMatchObject({ ok: true })
    vi.setSystemTime(at(6))
    expect(await checkIn(PASS)).toMatchObject({ ok: false, code: 'already_validated' })
  })
})

describe('escáner y asistente de IA', () => {
  it('la lista y la búsqueda por QR muestran el estado de la función de hoy', async () => {
    vi.setSystemTime(at(5))
    await checkIn(PASS)
    const list = await attachSessionCheckins(db, 10, db.tables.event_attendees, DATES)
    expect(list.find((a) => a.id === PASS).session_checkins).toEqual([{ event_date_id: 501, checked_in_at: at(5).toISOString() }])
    expect(list.find((a) => a.id === SINGLE).session_checkins).toBeUndefined()

    const pass = db.tables.event_attendees.find((a) => a.id === PASS)
    expect(await ticketSessionState(db, 10, pass, at(5))).toMatchObject({ status: 'validated', sessions_attended: 1, sessions_total: 3 })
    expect(await ticketSessionState(db, 10, pass, at(6))).toMatchObject({ status: 'active', validated_at: null, function_label: 'Vie 6 nov · 09:00' })
  })

  it('check_in_attendee cuenta los ingresos del pase y explica el conflicto', async () => {
    const ctx = {
      supabase: db,
      actor: { keyId: 'k', userId: 1, orgId: 7, role: 'validator', name: 'Ana', email: 'a@p.cl', scopes: ['read', 'attendees'], eventIds: null },
      origin: 'https://aitickets.test',
      requestUrl: new URL('https://aitickets.test/api/mcp'),
      channel: 'mcp',
    }
    const tool = accessTools.find((t) => t.name === 'check_in_attendee')
    vi.setSystemTime(at(5))
    const first = await runTool(tool, { event_id: 10, qr_code: 'qr-pass' }, ctx)
    expect(first.result).toMatchObject({ status: 'validated', sessions_attended: 1, sessions_total: 3, function: 'Jue 5 nov · 09:00' })
    const again = await runTool(tool, { event_id: 10, qr_code: 'qr-pass' }, ctx)
    expect(again).toMatchObject({ ok: false, code: 'conflict' })
    expect(again.message).toMatch(/^Ya ingresó hoy \(.+\): el pase entra una vez por función\.$/)

    const stats = await runTool(accessTools.find((t) => t.name === 'get_checkin_stats'), { event_id: 10 }, ctx)
    expect(stats.result.multi_pass_check_ins_by_function).toEqual([{ function: expect.objectContaining({ id: 501 }), checked_in: 1 }])
  })
})
