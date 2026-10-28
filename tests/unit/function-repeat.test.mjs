// Repetir funciones con un patrón y copiar las entradas a cada función: el patrón compartido
// (src/lib/functionPattern.mjs), el editor de los formularios (functionRepeat.js), el tope en el servidor y
// update_event_functions con repeat / copy_tickets_from_function_id. Sin red ni BD.
import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { repeatDates, patternError, weekdaysLabel, MAX_FUNCTIONS } from '../../src/lib/functionPattern.mjs'
import { planRepeat, applyRepeat, planTicketCopy, applyTicketCopy } from '../../src/components/events/functionRepeat.js'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))
vi.mock('../../src/pages/api/_lib/server-utils', async (importOriginal) => ({
  ...(await importOriginal()),
  callInternalFunction: vi.fn(async () => ({ ok: true, status: 202, data: {} })),
  notifySlack: vi.fn(async () => {}),
}))
const { assertFunctionCount } = await import('../../src/pages/api/_lib/events.ts')
const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { getTool } = await import('../../src/lib/producer-api/tools/index.ts')

describe('patrón de funciones', () => {
  it('jueves a domingo hasta el 30 de noviembre', () => {
    const dates = repeatDates({ weekdays: ['jueves', 'viernes', 'sabado', 'domingo'], from: '2030-11-01', until: '2030-11-30' })
    // 1-nov-2030 es viernes
    expect(dates[0]).toBe('2030-11-01')
    expect(dates.at(-1)).toBe('2030-11-30')
    expect(dates).toHaveLength(18)
    expect(weekdaysLabel([4, 5, 6, 0])).toBe('jue a dom')
    expect(weekdaysLabel(['lunes', 'miercoles', 'viernes'])).toBe('lun, mié y vie')
  })

  it('rechaza patrones sin días, al revés o sin fecha válida', () => {
    expect(patternError({ weekdays: [], from: '2030-11-01', until: '2030-11-30' })).toMatch(/día/)
    expect(patternError({ weekdays: [1], from: '2030-11-30', until: '2030-11-01' })).toMatch(/anterior/)
    expect(patternError({ weekdays: [1], from: '2030-02-30', until: '2030-03-01' })).toMatch(/desde/)
    expect(repeatDates({ weekdays: [1], from: '2030-11-30', until: '2030-11-01' })).toEqual([])
  })
})

describe('editor de funciones del formulario', () => {
  let seq = 0
  const newId = () => 2_000_000_000_000 + seq++
  const locations = () => [{ id: 1, dates: [{ id: 11, date: '2030-11-06', startTime: '20:00', endTime: '' }] }]

  it('agrega las funciones del patrón sin repetir las que ya están, ordenadas', () => {
    const locs = locations()
    const pattern = { weekdays: ['miercoles', 'sabado'], from: '2030-11-01', until: '2030-11-15', startTime: '20:00', endTime: '22:00' }
    const plan = applyRepeat(locs, 0, pattern, newId)
    expect(plan.error).toBeNull()
    expect(plan.skipped).toBe(1) // el miércoles 6 ya estaba
    expect(locs[0].dates.map((d) => d.date)).toEqual(['2030-11-02', '2030-11-06', '2030-11-09', '2030-11-13'])
    expect(locs[0].dates[0]).toMatchObject({ startTime: '20:00', endTime: '22:00' })
  })

  it('reemplaza la fila vacía inicial y avisa antes de pasar el tope', () => {
    const locs = [{ id: 1, dates: [{ id: 11, date: '', startTime: '21:00' }] }]
    applyRepeat(locs, 0, { weekdays: [6], from: '2030-11-01', until: '2030-11-10', startTime: '21:00' }, newId)
    expect(locs[0].dates.map((d) => d.date)).toEqual(['2030-11-02', '2030-11-09'])

    const big = { weekdays: [0, 1, 2, 3, 4, 5, 6], from: '2030-01-01', until: '2030-03-31', startTime: '20:00' }
    const plan = planRepeat(locations(), 0, big)
    expect(plan.error).toMatch(new RegExp(`Quedarían 91 funciones y el máximo es ${MAX_FUNCTIONS}`))
    const untouched = locations()
    applyRepeat(untouched, 0, big, newId)
    expect(untouched[0].dates).toHaveLength(1)
  })

  it('copia las entradas de "todas las funciones" a cada función, con su tanda dentro de la misma función', () => {
    const tickets = [
      { id: 1, name: 'Preventa', quantity: 50, eventDateId: '', opensAfterId: '' },
      { id: 2, name: 'General', quantity: 100, eventDateId: '', opensAfterId: 1 },
    ]
    const res = applyTicketCopy(tickets, [11, 12, 13], newId)
    expect(res.error).toBeNull()
    expect(res.created).toBe(4)
    expect(tickets.filter((t) => t.eventDateId === 11).map((t) => t.id)).toEqual([1, 2])
    const fri = tickets.filter((t) => t.eventDateId === 12)
    expect(fri.map((t) => t.name)).toEqual(['Preventa', 'General'])
    expect(fri[1].opensAfterId).toBe(fri[0].id)
    // Ya no queda nada que copiar
    expect(planTicketCopy(tickets, [11, 12, 13]).error).toMatch(/ya tienen/)
  })

  it('en el editor no reasigna entradas guardadas de "todas las funciones"', () => {
    const tickets = [{ id: 100, name: 'General', quantity: 100, eventDateId: '' }]
    const plan = planTicketCopy(tickets, [11, 12], { canPin: (t) => t.id > 1e12 })
    expect(plan.pinBlocked).toBe(true)
    // Con una entrada asignada a una función, sí copia esa
    tickets.push({ id: 101, name: 'Jueves', quantity: 80, eventDateId: 11 })
    expect(planTicketCopy(tickets, [11, 12], { canPin: (t) => t.id > 1e12 }).template.map((t) => t.id)).toEqual([101])
  })

  it('el servidor rechaza más de 60 funciones', () => {
    const dates = Array.from({ length: 61 }, () => ({}))
    expect(() => assertFunctionCount([{ dates }])).toThrow(/Máximo 60 funciones/)
    expect(() => assertFunctionCount([{ dates: dates.slice(1) }])).not.toThrow()
  })
})

describe('update_event_functions con repeat', () => {
  const seed = () => {
    db = createFakeSupabase({
      tables: {
        organizations: [{ id: 7, public_name: 'Mi Productora' }],
        events: [{ id: 10, name: 'Obra', slug: 'obra', status: 'draft', accessibility: 'public', organization_id: 7, description: '' }],
        venues: [{ id: 'v1', name: 'Teatro', address_line1: 'Calle 1', city: 'Santiago' }],
        event_locations: [{ id: 'l1', event_id: 10, venue_id: 'v1', venues: { id: 'v1', name: 'Teatro', address_line1: 'Calle 1', city: 'Santiago' } }],
        event_dates: [{ id: 501, event_id: 10, event_location_id: 'l1', date: '2030-11-07', start_time: '20:00', end_time: null }],
        event_tickets: [
          { id: 100, event_id: 10, event_date_id: 501, ticket_name: 'Platea', price: 12000, total_quantity: 80, status: 'available', is_gift: false },
          { id: 101, event_id: 10, event_date_id: 501, ticket_name: 'Platea 2', price: 15000, total_quantity: 80, status: 'available', is_gift: false, opens_after_ticket_id: 100 },
          { id: 102, event_id: 10, event_date_id: 501, ticket_name: 'Cortesía', price: 0, status: 'available', is_gift: true },
          { id: 103, event_id: 10, event_date_id: null, ticket_name: 'Abono', price: 40000, status: 'available', is_gift: false },
        ],
        event_attendees: [],
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
  const repeat = { weekdays: ['jueves', 'viernes', 'sabado', 'domingo'], from: '2030-11-01', until: '2030-11-30', start_time: '20:00' }

  it('jueves a domingo hasta el 30 de noviembre crea las funciones con sus entradas en un paso', async () => {
    seed()
    const res = await run({ event_id: 10, repeat, copy_tickets_from_function_id: 501 })
    expect(res.ok).toBe(true)
    expect(res.result.repeat_added).toBe(17) // 18 fechas, el jueves 7 ya estaba
    expect(res.result.repeat_skipped).toBe(1)
    expect(db.tables.event_dates.filter((d) => d.event_id === 10)).toHaveLength(18)
    // Platea y Platea 2 en cada función nueva; ni la cortesía ni el abono
    expect(res.result.tickets_copied).toBe(34)
    const newFn = db.tables.event_dates.find((d) => d.date === '2030-11-08')
    const copies = db.tables.event_tickets.filter((t) => t.event_date_id === newFn.id)
    expect(copies.map((t) => t.ticket_name)).toEqual(['Platea', 'Platea 2'])
    expect(copies[0]).toMatchObject({ price: 12000, total_quantity: 80, is_gift: false })
    expect(copies[1].opens_after_ticket_id).toBe(copies[0].id)
  })

  it('si pasaría de 60 funciones no crea nada', async () => {
    seed()
    const res = await run({ event_id: 10, repeat: { ...repeat, weekdays: ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'], until: '2031-01-31' } })
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/Quedarían \d+ funciones y el máximo es 60/)
    expect(db.tables.event_dates).toHaveLength(1)
  })

  it('copy_tickets_from_function_id exige funciones nuevas y una función con entradas propias', async () => {
    seed()
    expect((await run({ event_id: 10, copy_tickets_from_function_id: 501 })).message).toMatch(/add o repeat/)
    db.tables.event_tickets = db.tables.event_tickets.filter((t) => t.event_date_id !== 501)
    expect((await run({ event_id: 10, repeat, copy_tickets_from_function_id: 501 })).message).toMatch(/no tiene entradas propias/)
    expect(db.tables.event_dates).toHaveLength(1)
  })
})
