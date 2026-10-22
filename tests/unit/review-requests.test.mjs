// Correo "¿Cómo estuvo?" 24 h después de cada función (netlify/lib/review-requests.mjs): a quién, cuándo y sin
// repetir. Supabase falso y sendEmail inyectado: sin red.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { sendReviewRequests, reviewLinks } from '../../netlify/lib/review-requests.mjs'
import { verifyReviewToken } from '../../netlify/lib/review-token.mjs'

// Funciones del 17-oct (primavera, UTC-3): 20:00-23:00 termina 2026-10-18T02:00Z. "Ahora" = 25 h después.
const NOW = new Date('2026-10-19T03:00:00Z')

const person = (id, email, first) => ({ id, first_name: first, last_name: 'Test', email })
const ticket = (id, eventId, attendee, fnId, status = 'active') => ({
  id: `t-${id}`,
  event_id: eventId,
  status,
  attendee_id: attendee.id,
  attendees: attendee,
  event_tickets: { event_date_id: fnId },
  event_orders: { buyer_first_name: attendee.first_name, buyer_last_name: 'Test' },
})

const ana = person(1, 'ana@x.cl', 'Ana')
const beto = person(2, 'beto@x.cl', 'Beto')
const caro = person(3, 'caro@x.cl', 'Caro')
const dani = person(4, 'dani@x.cl', 'Dani')
const eli = person(5, 'eli@x.cl', 'Eli')
const fran = person(6, 'fran@x.cl', 'Fran')
const gabi = person(7, 'gabi@x.cl', 'Gabi')
const hugo = person(8, 'hugo@x.cl', 'Hugo')

let db
let sendEmail
beforeEach(() => {
  vi.stubEnv('REVIEW_TOKEN_SECRET', 'test-secret')
  sendEmail = vi.fn(async () => ({ id: 'mail' }))
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Prod SpA', email: 'hola@prod.cl' }],
      events: [
        // Gira: la función 101 terminó, la 102 es la próxima semana
        { id: 10, name: 'Gira', slug: 'gira', status: 'published', organization_id: 7, cancelled_at: null, review_settings: null },
        // Una función que terminó (también es la última)
        { id: 11, name: 'Show', slug: 'show', status: 'published', organization_id: 7, cancelled_at: null, review_settings: { reward: { value: 15, valid_days: 30 } } },
        { id: 12, name: 'Sin correo', slug: 'sin-correo', status: 'published', organization_id: 7, review_settings: { enabled: false } },
        { id: 13, name: 'Demo', slug: 'evento-demo-aitickets', status: 'published', organization_id: 1 },
        { id: 14, name: 'Borrador', slug: 'borrador', status: 'draft', organization_id: 7 },
      ],
      event_dates: [
        { id: 101, event_id: 10, date: '2026-10-17', start_time: '20:00', end_time: '23:00' },
        { id: 102, event_id: 10, date: '2026-10-24', start_time: '20:00', end_time: '23:00' },
        { id: 111, event_id: 11, date: '2026-10-17', start_time: '20:00', end_time: '23:00' },
        { id: 121, event_id: 12, date: '2026-10-17', start_time: '20:00', end_time: '23:00' },
        { id: 131, event_id: 13, date: '2026-10-17', start_time: '20:00', end_time: '23:00' },
        { id: 141, event_id: 14, date: '2026-10-17', start_time: '20:00', end_time: '23:00' },
      ],
      event_attendees: [
        ticket(1, 10, ana, 101),
        ticket(2, 10, ana, 101), // segunda entrada de Ana: un solo correo
        ticket(3, 10, beto, 102), // función que aún no ocurre
        ticket(4, 10, caro, null), // "cualquier función": solo después de la última
        ticket(5, 10, dani, 101, 'cancelled'),
        ticket(6, 10, eli, 101), // ya calificó desde la página
        ticket(7, 10, fran, 101), // ya recibió el correo
        ticket(8, 11, gabi, null), // evento terminado: "cualquier función" sí
        ticket(9, 11, hugo, 999), // función borrada => cuenta como "cualquier función"
        ticket(10, 12, ana, 121),
        ticket(11, 13, ana, 131),
        ticket(12, 14, ana, 141),
      ],
      notification_log: [{ id: 1, event_id: 10, attendee_id: 6, type: 'review_request' }],
      aitickets_event_reviews: [{ id: 'r1', event_id: 10, email: 'eli@x.cl', rating: 5 }],
    },
  })
})

const recipientsOf = (call) => Object.keys(call[0].recipientVariables).sort()

describe('sendReviewRequests', () => {
  it('escribe a quienes tenían entradas de la función que terminó hace 24 h, sin repetir', async () => {
    const result = await sendReviewRequests(db, { now: NOW, sendEmail })
    expect(result).toEqual({ events: 2, sent: 3, failed: 0 })
    expect(sendEmail).toHaveBeenCalledTimes(2)
    const byEvent = Object.fromEntries(sendEmail.mock.calls.map((c) => [c[0].tags[0] && c[0].idempotencyKey.split('-')[1], c]))
    expect(recipientsOf(byEvent['10'])).toEqual(['ana@x.cl'])
    expect(recipientsOf(byEvent['11'])).toEqual(['gabi@x.cl', 'hugo@x.cl'])
    // Responder a la productora
    expect(byEvent['10'][0].replyTo).toBe('hola@prod.cl')
    // Registrados para no repetir
    const logged = db.tables.notification_log.filter((l) => l.type === 'review_request').map((l) => `${l.event_id}:${l.attendee_id}`).sort()
    expect(logged).toEqual(['10:1', '10:6', '11:7', '11:8'])

    // Segunda ejecución (una hora después): nada nuevo
    sendEmail.mockClear()
    const again = await sendReviewRequests(db, { now: new Date(NOW.getTime() + 3600_000), sendEmail })
    expect(again.sent).toBe(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('cada destinatario recibe su link firmado y un link por estrella', async () => {
    await sendReviewRequests(db, { now: NOW, sendEmail })
    const call = sendEmail.mock.calls.find((c) => c[0].recipientVariables['ana@x.cl'])[0]
    const vars = call.recipientVariables['ana@x.cl']
    expect(vars.name.text).toBe('Ana')
    expect(vars.review_url.text).toMatch(/^https:\/\/aitickets\.cl\/eventos\/gira#resena=/)
    expect(vars.star5.text).toBe(`${vars.review_url.text}&nota=5`)
    expect(vars.star5.html).toContain('&amp;nota=5')
    const token = decodeURIComponent(vars.review_url.text.split('#resena=')[1])
    expect(verifyReviewToken(token, { now: NOW })).toEqual({ eventId: 10, email: 'ana@x.cl', via: 'email_link' })
    expect(call.html).toContain('%recipient.star3%')
  })

  it('el premio configurado aparece en el correo', async () => {
    await sendReviewRequests(db, { now: NOW, sendEmail })
    const show = sendEmail.mock.calls.find((c) => c[0].recipientVariables['gabi@x.cl'])[0]
    expect(show.html).toContain('15% de descuento')
    const gira = sendEmail.mock.calls.find((c) => c[0].recipientVariables['ana@x.cl'])[0]
    expect(gira.html).not.toContain('de descuento')
  })

  it('si el envío falla no registra (se reintenta en la próxima hora)', async () => {
    sendEmail.mockRejectedValue(new Error('Resend 500'))
    const result = await sendReviewRequests(db, { now: NOW, sendEmail })
    expect(result.sent).toBe(0)
    expect(result.failed).toBe(3)
    expect(db.tables.notification_log).toHaveLength(1)
  })

  it('sin secreto de firma no envía nada', async () => {
    vi.stubEnv('REVIEW_TOKEN_SECRET', '')
    const result = await sendReviewRequests(db, { now: NOW, sendEmail })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(result.sent).toBe(0)
  })

  it('reviewLinks codifica el slug y el token', () => {
    const links = reviewLinks('mi evento', 'a.b')
    expect(links.review).toBe('https://aitickets.cl/eventos/mi%20evento#resena=a.b')
    expect(links.stars).toHaveLength(5)
  })
})
