// /api/purchase-ticket con datos extra del checkout (events.checkout_fields): asistentes por QR, preguntas al
// inscribirse y datos de empresa se validan contra el evento antes de reservar y se guardan en la orden; las mesas para
// N (people_per_ticket) emiten un QR por persona y la línea lleva `people`.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
const sendEmailMock = vi.fn(async () => ({ ok: true, status: 'sent' }))

vi.mock('../../netlify/lib/rate-limit.mjs', () => ({ rateLimit: async () => ({ allowed: true, source: 'db' }) }))
vi.mock('../../netlify/lib/turnstile.mjs', () => ({
  verifyTurnstile: async () => ({ success: true }),
  isTurnstileEnabled: () => false,
  turnstileSiteKey: () => null,
}))
vi.mock('../../netlify/lib/tickets-email.mjs', () => ({ sendOrderTicketsEmail: (...a) => sendEmailMock(...a) }))
vi.mock('../../netlify/lib/payments/index.mjs', () => ({
  enabledProviders: () => ['flow'],
  defaultProvider: () => 'flow',
  holdMinutesFor: () => 15,
  createCheckout: async () => ({ redirectUrl: 'https://flow.test/pay', externalId: 'tok' }),
}))
vi.mock('../../netlify/lib/supabase.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getSupabaseAdmin: () => withOr(db) }
})

function withOr(fake) {
  return {
    ...fake,
    from(table) {
      const b = fake.from(table)
      b.or = () => b
      return b
    },
  }
}

const { default: handler } = await import('../../netlify/functions/purchase-tickets/index.mjs')

const FIELDS = {
  attendee_names: 'optional',
  company: true,
  questions: [
    { id: 'nivel', label: 'Nivel', type: 'choice', options: ['Básico', 'Avanzado'], required: true },
    { id: 'auto', label: '¿Vienes en auto?', type: 'yes_no' },
  ],
}

function setup({ price = 0, people = 1, fields = FIELDS } = {}) {
  db = createFakeSupabase({
    tables: {
      events: [{ id: 5, name: 'Taller de cerámica', slug: 'ceramica', status: 'published', end_date: null, organization_id: 7, checkout_fields: fields }],
      event_tickets: [{ id: 50, event_id: 5, event_date_id: null, ticket_name: 'General', price, max_quantity: 10, is_gift: false, status: 'available', init_date: null, end_date: null, total_quantity: null, people_per_ticket: people }],
      attendees: [],
      event_orders: [],
      event_attendees: [],
    },
    rpc: {
      aitickets_reserve_order: ({ p_order }, state) => {
        const row = { id: `order-${state.event_orders.length + 1}`, status: 'pending', event_id: 5, ...p_order }
        state.event_orders.push(row)
        return row.id
      },
    },
  })
}

const request = (extra = {}, quantity = 2) =>
  new Request('https://example.test/api/purchase-ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-nf-client-connection-ip': '203.0.113.9' },
    body: JSON.stringify({ eventId: 5, buyer: { fullName: 'Bea Soto', email: 'bea@mail.cl' }, tickets: [{ id: 50, quantity }], termsAccepted: true, ...extra }),
  })

beforeEach(() => sendEmailMock.mockClear())

describe('purchase-tickets: datos extra del checkout', () => {
  it('inscripción gratis: guarda asistentes y respuestas, y cada QR queda a nombre de su asistente', async () => {
    setup()
    const res = await handler(
      request({
        holders: [{ ticket_id: 50 }, { ticket_id: 50, name: 'Ana Pérez', email: 'ana@mail.cl' }],
        answers: { nivel: 'Básico', auto: 'No' },
        company: { rut: '77.893.286-5', name: 'Acme SpA' },
      }),
    )
    expect(res.status).toBe(200)
    const order = db.tables.event_orders[0]
    expect(order.status).toBe('paid')
    expect(order.attendee_holders).toEqual([
      { ticket_id: 50, name: 'Bea Soto', email: 'bea@mail.cl' },
      { ticket_id: 50, name: 'Ana Pérez', email: 'ana@mail.cl' },
    ])
    expect(order.registration_answers).toEqual([
      { id: 'nivel', question: 'Nivel', answer: 'Básico' },
      { id: 'auto', question: '¿Vienes en auto?', answer: 'No' },
    ])
    // Gratis: los datos de empresa no aplican
    expect(order.company_rut).toBeUndefined()
    expect(db.tables.event_attendees.map((a) => [a.holder_name, a.holder_email])).toEqual([
      ['Bea Soto', 'bea@mail.cl'],
      ['Ana Pérez', 'ana@mail.cl'],
    ])
  })

  it('pregunta obligatoria sin responder: 400 y no se crea la orden', async () => {
    setup()
    const res = await handler(request({ answers: { auto: 'Sí' } }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ field: 'answers', message: expect.stringContaining('Nivel') })
    expect(db.tables.event_orders).toHaveLength(0)
  })

  it('nombre obligatorio de cada asistente: 400 si falta uno', async () => {
    setup({ fields: { attendee_names: 'required' } })
    const res = await handler(request({ holders: [{}, { email: 'x@mail.cl' }] }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ field: 'holders' })
    expect(db.tables.event_orders).toHaveLength(0)
  })

  it('compra pagada: RUT con dígito verificador malo → 400; bueno → queda en la orden', async () => {
    setup({ price: 10000 })
    const bad = await handler(request({ answers: { nivel: 'Básico' }, company: { rut: '77.893.286-4', name: 'Acme SpA' } }))
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ field: 'company' })
    expect(db.tables.event_orders).toHaveLength(0)

    const ok = await handler(request({ answers: { nivel: 'Avanzado' }, company: { rut: '77.893.286-5', name: 'Acme SpA' } }))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ provider: 'flow' })
    expect(db.tables.event_orders[0]).toMatchObject({ company_rut: '77893286-5', company_name: 'Acme SpA', status: 'pending' })
  })

  it('evento sin datos extra: ignora lo que mande el cliente', async () => {
    setup({ fields: null })
    const res = await handler(request({ holders: [{ name: 'X' }, { name: 'Y' }], answers: { a: 'b' }, company: { rut: '1-9', name: 'Z' } }))
    expect(res.status).toBe(200)
    const order = db.tables.event_orders[0]
    expect(order.attendee_holders).toBeUndefined()
    expect(order.registration_answers).toBeUndefined()
    expect(db.tables.event_attendees.every((a) => a.holder_name === undefined)).toBe(true)
  })
})

describe('purchase-tickets: mesa para N', () => {
  it('una mesa para 4 emite 4 QR de la misma mesa; la línea lleva people y la cantidad sigue siendo 1', async () => {
    setup({ people: 4, fields: { attendee_names: 'optional' } })
    const res = await handler(request({ holders: [{}, { name: 'Ana' }, {}, { name: 'Caro', email: 'caro@mail.cl' }] }, 1))
    expect(res.status).toBe(200)
    const order = db.tables.event_orders[0]
    expect(order.ticket_details).toEqual([expect.objectContaining({ id: 50, quantity: 1, people: 4 })])
    expect(order.ticket_qty).toBe(1)
    const rows = db.tables.event_attendees
    expect(rows).toHaveLength(4)
    expect(new Set(rows.map((r) => r.unit_id)).size).toBe(1)
    expect(rows.map((r) => r.seat_number)).toEqual([1, 2, 3, 4])
    expect(rows.map((r) => r.holder_name ?? null)).toEqual(['Bea Soto', 'Ana', null, 'Caro'])
  })
})

describe('purchase-tickets: preguntas por persona', () => {
  const PER_PERSON = {
    attendee_names: 'optional',
    questions: [
      { id: 'talla', label: 'Talla', type: 'choice', options: ['S', 'M'], required: true, per: 'attendee' },
      { id: 'como', label: '¿Cómo supiste?', type: 'text' },
    ],
  }

  it('quien compra responde por cada persona: viajan en la orden y cada QR emite las suyas', async () => {
    setup({ fields: PER_PERSON })
    const res = await handler(
      request({
        holders: [{ ticket_id: 50, answers: { talla: 'M' } }, { ticket_id: 50, name: 'Ana Pérez', email: 'ana@mail.cl', answers: { talla: 'S' } }],
        answers: { como: 'Instagram' },
      }),
    )
    expect(res.status).toBe(200)
    const order = db.tables.event_orders[0]
    expect(order.attendee_holders[1]).toEqual({ ticket_id: 50, name: 'Ana Pérez', email: 'ana@mail.cl', answers: [{ id: 'talla', question: 'Talla', answer: 'S' }] })
    expect(order.registration_answers).toEqual([{ id: 'como', question: '¿Cómo supiste?', answer: 'Instagram' }])
    expect(db.tables.event_attendees.map((a) => a.registration_answers)).toEqual([
      [{ id: 'talla', question: 'Talla', answer: 'M' }],
      [{ id: 'talla', question: 'Talla', answer: 'S' }],
    ])
  })

  it('falta la respuesta de una persona: 400 con el número de entrada', async () => {
    setup({ fields: PER_PERSON })
    const res = await handler(request({ holders: [{ answers: { talla: 'M' } }, { name: 'Ana' }] }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ field: 'holders', message: 'Responde "Talla" (entrada 2).' })
    expect(db.tables.event_orders).toHaveLength(0)
  })

  it('invitar por correo: el invitado queda sin respuestas (las completa él) y su correo es obligatorio', async () => {
    setup({ fields: { ...PER_PERSON, holders: 'invite' } })
    const missing = await handler(request({ holders: [{ answers: { talla: 'M' } }, { name: 'Ana' }] }))
    expect(missing.status).toBe(400)
    expect(await missing.json()).toMatchObject({ field: 'holders', message: expect.stringContaining('correo de la entrada 2') })

    const res = await handler(request({ holders: [{ answers: { talla: 'M' } }, { email: 'ana@mail.cl', answers: { talla: 'S' } }] }))
    expect(res.status).toBe(200)
    const [mine, guest] = db.tables.event_attendees
    expect(mine).toMatchObject({ holder_name: 'Bea Soto', registration_answers: [{ id: 'talla', question: 'Talla', answer: 'M' }] })
    expect(guest.holder_email).toBe('ana@mail.cl')
    expect(guest.holder_name).toBeUndefined()
    expect(guest.registration_answers).toBeUndefined()
  })

  it('una sola entrada: las responde quien compra para su propia entrada', async () => {
    setup({ fields: PER_PERSON })
    const res = await handler(request({ holders: [{ ticket_id: 50, answers: { talla: 'S' } }] }, 1))
    expect(res.status).toBe(200)
    expect(db.tables.event_attendees[0]).toMatchObject({ holder_name: 'Bea Soto', registration_answers: [{ id: 'talla', question: 'Talla', answer: 'S' }] })
  })

  it('base sin la columna nueva: emite igual, con nombre y correo de cada uno', async () => {
    setup({ fields: PER_PERSON })
    let calls = 0
    const realFrom = db.from.bind(db)
    db.from = (table) => {
      const b = realFrom(table)
      if (table !== 'event_attendees') return b
      const realInsert = b.insert.bind(b)
      b.insert = (rows) => {
        calls++
        if ((Array.isArray(rows) ? rows : [rows]).some((r) => 'registration_answers' in r)) return Promise.resolve({ data: null, error: { code: 'PGRST204', message: "Could not find the 'registration_answers' column" } })
        return realInsert(rows)
      }
      return b
    }
    const res = await handler(request({ holders: [{ answers: { talla: 'M' } }, { name: 'Ana', answers: { talla: 'S' } }] }))
    expect(res.status).toBe(200)
    expect(calls).toBe(2)
    expect(db.tables.event_attendees.map((a) => a.holder_name)).toEqual(['Bea Soto', 'Ana'])
  })
})
