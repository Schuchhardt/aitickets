// update_event_functions: cambiar fechas/horarios de funciones por la API de productores, recálculo de las fechas
// del evento, confirmación solo cuando hay asistentes afectados y aviso por correo. Sin red ni BD.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

const mocks = vi.hoisted(() => ({
  callInternalFunction: vi.fn(async () => ({ ok: true, status: 202, data: {} })),
}))

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))
vi.mock('../../src/pages/api/_lib/server-utils', async (importOriginal) => ({
  ...(await importOriginal()),
  callInternalFunction: mocks.callInternalFunction,
  notifySlack: vi.fn(async () => {}),
}))

const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { getTool } = await import('../../src/lib/producer-api/tools/index.ts')

function seed({ status = 'draft', attendees = [] } = {}) {
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Mi Productora' }, { id: 8, public_name: 'Otra' }],
      events: [
        { id: 10, name: 'Fiesta', slug: 'fiesta', status, accessibility: 'public', organization_id: 7, description: '<p>Te esperamos el 1 de marzo</p>' },
        { id: 20, name: 'Ajeno', slug: 'ajeno', status: 'published', organization_id: 8 },
      ],
      venues: [{ id: 'v1', name: 'Club', address_line1: 'Calle 1', city: 'Santiago' }],
      event_locations: [{ id: 'l1', event_id: 10, venue_id: 'v1', venues: { id: 'v1', name: 'Club', address_line1: 'Calle 1', city: 'Santiago' } }],
      event_dates: [
        { id: 501, event_id: 10, event_location_id: 'l1', date: '2030-03-01', start_time: '21:00', end_time: '03:00' },
        { id: 502, event_id: 10, event_location_id: 'l1', date: '2030-03-02', start_time: '21:00', end_time: null },
        { id: 900, event_id: 20, event_location_id: 'lx', date: '2030-05-01', start_time: '20:00', end_time: null },
      ],
      event_tickets: [
        { id: 100, event_id: 10, event_date_id: null, ticket_name: 'General', price: 10000 },
        { id: 101, event_id: 10, event_date_id: 502, ticket_name: 'Sábado', price: 10000 },
      ],
      event_attendees: attendees,
      aitickets_scheduled_messages: [],
      aitickets_api_audit: [],
      aitickets_api_confirmations: [],
      aitickets_api_idempotency: [],
    },
  })
}

const ctx = () => ({
  supabase: db,
  actor: { keyId: 'k1', userId: 1, orgId: 7, role: 'producer', name: 'Ana', email: 'ana@prod.cl', scopes: ['read', 'write', 'publish'] },
  origin: 'https://aitickets.cl',
  requestUrl: new URL('https://aitickets.cl/api/mcp'),
  channel: 'mcp',
})
const run = (args) => runTool(getTool('update_event_functions'), args, ctx())
const fn = (id) => db.tables.event_dates.find((d) => d.id === id)
const event = () => db.tables.events.find((e) => e.id === 10)

beforeEach(() => {
  mocks.callInternalFunction.mockClear()
})

describe('update_event_functions', () => {
  it('en borrador cambia la función directo y recalcula las fechas del evento', async () => {
    seed()
    const res = await run({ event_id: 10, changes: [{ function_id: 501, date: '2030-04-10', start_time: '22:00', end_time: '04:00' }] })
    expect(res.ok).toBe(true)
    expect(res.result.status).toBeUndefined() // no pidió confirmación
    expect(fn(501)).toMatchObject({ date: '2030-04-10', start_time: '22:00', end_time: '04:00' })
    // start = sáb 2 mar 21:00 (Chile, UTC-3) y end = 10 abr 04:00 del día siguiente → 11 abr (UTC-4 desde abril)
    expect(event().start_date).toBe('2030-03-03T00:00:00.000Z')
    expect(event().end_date).toBe('2030-04-11T08:00:00.000Z')
    expect(res.result.functions.map((f) => f.id)).toEqual([502, 501])
    expect(res.result.attendees_notification_queued).toBe(false)
    // La descripción ya no coincide con ninguna función
    expect(res.result.warnings?.join(' ')).toMatch(/descripci/i)
    expect(mocks.callInternalFunction).not.toHaveBeenCalled()
  })

  it('function_id es opcional si el evento tiene una sola función', async () => {
    seed()
    db.tables.event_dates = db.tables.event_dates.filter((d) => d.id !== 502)
    db.tables.event_tickets = db.tables.event_tickets.filter((t) => t.id !== 101)
    await run({ event_id: 10, changes: [{ start_time: '23:30' }] })
    expect(fn(501)).toMatchObject({ date: '2030-03-01', start_time: '23:30', end_time: '03:00' })
  })

  it('con varias funciones exige function_id', async () => {
    seed()
    expect(await run({ event_id: 10, changes: [{ date: '2030-04-10' }] })).toMatchObject({ ok: false, code: 'invalid_input' })
  })

  it('agrega y elimina funciones', async () => {
    seed()
    const res = await run({ event_id: 10, add: [{ date: '2030-03-08', start_time: '21:00' }], remove: [501] })
    expect(res.ok).toBe(true)
    expect(fn(501)).toBeUndefined()
    expect(db.tables.event_dates.filter((d) => d.event_id === 10).map((d) => d.date).sort()).toEqual(['2030-03-02', '2030-03-08'])
    expect(db.tables.event_dates.find((d) => d.date === '2030-03-08')).toMatchObject({ event_location_id: 'l1' })
  })

  it('no elimina una función con entradas vigentes propias ni deja el evento sin funciones', async () => {
    seed({ attendees: [{ id: 1, event_id: 10, event_ticket_id: 101, status: 'valid' }] })
    expect(await run({ event_id: 10, remove: [502] })).toMatchObject({ ok: false, code: 'conflict' })
    expect(fn(502)).toBeDefined()
    expect(await run({ event_id: 10, remove: [501, 502] })).toMatchObject({ ok: false })
  })

  it('rechaza fechas pasadas, duplicadas y funciones de otro evento', async () => {
    seed()
    expect(await run({ event_id: 10, changes: [{ function_id: 501, date: '2020-01-01' }] })).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(await run({ event_id: 10, changes: [{ function_id: 501, date: '2030-03-02' }] })).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(await run({ event_id: 10, changes: [{ function_id: 900, date: '2030-06-01' }] })).toMatchObject({ ok: false, code: 'not_found' })
    expect(await run({ event_id: 20, changes: [{ function_id: 900, date: '2030-06-01' }] })).toMatchObject({ ok: false, code: 'not_found' })
    expect(fn(501).date).toBe('2030-03-01')
    expect(fn(900).date).toBe('2030-05-01')
  })

  it('publicado con asistentes: pide confirmación, aplica con el token y avisa por correo', async () => {
    seed({ status: 'published', attendees: [{ id: 1, event_id: 10, event_ticket_id: 100, status: 'valid' }, { id: 2, event_id: 10, event_ticket_id: 100, status: 'cancelled' }] })
    const args = { event_id: 10, changes: [{ function_id: 501, date: '2030-03-15' }], notify_message: 'Por lluvia' }
    const first = await run(args)
    expect(first.result).toMatchObject({ status: 'confirmation_required', details: { attendees: 1, notify_attendees: true } })
    expect(first.result.summary).toMatch(/Nuevas fechas/)
    expect(fn(501).date).toBe('2030-03-01') // nada se ejecutó

    const second = await run({ ...args, confirmation_token: first.result.confirmation_token })
    expect(second.ok).toBe(true)
    expect(fn(501).date).toBe('2030-03-15')
    expect(second.result).toMatchObject({ attendees_affected: 1, attendees_notification_queued: true })
    expect(mocks.callInternalFunction).toHaveBeenCalledTimes(1)
    const [, path, body] = mocks.callInternalFunction.mock.calls[0]
    expect(path).toBe('/.netlify/functions/send-event-notification-background')
    expect(body).toMatchObject({ eventId: 10, changeType: 'date_change', requestedBy: { userId: 1, via: 'mcp' } })
    expect(body.changeDescription).toMatch(/Mensaje del organizador: Por lluvia/)
  })

  it('publicado con asistentes: notify_attendees=false igual pide confirmación pero no envía correos', async () => {
    seed({ status: 'published', attendees: [{ id: 1, event_id: 10, event_ticket_id: 100, status: null }] })
    const args = { event_id: 10, changes: [{ function_id: 502, start_time: '20:00' }], notify_attendees: false }
    const first = await run(args)
    expect(first.result.status).toBe('confirmation_required')
    const second = await run({ ...args, confirmation_token: first.result.confirmation_token })
    expect(fn(502).start_time).toBe('20:00')
    expect(mocks.callInternalFunction).not.toHaveBeenCalled()
    expect(second.result.warnings.join(' ')).toMatch(/No se avisó/)
  })

  it('publicado sin asistentes: se aplica directo y no envía correos', async () => {
    seed({ status: 'published' })
    const res = await run({ event_id: 10, changes: [{ function_id: 502, date: '2030-03-09' }] })
    expect(res.result.status).toBeUndefined()
    expect(fn(502).date).toBe('2030-03-09')
    expect(mocks.callInternalFunction).not.toHaveBeenCalled()
  })

  it('avisa si hay recordatorios programados con la fecha anterior', async () => {
    seed()
    db.tables.aitickets_scheduled_messages.push({ id: 'm1', event_id: 10, status: 'scheduled', send_at: '2030-03-01T13:00:00Z' })
    const res = await run({ event_id: 10, changes: [{ function_id: 501, date: '2030-03-20' }] })
    expect(res.result.warnings.join(' ')).toMatch(/mensaje\(s\) programado/)
  })
})
