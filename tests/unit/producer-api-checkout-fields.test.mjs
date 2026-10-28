// API de productores y datos extra del checkout: update_event/get_event con checkout_fields, people_per_ticket en
// create_ticket_type, asistentes y respuestas en list_attendees, y empresa/respuestas en list_orders.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))

const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { accessTools } = await import('../../src/lib/producer-api/tools/access.ts')
const { eventTools } = await import('../../src/lib/producer-api/tools/events.ts')
const { ticketTools } = await import('../../src/lib/producer-api/tools/tickets.ts')

const tool = (name) => [...accessTools, ...eventTools, ...ticketTools].find((t) => t.name === name)
const T1 = '11111111-1111-4111-8111-111111111111'
const T2 = '22222222-2222-4222-8222-222222222222'
const O1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function seed() {
  db = createFakeSupabase({
    tables: {
      events: [{ id: 10, name: 'Seminario', slug: 'seminario', status: 'draft', organization_id: 7, checkout_fields: null }],
      event_tickets: [{ id: 100, event_id: 10, ticket_name: 'General', price: 20000, event_date_id: null, total_quantity: 80, is_gift: false, status: 'available' }],
      event_dates: [],
      event_orders: [{
        id: O1, event_id: 10, status: 'paid', created_at: '2026-10-01T00:00:00Z', amount: 40000, ticket_qty: 2, ticket_details: [{ id: 100, name: 'General', quantity: 2, price: 20000 }],
        buyer_first_name: 'Bea', buyer_last_name: 'Soto', buyer_email: 'bea@mail.cl', company_rut: '77893286-5', company_name: 'Acme SpA',
        registration_answers: [{ id: 'q1', question: '¿Alergias?', answer: 'Maní' }],
      }],
      event_attendees: [
        { id: T1, event_id: 10, event_ticket_id: 100, status: 'active', created_at: '2026-10-01T00:00:00Z', event_order_id: O1, attendees: { first_name: 'Bea', last_name: 'Soto', email: 'bea@mail.cl' } },
        { id: T2, event_id: 10, event_ticket_id: 100, status: 'active', created_at: '2026-10-01T00:00:01Z', event_order_id: O1, holder_name: 'Ana Pérez', holder_email: 'ana@mail.cl', attendees: { first_name: 'Bea', last_name: 'Soto', email: 'bea@mail.cl' } },
      ],
      aitickets_api_audit: [],
    },
  })
}

const ctx = () => ({
  supabase: db,
  actor: { keyId: 'k', userId: 1, orgId: 7, role: 'producer', name: 'Ana', email: 'a@p.cl', scopes: ['read', 'write', 'publish', 'attendees'], eventIds: null },
  origin: 'https://aitickets.test',
  requestUrl: new URL('https://aitickets.test/api/mcp'),
  channel: 'mcp',
})

beforeEach(seed)

describe('update_event: checkout_fields', () => {
  it('guarda lo enviado combinado con lo que había, normalizado', async () => {
    const r = await runTool(tool('update_event'), { event_id: 10, checkout_fields: { attendee_names: 'required', questions: [{ label: 'Talla', type: 'choice', options: ['S', 'M'], required: true }] } }, ctx())
    expect(r.ok).toBe(true)
    expect(r.result.updated).toContain('checkout_fields')
    expect(db.tables.events[0].checkout_fields).toEqual({
      attendee_names: 'required',
      company: false,
      questions: [{ id: 'q1', label: 'Talla', type: 'choice', required: true, options: ['S', 'M'] }],
    })
    const again = await runTool(tool('update_event'), { event_id: 10, checkout_fields: { company: true } }, ctx())
    expect(again.ok).toBe(true)
    expect(db.tables.events[0].checkout_fields).toMatchObject({ attendee_names: 'required', company: true, questions: [{ label: 'Talla' }] })
  })

  it('una pregunta de opciones sin 2 opciones se rechaza sin guardar', async () => {
    const r = await runTool(tool('update_event'), { event_id: 10, checkout_fields: { questions: [{ label: 'Talla', type: 'choice', options: ['S'] }] } }, ctx())
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/al menos 2 opciones/)
    expect(db.tables.events[0].checkout_fields).toBeNull()
  })

  it('volver a lo de siempre deja la columna en NULL', async () => {
    db.tables.events[0].checkout_fields = { attendee_names: 'optional', company: false, questions: [] }
    const r = await runTool(tool('update_event'), { event_id: 10, checkout_fields: { attendee_names: 'off' } }, ctx())
    expect(r.ok).toBe(true)
    expect(db.tables.events[0].checkout_fields).toBeNull()
  })
})

describe('create_ticket_type: mesa para N', () => {
  it('guarda people_per_ticket y lo devuelve', async () => {
    const r = await runTool(tool('create_ticket_type'), { event_id: 10, name: 'Mesa VIP', price: 0, quantity: 10, people_per_ticket: 6 }, ctx())
    expect(r.ok).toBe(true)
    expect(r.result.ticket_type.people_per_ticket).toBe(6)
    expect(db.tables.event_tickets.find((t) => t.ticket_name === 'Mesa VIP').people_per_ticket).toBe(6)
  })
})

describe('list_attendees y list_orders', () => {
  it('el titular es el asistente escrito al comprar; buyer y answers vienen de la orden', async () => {
    const r = await runTool(tool('list_attendees'), { event_id: 10 }, ctx())
    expect(r.ok).toBe(true)
    const ana = r.result.attendees.find((a) => a.ticket_id === T2)
    expect(ana.holder).toEqual({ name: 'Ana Pérez', email: 'ana@mail.cl' })
    expect(ana.buyer).toEqual({ name: 'Bea Soto', email: 'bea@mail.cl' })
    expect(ana.answers).toEqual([{ question: '¿Alergias?', answer: 'Maní' }])
    const bea = r.result.attendees.find((a) => a.ticket_id === T1)
    expect(bea.holder).toEqual({ name: 'Bea Soto', email: 'bea@mail.cl' })
    expect(bea.buyer).toBeUndefined()
    // La búsqueda también encuentra al asistente
    const found = await runTool(tool('list_attendees'), { event_id: 10, search: 'ana@' }, ctx())
    expect(found.result.attendees.map((a) => a.ticket_id)).toEqual([T2])
  })

  it('list_orders trae la empresa (RUT formateado) y las respuestas', async () => {
    const r = await runTool(tool('list_orders'), { event_id: 10 }, ctx())
    expect(r.ok).toBe(true)
    expect(r.result.orders[0]).toMatchObject({ company: { name: 'Acme SpA', rut: '77.893.286-5' }, answers: [{ question: '¿Alergias?', answer: 'Maní' }] })
  })
})
