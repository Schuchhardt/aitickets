// Hora límite de ingreso de la lista (ítem 8): una entrada de lista "hasta 01:00" de una función de las 23:00
// escaneada a las 01:05 queda "fuera de horario" y la puerta decide (force). Lógica pura
// (src/lib/entryDeadline.mjs), checkInTicket (puerta y asistente de IA) y la lista del escáner. Sin red ni BD.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { entryDeadlineAt, entryDeadlineCheck, entryUntilNextDay, normalizeEntryUntil, lateEntryMessage } from '../../src/lib/entryDeadline.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))

const { checkInTicket } = await import('../../src/lib/checkinAccess.ts')
const { attachEntryDeadlines, entryDeadlineState, loadEntryDeadlines } = await import('../../netlify/lib/checkin.mjs')
const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { accessTools } = await import('../../src/lib/producer-api/tools/access.ts')

const LIST = '11111111-1111-4111-8111-111111111111'
const COVER = '22222222-2222-4222-8222-222222222222'
const LIST2 = '33333333-3333-4333-8333-333333333333'

// Viernes 6 de noviembre de 2026, 23:00 (Santiago, UTC-3)
const DATES = [{ id: 501, event_id: 10, date: '2026-11-06', start_time: '23:00:00' }]
const at = (iso) => new Date(`${iso}-03:00`)

function seed({ withColumn = true } = {}) {
  db = createFakeSupabase({
    tables: {
      events: [{ id: 10, name: 'Viernes', slug: 'viernes', organization_id: 7 }],
      event_dates: DATES.map((d) => ({ ...d })),
      event_tickets: [
        { id: 100, event_id: 10, ticket_name: 'Lista free', event_date_id: null, ...(withColumn ? { entry_until: '01:00:00' } : {}) },
        { id: 101, event_id: 10, ticket_name: 'Cover', event_date_id: null, ...(withColumn ? { entry_until: null } : {}) },
      ],
      event_attendees: [
        { id: LIST, event_id: 10, event_ticket_id: 100, qr_code: 'qr-list', status: 'active', attendees: { first_name: 'Ana', last_name: 'P' }, event_tickets: { ticket_name: 'Lista free', event_date_id: null } },
        { id: COVER, event_id: 10, event_ticket_id: 101, qr_code: 'qr-cover', status: 'active', attendees: { first_name: 'Beto', last_name: '' }, event_tickets: { ticket_name: 'Cover', event_date_id: null } },
        { id: LIST2, event_id: 10, event_ticket_id: 100, qr_code: 'qr-list2', status: 'active', attendees: { first_name: 'Ceci', last_name: '' }, event_tickets: { ticket_name: 'Lista free', event_date_id: null } },
      ],
      aitickets_attendee_checkins: [],
      aitickets_api_audit: [],
    },
  })
  if (!withColumn) db.failOn('event_tickets', 'select', { code: '42703', message: 'column event_tickets.entry_until does not exist' }, { once: false })
}

beforeEach(() => {
  vi.useFakeTimers()
  seed()
})
afterEach(() => vi.useRealTimers())

describe('la hora límite cruza la medianoche', () => {
  it('antes del inicio de la función es de la madrugada siguiente', () => {
    expect(normalizeEntryUntil('01:00:00')).toBe('01:00')
    expect(normalizeEntryUntil('25:00')).toBeNull()
    expect(normalizeEntryUntil('')).toBeNull()
    expect(entryUntilNextDay('01:00', '23:00:00')).toBe(true)
    expect(entryUntilNextDay('23:30', '23:00:00')).toBe(false)
    expect(entryDeadlineAt('01:00', DATES[0]).toISOString()).toBe('2026-11-07T04:00:00.000Z')
    expect(entryDeadlineAt('23:30', DATES[0]).toISOString()).toBe('2026-11-07T02:30:00.000Z')
  })

  it('a las 00:59 está a tiempo; a las 01:05 está fuera de horario', () => {
    const base = { entryUntil: '01:00', dates: DATES }
    expect(entryDeadlineCheck({ ...base, at: at('2026-11-07T00:59:00') })).toMatchObject({ late: false, entry_until: '01:00' })
    expect(entryDeadlineCheck({ ...base, at: at('2026-11-07T01:05:00') })).toMatchObject({ late: true })
    // Sin hora límite, o sin funciones: no aplica
    expect(entryDeadlineCheck({ entryUntil: null, dates: DATES, at: at('2026-11-07T05:00:00') })).toBeNull()
    expect(entryDeadlineCheck({ entryUntil: '01:00', dates: [], at: at('2026-11-07T05:00:00') })).toBeNull()
    expect(lateEntryMessage('01:00:00')).toBe('Fuera de horario: la entrada valía hasta las 01:00.')
  })

  it('con varias noches se mide contra la de la entrada o la que se valida ahora', () => {
    const nights = [...DATES, { id: 502, date: '2026-11-13', start_time: '23:00:00' }]
    expect(entryDeadlineCheck({ entryUntil: '01:00', eventDateId: 502, dates: nights, at: at('2026-11-07T01:05:00') })).toMatchObject({ late: false })
    expect(entryDeadlineCheck({ entryUntil: '01:00', dates: nights, at: at('2026-11-14T01:05:00') })).toMatchObject({ late: true })
  })
})

describe('confirmar el ingreso', () => {
  it('fuera de horario responde late_entry sin validar; con force entra', async () => {
    vi.setSystemTime(at('2026-11-07T01:05:00'))
    const late = await checkInTicket(db, 10, { ticketId: LIST })
    expect(late).toMatchObject({ ok: false, code: 'late_entry', entry_until: '01:00', message: 'Fuera de horario: la entrada valía hasta las 01:00.' })
    expect(db.tables.event_attendees.find((a) => a.id === LIST).status).toBe('active')

    const forced = await checkInTicket(db, 10, { ticketId: LIST }, undefined, { force: true })
    expect(forced).toMatchObject({ ok: true, late_entry: true, entry_until: '01:00' })
    expect(db.tables.event_attendees.find((a) => a.id === LIST).status).toBe('validated')
    // Ya entró: el segundo escaneo dice "ya validada", no "fuera de horario"
    expect(await checkInTicket(db, 10, { ticketId: LIST })).toMatchObject({ ok: false, code: 'already_validated' })
  })

  it('a tiempo, o un tipo sin hora límite, entra normal', async () => {
    vi.setSystemTime(at('2026-11-07T00:40:00'))
    expect(await checkInTicket(db, 10, { ticketId: LIST2 })).toMatchObject({ ok: true })
    vi.setSystemTime(at('2026-11-07T03:00:00'))
    const cover = await checkInTicket(db, 10, { ticketId: COVER })
    expect(cover.ok).toBe(true)
    expect(cover).not.toHaveProperty('late_entry')
  })

  it('una validación offline se mide con la hora del escaneo', async () => {
    vi.setSystemTime(at('2026-11-07T01:30:00'))
    const res = await checkInTicket(db, 10, { ticketId: LIST2 }, at('2026-11-07T00:50:00').toISOString())
    expect(res).toMatchObject({ ok: true })
    expect(res).not.toHaveProperty('late_entry')
  })

  it('sin la columna (migración pendiente) entra a cualquier hora', async () => {
    seed({ withColumn: false })
    vi.setSystemTime(at('2026-11-07T04:00:00'))
    expect(await checkInTicket(db, 10, { ticketId: LIST })).toMatchObject({ ok: true })
    expect((await loadEntryDeadlines(db, 10)).size).toBe(0)
  })

  it('check_in_attendee explica el conflicto y acepta force', async () => {
    const ctx = {
      supabase: db,
      actor: { keyId: 'k', userId: 1, orgId: 7, role: 'validator', name: 'Ana', email: 'a@p.cl', scopes: ['read', 'attendees'], eventIds: null },
      origin: 'https://aitickets.test',
      requestUrl: new URL('https://aitickets.test/api/mcp'),
      channel: 'mcp',
    }
    const tool = accessTools.find((t) => t.name === 'check_in_attendee')
    vi.setSystemTime(at('2026-11-07T01:05:00'))
    const refused = await runTool(tool, { event_id: 10, qr_code: 'qr-list' }, ctx)
    expect(refused).toMatchObject({ ok: false, code: 'conflict' })
    expect(refused.message).toMatch(/^Fuera de horario: la entrada valía hasta las 01:00\. .*force: true/)
    const forced = await runTool(tool, { event_id: 10, qr_code: 'qr-list', force: true }, ctx)
    expect(forced.result).toMatchObject({ status: 'validated', late_entry: true, entry_until: '01:00' })
  })
})

describe('el escáner', () => {
  it('recibe la hora límite de cada entrada para marcarla sin conexión', async () => {
    const list = await attachEntryDeadlines(db, 10, db.tables.event_attendees)
    expect(list.find((a) => a.id === LIST).event_tickets.entry_until).toBe('01:00')
    expect(list.find((a) => a.id === COVER).event_tickets.entry_until).toBeUndefined()
  })

  it('validate-ticket ve si llega fuera de horario ahora', async () => {
    const row = db.tables.event_attendees.find((a) => a.id === LIST)
    expect(await entryDeadlineState(db, 10, row, at('2026-11-07T01:05:00'))).toMatchObject({ late: true, entry_until: '01:00' })
    expect(await entryDeadlineState(db, 10, db.tables.event_attendees.find((a) => a.id === COVER))).toBeNull()
  })
})
