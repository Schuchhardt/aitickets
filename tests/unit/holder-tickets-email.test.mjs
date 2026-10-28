// Correo de entradas con asistentes por QR y mesas: quien compra recibe todo (el comprobante cuenta mesas, no QR, y
// lleva los datos de empresa con la aclaración de que no es boleta ni factura); en el primer envío cada asistente con
// correo propio recibe solo la suya. Un reenvío (force) va solo a quien compró.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

const mocks = vi.hoisted(() => ({ db: null, sendEmail: vi.fn(async () => ({ id: 're_msg' })) }))
vi.mock('../../netlify/lib/supabase.mjs', () => ({ getSupabaseAdmin: () => mocks.db }))
vi.mock('../../netlify/lib/mailer.mjs', async (importOriginal) => ({ ...(await importOriginal()), sendEmail: mocks.sendEmail }))

const { sendOrderTicketsEmail } = await import('../../netlify/lib/tickets-email.mjs')
const { renderHolderTicketEmail } = await import('../../netlify/lib/emails/index.mjs')

const ORDER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function dbWithOr(opts) {
  const db = createFakeSupabase(opts)
  const from = db.from
  db.from = (table) => {
    const b = from(table)
    b.or = () => b
    return b
  }
  return db
}

const ticket = (id, extra) => ({ id, event_order_id: ORDER, event_ticket_id: 7, qr_code: `qr-${id}`, status: 'active', event_tickets: { ticket_name: 'Mesa VIP', price: 90000, event_date_id: null }, ...extra })

function setup() {
  mocks.db = dbWithOr({
    tables: {
      event_orders: [{
        id: ORDER, created_at: '2026-10-01T12:00:00Z', status: 'paid', event_id: 10, attendee_id: 300, amount: 90000, ticket_fee: 7200, service_fee_tax: 1368,
        total_payment: 98568, ticket_details: [{ id: 7, price: 90000, quantity: 1, people: 3 }], email_sent_at: null, email_claimed_at: null,
        buyer_first_name: 'Bea', buyer_last_name: 'Soto', buyer_email: 'bea@mail.cl', company_rut: '77893286-5', company_name: 'Acme SpA',
        events: { id: 10, name: 'Noche VIP', slug: 'noche', description: '', location: 'Santiago', secret_location: null, start_date: '2026-12-01T23:00:00Z', end_date: null, organization_id: 7 },
      }],
      event_attendees: [
        ticket('t1', { unit_id: 'u1', seat_number: 1, holder_name: 'Bea Soto', holder_email: 'bea@mail.cl' }),
        ticket('t2', { unit_id: 'u1', seat_number: 2, holder_name: 'Ana Pérez', holder_email: 'ana@mail.cl' }),
        ticket('t3', { unit_id: 'u1', seat_number: 3 }),
      ],
      event_dates: [],
      users: [],
      organizations: [],
      aitickets_email_log: [],
    },
  })
}

beforeEach(() => mocks.sendEmail.mockClear())

describe('sendOrderTicketsEmail con asistentes y mesas', () => {
  it('quien compra recibe las 3 entradas y una mesa en el comprobante; Ana recibe solo la suya', async () => {
    setup()
    const r = await sendOrderTicketsEmail(ORDER)
    expect(r).toMatchObject({ ok: true, status: 'sent' })
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2)

    const buyerMail = mocks.sendEmail.mock.calls[0][0]
    expect(buyerMail.to).toContain('bea@mail.cl')
    expect(buyerMail.attachments.filter((a) => a.contentType === 'image/png')).toHaveLength(3)
    expect(buyerMail.text).toMatch(/1 x Mesa VIP/)
    expect(buyerMail.text).toContain('Empresa: Acme SpA · RUT 77.893.286-5')
    expect(buyerMail.text).toContain('no es boleta ni factura')

    const holderMail = mocks.sendEmail.mock.calls[1][0]
    expect(holderMail.to).toContain('ana@mail.cl')
    expect(holderMail.attachments).toHaveLength(1)
    expect(holderMail.text).toContain('/ticket/t2')
    expect(holderMail.text).toContain('Bea Soto compró las entradas')
    expect(holderMail.text).not.toContain('98.568')
    expect(mocks.db.tables.aitickets_email_log.map((l) => l.recipient)).toEqual(['bea@mail.cl', 'ana@mail.cl'])
  })

  it('un reenvío (force) va solo a quien compró', async () => {
    setup()
    await sendOrderTicketsEmail(ORDER, { force: true })
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('si falla el correo de un asistente, la orden queda enviada igual', async () => {
    setup()
    mocks.sendEmail.mockResolvedValueOnce({ id: 're_1' }).mockRejectedValueOnce(new Error('Resend 422'))
    const r = await sendOrderTicketsEmail(ORDER)
    expect(r).toMatchObject({ ok: true, status: 'sent' })
    expect(mocks.db.tables.event_orders[0].email_sent_at).toBeTruthy()
    expect(mocks.db.tables.aitickets_email_log[1]).toMatchObject({ recipient: 'ana@mail.cl', status: 'failed' })
  })

  it('invitado con datos pendientes: su correo le pide completarlos en su entrada', async () => {
    setup()
    mocks.db.tables.events = [{ id: 10, checkout_fields: { attendee_names: 'required', holders: 'invite', questions: [{ id: 'talla', label: 'Talla de polera', required: true, per: 'attendee' }, { id: 'x', label: 'Por compra', required: true }] } }]
    mocks.db.tables.event_attendees[1].holder_name = null
    await sendOrderTicketsEmail(ORDER)
    const holderMail = mocks.sendEmail.mock.calls[1][0]
    expect(holderMail.subject).toContain('completa tus datos')
    expect(holderMail.text).toContain('Nombre, Talla de polera')
    expect(holderMail.text).not.toContain('Por compra')
    expect(holderMail.text).toContain('/ticket/t2')
  })

  it('invitado con todo completo: el correo de siempre', async () => {
    setup()
    mocks.db.tables.events = [{ id: 10, checkout_fields: { attendee_names: 'required', questions: [{ id: 'talla', label: 'Talla', required: true, per: 'attendee' }] } }]
    mocks.db.tables.event_attendees[1].registration_answers = [{ id: 'talla', question: 'Talla', answer: 'M' }]
    await sendOrderTicketsEmail(ORDER)
    expect(mocks.sendEmail.mock.calls[1][0].subject).toBe('🎟️ Tu entrada para Noche VIP')
  })
})

describe('renderHolderTicketEmail', () => {
  it('asunto, QR inline y link a la entrada', async () => {
    const mail = await renderHolderTicketEmail({ holderName: 'Ana', eventName: 'Seminario', ticketName: 'General', qrCid: 'qr-entrada', ticketUrl: 'https://aitickets.cl/ticket/x' })
    expect(mail.subject).toBe('🎟️ Tu entrada para Seminario')
    expect(mail.html).toContain('cid:qr-entrada')
    expect(mail.text).toContain('https://aitickets.cl/ticket/x')
  })
})
