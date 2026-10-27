// Aviso automático a la lista de espera (netlify/lib/waitlist.mjs): cuándo hay algo comprable, a quién se avisa y
// que sea un solo correo por persona y evento. Supabase falso y sendEmail inyectado: sin red.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { notifyWaitlist, buyableTickets, isWaitlistRowOpen, waitlistEventUrl } from '../../netlify/lib/waitlist.mjs'

const NOW = new Date('2026-10-27T15:00:00Z')

const ticket = (id, eventId, over = {}) => ({
  id, event_id: eventId, status: 'available', is_gift: false, total_quantity: 100, init_date: null, end_date: null, event_date_id: null, ...over,
})
const row = (id, eventId, email, kind, over = {}) => ({
  id, event_id: eventId, event_date_id: null, email, kind, created_at: '2026-10-20T12:00:00Z', notified_at: null, ...over,
})

let db
let sendEmail
let sold
beforeEach(() => {
  sendEmail = vi.fn(async () => ({ id: 'mail' }))
  // Vendidas por entrada (aitickets_ticket_availability)
  sold = { 11: 100, 21: 0, 31: 50, 41: 0 }
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Prod SpA', email: 'hola@prod.cl' }],
      events: [
        // 1: agotado (100/100) => no se avisa
        { id: 1, name: 'Agotado', slug: 'agotado', status: 'published', organization_id: 7, cancelled_at: null, end_date: '2026-12-01T00:00:00Z' },
        // 2: la venta abrió ayer => se avisa a sale_opens
        { id: 2, name: 'Abre hoy', slug: 'abre-hoy', status: 'published', organization_id: 7, cancelled_at: null, end_date: '2026-12-01T00:00:00Z' },
        // 3: se liberaron cupos (50/100), pero solo para la función 301
        { id: 3, name: 'Gira', slug: 'gira', status: 'published', organization_id: 7, cancelled_at: null, end_date: '2026-12-01T00:00:00Z' },
        // 4: tiene stock, pero está cancelado
        { id: 4, name: 'Cancelado', slug: 'cancelado', status: 'published', organization_id: 7, cancelled_at: '2026-10-25T00:00:00Z', end_date: '2026-12-01T00:00:00Z' },
      ],
      event_tickets: [
        ticket(11, 1),
        ticket(21, 2, { init_date: '2026-10-26T12:00:00Z' }),
        ticket(31, 3, { event_date_id: 301 }),
        ticket(32, 3, { event_date_id: 302, status: 'unavailable' }),
        ticket(41, 4),
      ],
      event_dates: [{ id: 301, event_id: 3, date: '2026-11-14', start_time: '20:00:00' }, { id: 302, event_id: 3, date: '2026-11-21', start_time: '20:00:00' }],
      aitickets_event_waitlist: [
        row('a', 1, 'ana@x.cl', 'sold_out'),
        row('b', 2, 'beto@x.cl', 'sale_opens'),
        row('b2', 2, 'BETO@x.cl', 'full'),
        row('c', 3, 'caro@x.cl', 'sold_out', { event_date_id: 301 }),
        row('d', 3, 'dani@x.cl', 'sold_out', { event_date_id: 302 }),
        row('e', 4, 'eli@x.cl', 'sold_out'),
        row('f', 2, 'fran@x.cl', 'sale_opens', { notified_at: '2026-10-26T13:00:00Z' }),
        row('g', 2, 'gabi@x.cl', 'sale_opens', { created_at: '2026-01-01T00:00:00Z' }),
      ],
    },
    rpc: {
      aitickets_ticket_availability: ({ p_event_id }, state) =>
        state.event_tickets.filter((t) => t.event_id === p_event_id).map((t) => ({ ticket_id: t.id, sold: sold[t.id] || 0, pending: 0 })),
    },
  })
})

describe('qué se puede comprar', () => {
  it('descuenta vendidas y reservas, y respeta estado, regalo y ventana de venta', () => {
    const tickets = [
      ticket(1, 9),
      ticket(2, 9, { total_quantity: 10 }),
      ticket(3, 9, { total_quantity: null }),
      ticket(4, 9, { is_gift: true }),
      ticket(5, 9, { init_date: '2026-11-01T00:00:00Z' }),
      ticket(6, 9, { end_date: '2026-10-01T00:00:00Z' }),
    ]
    const ids = buyableTickets(tickets, [{ ticket_id: 1, sold: 99, pending: 1 }, { ticket_id: 2, sold: 5, pending: 2 }], NOW).map((t) => t.id)
    expect(ids).toEqual([2, 3])
  })
  it('una fila de una función se abre con entradas de esa función o para todas', () => {
    expect(isWaitlistRowOpen({ event_date_id: 1 }, [{ event_date_id: 2 }])).toBe(false)
    expect(isWaitlistRowOpen({ event_date_id: 1 }, [{ event_date_id: null }])).toBe(true)
    expect(isWaitlistRowOpen({ event_date_id: null }, [{ event_date_id: 2 }])).toBe(true)
  })
})

describe('notifyWaitlist', () => {
  it('avisa una vez por persona y evento solo cuando hay algo comprable, y marca lo avisado', async () => {
    const result = await notifyWaitlist(db, { now: NOW, sendEmail })
    expect(result).toEqual({ events: 2, sent: 2, failed: 0 })
    const to = sendEmail.mock.calls.map(([m]) => m.to).sort()
    expect(to).toEqual(['beto@x.cl', 'caro@x.cl'])

    const beto = sendEmail.mock.calls.find(([m]) => m.to === 'beto@x.cl')[0]
    expect(beto.subject).toBe('Abrió la venta: Abre hoy')
    expect(beto.html).toContain(waitlistEventUrl('abre-hoy'))
    expect(beto.replyTo).toBe('hola@prod.cl')
    const caro = sendEmail.mock.calls.find(([m]) => m.to === 'caro@x.cl')[0]
    expect(caro.subject).toBe('Hay entradas de nuevo: Gira')
    expect(caro.html).toContain('sábado, 14 de noviembre')

    const notified = db.tables.aitickets_event_waitlist.filter((r) => r.notified_at === NOW.toISOString()).map((r) => r.id).sort()
    expect(notified).toEqual(['b', 'b2', 'c'])
  })

  it('no repite: la segunda pasada no envía nada', async () => {
    await notifyWaitlist(db, { now: NOW, sendEmail })
    sendEmail.mockClear()
    expect(await notifyWaitlist(db, { now: NOW, sendEmail })).toEqual({ events: 0, sent: 0, failed: 0 })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('si falla el correo no marca como avisado (se reintenta en la próxima pasada)', async () => {
    sendEmail.mockRejectedValueOnce(new Error('mailgun caído'))
    // El primer envío es el de Beto (evento 2): falla y queda pendiente; el de Caro sí sale
    expect(await notifyWaitlist(db, { now: NOW, sendEmail })).toEqual({ events: 2, sent: 1, failed: 1 })
    expect(db.tables.aitickets_event_waitlist.filter((r) => r.notified_at === NOW.toISOString()).map((r) => r.id)).toEqual(['c'])
    sendEmail.mockClear()
    expect(await notifyWaitlist(db, { now: NOW, sendEmail })).toMatchObject({ sent: 1 })
    expect(sendEmail.mock.calls[0][0].to).toBe('beto@x.cl')
  })

  it('sin el conteo de stock no avisa', async () => {
    db = createFakeSupabase({ tables: db.tables })
    expect(await notifyWaitlist(db, { now: NOW, sendEmail })).toEqual({ events: 0, sent: 0, failed: 0 })
  })
})
