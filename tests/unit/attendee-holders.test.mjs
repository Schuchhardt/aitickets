// Emisión de entradas con asistente por QR (holder_name/holder_email, migración 202610300100) y mesas para N
// (people_per_ticket + unit_id/seat_number, 202610300110): buildAttendeeRows, ensureOrderAttendees (con la base sin
// migrar) y el recuento de sobreventa por mesa (findOversell cuenta mesas, igual que aitickets_ticket_availability).
import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { buildAttendeeRows, ensureOrderAttendees, loadPeoplePerTicket } from '../../netlify/lib/tickets.mjs'
import { findOversell } from '../../netlify/lib/orders.mjs'

const ORDER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('buildAttendeeRows', () => {
  it('entrada normal: una fila por unidad, sin columnas nuevas si no hay asistentes', () => {
    const rows = buildAttendeeRows({ eventId: 1, attendeeId: 9, orderId: ORDER, lines: [{ id: 5, quantity: 2 }] })
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r).not.toHaveProperty('unit_id')
      expect(r).not.toHaveProperty('holder_name')
      expect(r).toMatchObject({ event_id: 1, event_ticket_id: 5, attendee_id: 9, event_order_id: ORDER, status: 'active' })
    }
    expect(new Set(rows.map((r) => r.qr_code)).size).toBe(2)
  })

  it('mesa para 3: tres QR distintos con el mismo unit_id y lugares 1..3; cada mesa con su unit_id', () => {
    const rows = buildAttendeeRows({ eventId: 1, attendeeId: 9, orderId: ORDER, lines: [{ id: 7, quantity: 2 }], peopleOf: (id) => (id === 7 ? 3 : 1) })
    expect(rows).toHaveLength(6)
    expect(rows.map((r) => r.seat_number)).toEqual([1, 2, 3, 1, 2, 3])
    expect(new Set(rows.map((r) => r.unit_id)).size).toBe(2)
    expect(rows[0].unit_id).toBe(rows[2].unit_id)
    expect(new Set(rows.map((r) => r.qr_code)).size).toBe(6)
  })

  it('asigna los asistentes en orden, por tipo de entrada', () => {
    const rows = buildAttendeeRows({
      eventId: 1,
      attendeeId: 9,
      orderId: ORDER,
      lines: [{ id: 5, quantity: 2 }, { id: 6, quantity: 1 }],
      holders: [
        { ticket_id: 6, name: 'Carla', email: 'carla@mail.cl' },
        { ticket_id: 5, name: 'Ana', email: null },
        { ticket_id: 5, name: null, email: 'beto@mail.cl' },
      ],
    })
    expect(rows.map((r) => [r.event_ticket_id, r.holder_name ?? null, r.holder_email ?? null])).toEqual([
      [5, 'Ana', null],
      [5, null, 'beto@mail.cl'],
      [6, 'Carla', 'carla@mail.cl'],
    ])
  })
})

describe('ensureOrderAttendees', () => {
  const setup = () =>
    createFakeSupabase({
      tables: {
        event_tickets: [{ id: 5, event_id: 1, people_per_ticket: 1 }, { id: 7, event_id: 1, people_per_ticket: 4 }],
        event_orders: [{ id: ORDER, event_id: 1, attendee_holders: [{ ticket_id: 7, name: 'Ana', email: 'ana@mail.cl' }] }],
        event_attendees: [],
      },
    })

  it('emite la mesa con sus asistentes guardados en la orden', async () => {
    const db = setup()
    const r = await ensureOrderAttendees(db, { id: ORDER, event_id: 1, attendee_id: 9, ticket_details: [{ id: 7, quantity: 1 }, { id: 5, quantity: 1 }] })
    expect(r).toEqual({ created: 5, existing: 0 })
    const rows = db.tables.event_attendees
    expect(rows.filter((a) => a.event_ticket_id === 7)).toHaveLength(4)
    expect(rows[0]).toMatchObject({ holder_name: 'Ana', holder_email: 'ana@mail.cl', seat_number: 1 })
    expect(rows.find((a) => a.event_ticket_id === 5).unit_id).toBeUndefined()
    // Idempotente
    expect(await ensureOrderAttendees(db, { id: ORDER, event_id: 1, attendee_id: 9, ticket_details: [{ id: 7, quantity: 1 }] })).toEqual({ created: 0, existing: 5 })
  })

  it('base sin las columnas nuevas: emite igual, sin asistentes ni mesa', async () => {
    const db = setup()
    db.failOn('event_attendees', 'insert', { code: '42703', message: 'column "holder_name" does not exist' })
    const r = await ensureOrderAttendees(db, { id: ORDER, event_id: 1, attendee_id: 9, ticket_details: [{ id: 5, quantity: 1 }, { id: 7, quantity: 1 }] })
    expect(r.created).toBe(5)
    for (const a of db.tables.event_attendees) {
      expect(a).not.toHaveProperty('holder_name')
      expect(a).not.toHaveProperty('unit_id')
    }
  })

  it('sin la columna people_per_ticket, todas son entradas normales', async () => {
    const db = setup()
    db.failOn('event_tickets', 'select', { code: '42703', message: 'no existe' })
    expect(await loadPeoplePerTicket(db, 1)).toEqual(new Map())
  })
})

describe('findOversell cuenta mesas, no QR', () => {
  it('la propia mesa (4 QR) cuenta una vez: detecta la sobreventa si otra mesa ya ocupó el cupo', async () => {
    const own = Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, event_order_id: ORDER, event_ticket_id: 7, status: 'active', unit_id: 'u-own' }))
    const db = createFakeSupabase({
      tables: { event_tickets: [{ id: 7, event_id: 1, ticket_name: 'Mesa VIP', total_quantity: 1 }], event_attendees: own },
      // aitickets_ticket_availability (202610300110): 2 mesas emitidas (la de otra orden y esta)
      rpc: { aitickets_ticket_availability: () => [{ ticket_id: 7, sold: 2, pending: 0 }] },
    })
    const order = { id: ORDER, event_id: 1, status: 'processing', ticket_details: [{ id: 7, quantity: 1 }] }
    expect(await findOversell(db, order)).toMatch(/Mesa VIP: 1 emitidas \+ 1 > 1/)
  })

  it('sin otra mesa vendida, la propia no es sobreventa', async () => {
    const own = Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, event_order_id: ORDER, event_ticket_id: 7, status: 'active', unit_id: 'u-own' }))
    const db = createFakeSupabase({
      tables: { event_tickets: [{ id: 7, event_id: 1, ticket_name: 'Mesa VIP', total_quantity: 1 }], event_attendees: own },
      rpc: { aitickets_ticket_availability: () => [{ ticket_id: 7, sold: 1, pending: 0 }] },
    })
    expect(await findOversell(db, { id: ORDER, event_id: 1, status: 'processing', ticket_details: [{ id: 7, quantity: 1 }] })).toBeNull()
  })
})
