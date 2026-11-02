// Cortesías (src/lib/courtesy.ts): el tipo "Cortesía" ya no lo crea un trigger de la base (migración 202611020200) sino
// la app la primera vez; y en eventos con entradas numeradas cada cortesía toma un asiento de la función.
import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { seatMapFromTemplate } from '../../src/lib/seatMap.mjs'

const { ensureCourtesyTicket, issueCourtesyTickets, CourtesyError } = await import('../../src/lib/courtesy.ts')

const MAP = seatMapFromTemplate('sala-chica') // 6 × 10, sección "sala"

function seatedDb({ dates = [{ id: 70, event_id: 10, event_location_id: 'loc1' }], taken = [] } = {}) {
  const held = []
  const db = createFakeSupabase({
    tables: {
      events: [{ id: 10, name: 'Cine', organization_id: 7 }],
      event_locations: [{ id: 'loc1', event_id: 10, seat_map: MAP }],
      event_dates: dates,
      event_tickets: [{ id: 5, event_id: 10, ticket_name: 'General', price: 5000, is_gift: false, seat_sections: null, event_date_id: null }],
      event_orders: [],
      event_attendees: [],
      attendees: [],
      aitickets_event_seats: [],
    },
    rpc: {
      aitickets_taken_seats: () => taken.map((k) => ({ seat_key: k, status: 'sold' })),
      aitickets_hold_seats: ({ p_order_id, p_event_date_id, p_keys }) => {
        const clash = p_keys.filter((k) => taken.includes(k))
        if (clash.length) return clash
        for (const k of p_keys) {
          held.push(k)
          db.tables.aitickets_event_seats.push({ id: held.length, order_id: p_order_id, event_date_id: p_event_date_id, seat_key: k, status: 'held' })
        }
        return []
      },
    },
  })
  return db
}

const base = { event: { id: 10 }, firstName: 'Ana', lastName: 'Pérez', email: 'ana@x.cl', issuedBy: 1 }

describe('tipo Cortesía', () => {
  it('se crea la primera vez y después se reutiliza', async () => {
    const db = createFakeSupabase({ tables: { event_tickets: [{ id: 5, event_id: 10, ticket_name: 'General', is_gift: false }] } })
    const a = await ensureCourtesyTicket(db, 10)
    const b = await ensureCourtesyTicket(db, 10)
    expect(a).toEqual(b)
    const gifts = db.tables.event_tickets.filter((t) => t.is_gift)
    expect(gifts).toHaveLength(1)
    expect(gifts[0]).toMatchObject({ event_id: 10, ticket_name: 'Cortesía', price: 0, total_quantity: null, status: 'available' })
  })
  it('usa el que ya existe (eventos creados con el trigger)', async () => {
    const db = createFakeSupabase({ tables: { event_tickets: [{ id: 9, event_id: 10, ticket_name: 'Cortesía', is_gift: true }] } })
    expect(await ensureCourtesyTicket(db, 10)).toEqual({ id: 9, ticket_name: 'Cortesía' })
    expect(db.tables.event_tickets).toHaveLength(1)
  })
})

describe('cortesías sin asientos', () => {
  it('no tocan asientos en un evento de entrada general', async () => {
    const db = createFakeSupabase({ tables: { event_locations: [{ id: 'l', event_id: 10, seat_map: null }], event_orders: [], event_attendees: [], attendees: [] } })
    const r = await issueCourtesyTickets(db, { ...base, ticket: { id: 5, ticket_name: 'General' }, quantity: 2 })
    expect(r.seats).toEqual([])
    expect(db.tables.event_attendees).toHaveLength(2)
    expect(db.tables.event_attendees[0].seat_key).toBeUndefined()
  })
})

describe('cortesías con entradas numeradas', () => {
  it('asignan asientos juntos en la única función y los marcan vendidos', async () => {
    const db = seatedDb({ taken: [] })
    const ticket = await ensureCourtesyTicket(db, 10)
    const r = await issueCourtesyTickets(db, { ...base, ticket, quantity: 3 })
    expect(r.seats).toHaveLength(3)
    const order = db.tables.event_orders[0]
    expect(order.seat_selection.event_date_id).toBe(70)
    expect(order.ticket_details[0].event_date_id).toBe(70)
    const rows = db.tables.event_attendees
    expect(rows.map((a) => a.seat_label)).toEqual(r.seats)
    expect(new Set(rows.map((a) => a.seat_key.split(':')[1])).size).toBe(1) // misma fila
    expect(db.tables.aitickets_event_seats.every((s) => s.status === 'sold' && s.attendee_ticket_id)).toBe(true)
  })

  it('con varias funciones exige elegir una', async () => {
    const db = seatedDb({ dates: [{ id: 70, event_id: 10, event_location_id: 'loc1' }, { id: 71, event_id: 10, event_location_id: 'loc1' }] })
    await expect(issueCourtesyTickets(db, { ...base, ticket: { id: 5, ticket_name: 'General' }, quantity: 1 })).rejects.toBeInstanceOf(CourtesyError)
    expect(db.tables.event_orders).toHaveLength(0)
    const r = await issueCourtesyTickets(db, { ...base, ticket: { id: 5, ticket_name: 'General' }, quantity: 1, eventDateId: 71 })
    expect(db.tables.event_orders[0].seat_selection.event_date_id).toBe(71)
    expect(r.seats).toHaveLength(1)
  })

  it('no regala un asiento ocupado: los pedidos se validan y los automáticos lo evitan', async () => {
    const db = seatedDb({ taken: ['sala:A:1'] })
    await expect(issueCourtesyTickets(db, { ...base, ticket: { id: 5, ticket_name: 'General' }, quantity: 1, seatKeys: ['sala:A:1'] })).rejects.toThrow(/ocupado/)
    const r = await issueCourtesyTickets(db, { ...base, ticket: { id: 5, ticket_name: 'General' }, quantity: 1, seatKeys: ['sala:A:2'] })
    expect(r.seats).toEqual(['Fila A · Asiento 2'])
  })

  it('si no alcanzan los asientos libres no crea nada', async () => {
    const db = seatedDb()
    await expect(issueCourtesyTickets(db, { ...base, ticket: { id: 5, ticket_name: 'General' }, quantity: 61 })).rejects.toThrow(/No quedan 61/)
    expect(db.tables.event_orders).toHaveLength(0)
  })
})
