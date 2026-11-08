// Correos "¿Cómo estuvo?" (netlify/lib/review-requests.mjs): hasta 3 por persona, el primero 4 u 8 h después del término
// y siempre entre las 10:00 y las 23:00 de Chile; a quién (titular, comprador y asistente del QR), en qué paso va cada
// uno y cuándo se deja de escribir. Supabase falso y sendEmail inyectado: sin red.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { sendReviewRequests, reviewLinks, reviewOptoutLinks, summarizeReviewRequestLog, reminderDue, collectRecipients } from '../../netlify/lib/review-requests.mjs'
import { verifyReviewToken, verifyReviewReminderOptoutToken, signReviewReminderOptoutToken } from '../../netlify/lib/review-token.mjs'
import { optOutOfReviewReminders, GET as optoutGet, POST as optoutPost } from '../../src/pages/api/resenas/baja.ts'

vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db }))

// Funciones del 17-oct (primavera, UTC-3): 20:00-23:00 termina el 17 a las 23:00 (2026-10-18T02:00Z), de noche => 8 h
// después son las 07:00 => se corre a las 10:00 del 18 (13:00Z). T0 = 10:20 del domingo 18, la primera ejecución.
const T0 = new Date('2026-10-18T13:20:00Z')
const H = 3600_000
const at = (base, hours) => new Date(base.getTime() + hours * H)

const person = (id, email, first) => ({ id, first_name: first, last_name: 'Test', email })
const ticket = (id, eventId, attendee, fnId, status = 'active', extra = {}) => ({
  id: `t-${id}`,
  event_id: eventId,
  status,
  attendee_id: attendee.id,
  attendees: attendee,
  event_tickets: { event_date_id: fnId },
  event_orders: { attendee_id: attendee.id, buyer_first_name: attendee.first_name, buyer_last_name: 'Test', buyer_email: attendee.email },
  ...extra,
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
/** Corre el envío y pone created_at = now a las filas nuevas de notification_log (la base lo hace con DEFAULT now()). */
async function run(now, opts = {}) {
  const result = await sendReviewRequests(db, { now, sendEmail, ...opts })
  for (const row of db.tables.notification_log || []) row.created_at ||= now.toISOString()
  return result
}
const recipientsOf = (call) => Object.keys(call[0].recipientVariables).sort()
const callsByEvent = () => Object.fromEntries(sendEmail.mock.calls.map((c) => [c[0].idempotencyKey.split('-')[1], c]))
const sentCount = (eventId, email) => db.tables.notification_log.filter((l) => l.type === 'review_request' && String(l.event_id) === String(eventId) && l.email === email).length

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
        ticket(7, 10, fran, 101), // ya recibió el primer correo (fila antigua, sin email)
        ticket(8, 11, gabi, null), // evento terminado: "cualquier función" sí
        ticket(9, 11, hugo, 999), // función borrada => cuenta como "cualquier función"
        ticket(10, 12, ana, 121),
        ticket(11, 13, ana, 131),
        ticket(12, 14, ana, 141),
      ],
      notification_log: [{ id: 1, event_id: 10, attendee_id: 6, type: 'review_request', created_at: '2026-10-18T12:00:00Z' }],
      aitickets_event_reviews: [{ id: 'r1', event_id: 10, email: 'eli@x.cl', rating: 5 }],
    },
  })
})

describe('sendReviewRequests: primer correo', () => {
  it('sale cuando están despiertos: de noche no se manda nada, ni lo atrasado', async () => {
    // 09:59 del 18: ya pasaron 8 h del término, pero antes de las 10:00 no sale nada
    const early = await run(new Date('2026-10-18T12:59:00Z'))
    expect(early.skipped).toMatch(/fuera de horario/)
    expect(sendEmail).not.toHaveBeenCalled()
    // 23:20 del 18: tampoco (lo que quedó pendiente espera a la mañana)
    expect((await run(new Date('2026-10-19T02:20:00Z'))).skipped).toMatch(/fuera de horario/)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('escribe a quienes tenían entradas de la función que terminó, sin repetir', async () => {
    const result = await run(T0)
    expect(result).toEqual({ events: 2, sent: 3, failed: 0, reminders: 0 })
    expect(sendEmail).toHaveBeenCalledTimes(2)
    const byEvent = callsByEvent()
    expect(recipientsOf(byEvent['10'])).toEqual(['ana@x.cl'])
    expect(recipientsOf(byEvent['11'])).toEqual(['gabi@x.cl', 'hugo@x.cl'])
    expect(byEvent['10'][0].subject).toBe('⭐ ¿Cómo estuvo Gira?')
    expect(byEvent['10'][0].tags).toEqual(['review-request', 'review-step-1'])
    expect(byEvent['10'][0].idempotencyKey).toMatch(/^review-10-s1-/)
    // Responder a la productora
    expect(byEvent['10'][0].replyTo).toBe('hola@prod.cl')
    // Registrados con email y attendee_id para contar los pasos
    const logged = db.tables.notification_log.filter((l) => l.type === 'review_request' && l.email).map((l) => `${l.event_id}:${l.attendee_id}:${l.email}`).sort()
    expect(logged).toEqual(['10:1:ana@x.cl', '11:7:gabi@x.cl', '11:8:hugo@x.cl'])

    // Una hora después: nada nuevo
    sendEmail.mockClear()
    expect((await run(at(T0, 1))).sent).toBe(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('una función que termina de día escribe 4 h después', async () => {
    db.tables.events.push({ id: 20, name: 'Taller', slug: 'taller', status: 'published', organization_id: 7, review_settings: null })
    db.tables.event_dates.push({ id: 201, event_id: 20, date: '2026-10-19', start_time: '10:00', end_time: '13:00' }) // 13:00 => 17:00 (20:00Z)
    db.tables.event_attendees.push(ticket(20, 20, person(20, 'iris@x.cl', 'Iris'), 201))
    await run(new Date('2026-10-19T19:59:00Z'))
    expect(sendEmail.mock.calls.some((c) => c[0].recipientVariables['iris@x.cl'])).toBe(false)
    await run(new Date('2026-10-19T20:00:00Z'))
    expect(sendEmail.mock.calls.some((c) => c[0].recipientVariables['iris@x.cl'])).toBe(true)
  })
})

describe('sendReviewRequests: recordatorios', () => {
  it('manda 3 correos por persona (el 2º a los 2 días y el 3º a los 3 días del 2º) y nunca un 4º', async () => {
    await run(T0) // 1º: Ana, Gabi, Hugo

    // Al día siguiente: nada
    sendEmail.mockClear()
    expect((await run(at(T0, 24))).sent).toBe(0)

    // 2 días después: 2º correo a los mismos y a Fran (su 1º fue el correo antiguo, asociado por attendee_id)
    const second = await run(at(T0, 48))
    expect(second).toMatchObject({ sent: 4, reminders: 4, failed: 0 })
    let byEvent = callsByEvent()
    expect(recipientsOf(byEvent['10'])).toEqual(['ana@x.cl', 'fran@x.cl'])
    expect(recipientsOf(byEvent['11'])).toEqual(['gabi@x.cl', 'hugo@x.cl'])
    expect(byEvent['10'][0].subject).toBe('📸 ¿Tienes fotos de Gira?')
    expect(byEvent['10'][0].idempotencyKey).toMatch(/^review-10-s2-/)

    sendEmail.mockClear()
    expect((await run(at(T0, 49))).sent).toBe(0)

    // 3 días después del 2º: el último
    const third = await run(at(T0, 48 + 72))
    expect(third).toMatchObject({ sent: 4, reminders: 4 })
    byEvent = callsByEvent()
    expect(byEvent['10'][0].subject).toBe('⏳ Último recordatorio: ¿cómo estuvo Gira?')
    expect(byEvent['10'][0].tags).toEqual(['review-request', 'review-step-3'])

    // Termina la función 102: 1º correo a Beto (su función) y a Caro ("cualquier función", después de la última)
    sendEmail.mockClear()
    const later = await run(new Date('2026-10-25T13:20:00Z'))
    expect(later).toMatchObject({ sent: 2, reminders: 0 })
    expect(recipientsOf(sendEmail.mock.calls[0])).toEqual(['beto@x.cl', 'caro@x.cl'])

    // Un día después: los que ya recibieron 3 no reciben más
    sendEmail.mockClear()
    await run(new Date('2026-10-28T13:20:00Z'))
    for (const call of sendEmail.mock.calls) expect(recipientsOf(call)).toEqual(['beto@x.cl', 'caro@x.cl'])
    for (const email of ['ana@x.cl', 'gabi@x.cl', 'hugo@x.cl']) expect(sentCount(email === 'ana@x.cl' ? 10 : 11, email)).toBe(3)
    expect(sentCount(10, 'fran@x.cl')).toBe(2) // + la fila antigua = 3
  })

  it('no recuerda a quien calificó, pidió no recibir más o se dio de baja de la productora', async () => {
    await run(T0)
    db.tables.aitickets_event_reviews.push({ id: 'r2', event_id: 11, email: 'gabi@x.cl', rating: 4 })
    expect(await optOutOfReviewReminders(signReviewReminderOptoutToken({ eventId: 11, email: 'hugo@x.cl' }), db)).toBe(true)
    expect(await optOutOfReviewReminders(signReviewReminderOptoutToken({ eventId: 11, email: 'hugo@x.cl' }), db)).toBe(true) // sin duplicar
    expect(db.tables.notification_log.filter((l) => l.type === 'review_request_optout')).toHaveLength(1)
    db.tables.aitickets_org_email_optouts = [{ organization_id: 7, email: 'ana@x.cl' }]

    sendEmail.mockClear()
    const second = await run(at(T0, 48))
    expect(second.sent).toBe(1)
    expect(recipientsOf(sendEmail.mock.calls[0])).toEqual(['fran@x.cl'])
  })

  it('deja de recordar 10 días después del primer correo', async () => {
    db.tables.notification_log[0].created_at = '2026-10-07T13:00:00Z' // 11 días antes de T0
    db.tables.event_attendees = db.tables.event_attendees.filter((t) => t.attendees.id === fran.id)
    await run(T0)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe('sendReviewRequests: destinatarios', () => {
  it('también escribe a quien compró y al asistente de cada QR, con su nombre', async () => {
    const juan = person(30, 'juan@x.cl', 'Juan')
    const viejo = person(31, 'viejo@x.cl', 'Viejo') // orden antigua: attendee con un email, comprador con otro
    db.tables.events.push({ id: 30, name: 'Fiesta', slug: 'fiesta', status: 'published', organization_id: 7, review_settings: null })
    db.tables.event_dates.push({ id: 301, event_id: 30, date: '2026-10-17', start_time: '22:00', end_time: '04:00' }) // 04:00 => 12:00 (15:00Z)
    db.tables.event_attendees.push(
      ticket(30, 30, juan, 301, 'active', { holder_email: 'Kim@X.cl', holder_name: 'Kim Lee' }),
      ticket(31, 30, juan, 301),
      ticket(32, 30, viejo, 301, 'validated', { event_orders: { attendee_id: 31, buyer_first_name: 'Paz', buyer_last_name: 'Soto', buyer_email: 'paz@x.cl' } })
    )
    await run(new Date('2026-10-18T14:59:00Z'))
    expect(sendEmail.mock.calls.some((c) => c[0].idempotencyKey.startsWith('review-30-'))).toBe(false)
    await run(new Date('2026-10-18T15:20:00Z'))
    const call = sendEmail.mock.calls.find((c) => c[0].idempotencyKey.startsWith('review-30-'))
    expect(recipientsOf(call)).toEqual(['juan@x.cl', 'kim@x.cl', 'paz@x.cl', 'viejo@x.cl'])
    expect(call[0].recipientVariables['kim@x.cl'].name.text).toBe('Kim')
    expect(call[0].recipientVariables['juan@x.cl'].name.text).toBe('Juan')
    const kim = db.tables.notification_log.find((l) => l.email === 'kim@x.cl')
    expect(kim).toMatchObject({ event_id: 30, attendee_id: null, type: 'review_request' })
  })

  it('sin la columna notification_log.email (base sin migrar) omite a quien no tiene attendee_id', async () => {
    db.tables.events = [{ id: 30, name: 'Fiesta', slug: 'fiesta', status: 'published', organization_id: 7, review_settings: null }]
    db.tables.event_dates = [{ id: 301, event_id: 30, date: '2026-10-17', start_time: '22:00', end_time: '04:00' }]
    db.tables.event_attendees = [ticket(30, 30, person(30, 'juan@x.cl', 'Juan'), 301, 'active', { holder_email: 'kim@x.cl', holder_name: 'Kim' })]
    db.tables.notification_log = []
    db.failOn('notification_log', 'select', { code: '42703', message: 'column notification_log.email does not exist' })
    await run(new Date('2026-10-18T15:20:00Z'))
    expect(recipientsOf(sendEmail.mock.calls[0])).toEqual(['juan@x.cl'])
    expect(db.tables.notification_log).toHaveLength(1)
    expect(db.tables.notification_log[0]).not.toHaveProperty('email')
  })

  it('collectRecipients: una persona por email, con sus funciones y si tiene entradas "cualquier función"', () => {
    const { people, attendeeEmails } = collectRecipients(
      [ticket(1, 10, ana, 101), ticket(2, 10, ana, null), ticket(3, 10, dani, 101, 'cancelled'), ticket(4, 10, beto, 555)],
      new Set(['101', '102'])
    )
    expect([...people.keys()].sort()).toEqual(['ana@x.cl', 'beto@x.cl'])
    expect(people.get('ana@x.cl')).toMatchObject({ attendeeId: 1, untied: true })
    expect([...people.get('ana@x.cl').fnIds]).toEqual(['101'])
    expect(people.get('beto@x.cl').untied).toBe(true) // función borrada
    expect(attendeeEmails.get('4')).toBe('dani@x.cl') // también las entradas anuladas (filas antiguas del log)
  })
})

describe('sendReviewRequests: links, premio y errores', () => {
  it('cada destinatario recibe su link firmado, un link por estrella y su enlace de baja', async () => {
    await run(T0)
    const call = sendEmail.mock.calls.find((c) => c[0].recipientVariables['ana@x.cl'])[0]
    const vars = call.recipientVariables['ana@x.cl']
    expect(vars.name.text).toBe('Ana')
    expect(vars.review_url.text).toMatch(/^https:\/\/aitickets\.cl\/eventos\/gira#resena=/)
    expect(vars.star5.text).toBe(`${vars.review_url.text}&nota=5`)
    expect(vars.star5.html).toContain('&amp;nota=5')
    const token = decodeURIComponent(vars.review_url.text.split('#resena=')[1])
    expect(verifyReviewToken(token, { now: T0 })).toEqual({ eventId: 10, email: 'ana@x.cl', via: 'email_link' })
    expect(call.html).toContain('%recipient.star3%')
    // Baja de los recordatorios: página + one-click (List-Unsubscribe)
    expect(vars.unsubscribe_url.text).toMatch(/^https:\/\/aitickets\.cl\/resenas\/baja\?t=/)
    expect(call.headers).toEqual({ 'List-Unsubscribe': '<%recipient.unsubscribe_one_click%>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' })
    const optout = decodeURIComponent(vars.unsubscribe_one_click.text.split('?t=')[1])
    expect(verifyReviewReminderOptoutToken(optout)).toEqual({ eventId: 10, email: 'ana@x.cl' })
    expect(call.html).toContain('No quiero más recordatorios de este evento')
  })

  it('el premio configurado aparece en el correo', async () => {
    await run(T0)
    const show = sendEmail.mock.calls.find((c) => c[0].recipientVariables['gabi@x.cl'])[0]
    expect(show.html).toContain('15% de descuento')
    const gira = sendEmail.mock.calls.find((c) => c[0].recipientVariables['ana@x.cl'])[0]
    expect(gira.html).not.toContain('de descuento')
  })

  it('si el envío falla no registra (se reintenta en la próxima hora)', async () => {
    sendEmail.mockRejectedValue(new Error('Resend 500'))
    const result = await run(T0)
    expect(result.sent).toBe(0)
    expect(result.failed).toBe(3)
    expect(db.tables.notification_log).toHaveLength(1)
  })

  it('sin secreto de firma no envía nada', async () => {
    vi.stubEnv('REVIEW_TOKEN_SECRET', '')
    vi.stubEnv('EMAIL_VERIFY_SECRET', '')
    vi.stubEnv('INTERNAL_API_SECRET', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    const result = await run(T0)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(result.sent).toBe(0)
  })

  it('si se acaba el tiempo deja el resto para la próxima hora', async () => {
    const result = await run(T0, { budgetMs: -1 })
    expect(result).toMatchObject({ events: 0, sent: 0, partial: true })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('reviewLinks y reviewOptoutLinks codifican el slug y el token', () => {
    const links = reviewLinks('mi evento', 'a.b')
    expect(links.review).toBe('https://aitickets.cl/eventos/mi%20evento#resena=a.b')
    expect(links.stars).toHaveLength(5)
    expect(reviewOptoutLinks('a+b')).toEqual({ page: 'https://aitickets.cl/resenas/baja?t=a%2Bb', oneClick: 'https://aitickets.cl/api/resenas/baja?t=a%2Bb' })
  })
})

describe('summarizeReviewRequestLog / reminderDue', () => {
  it('cuenta por email y asocia las filas antiguas por attendee_id', () => {
    const rows = [
      { attendee_id: 1, type: 'review_request', created_at: '2026-10-18T13:00:00Z' }, // antigua
      { attendee_id: 1, email: 'ana@x.cl', type: 'review_request', created_at: '2026-10-20T13:00:00Z' },
      { attendee_id: null, email: 'kim@x.cl', type: 'review_request', created_at: '2026-10-18T13:00:00Z' },
      { attendee_id: null, email: 'kim@x.cl', type: 'review_request_optout', created_at: '2026-10-19T13:00:00Z' },
      { attendee_id: 9, type: 'review_request', created_at: '2026-10-18T13:00:00Z' }, // sin email conocido
    ]
    const log = summarizeReviewRequestLog(rows)
    expect(log.get('ana@x.cl')).toEqual({ count: 2, first: Date.parse('2026-10-18T13:00:00Z'), last: Date.parse('2026-10-20T13:00:00Z'), optedOut: false })
    expect(log.get('kim@x.cl')).toMatchObject({ count: 1, optedOut: true })
    expect(log.get('a:9')).toMatchObject({ count: 1 })
    expect(summarizeReviewRequestLog(rows.slice(4), new Map([['9', 'zoe@x.cl']])).get('zoe@x.cl')).toMatchObject({ count: 1 })
  })

  it('reminderDue respeta el paso, la fecha del último correo, la baja y el tope de 10 días', () => {
    const first = Date.parse('2026-10-18T13:20:00Z')
    expect(reminderDue({ count: 1, first, last: first, optedOut: false }, at(T0, 47))).toBe(false)
    expect(reminderDue({ count: 1, first, last: first, optedOut: false }, at(T0, 48))).toBe(true)
    expect(reminderDue({ count: 1, first, last: first, optedOut: true }, at(T0, 48))).toBe(false)
    expect(reminderDue({ count: 2, first, last: first + 48 * H, optedOut: false }, at(T0, 48 + 71))).toBe(false)
    expect(reminderDue({ count: 2, first, last: first + 48 * H, optedOut: false }, at(T0, 48 + 72))).toBe(true)
    expect(reminderDue({ count: 3, first, last: first + 120 * H, optedOut: false }, at(T0, 300))).toBe(false)
    expect(reminderDue({ count: 1, first, last: first, optedOut: false }, at(T0, 10 * 24 + 1))).toBe(false)
  })
})

describe('/api/resenas/baja', () => {
  const redirect = (location, status) => new Response(null, { status, headers: { Location: location } })
  const ctx = (path, init) => ({ request: new Request(`https://aitickets.test${path}`, init), url: new URL(`https://aitickets.test${path}`), redirect })
  const optouts = () => db.tables.notification_log.filter((l) => l.type === 'review_request_optout')

  it('GET no da de baja (los escáneres de enlaces hacen GET): lleva a la confirmación', async () => {
    const t = signReviewReminderOptoutToken({ eventId: 10, email: 'ana@x.cl' })
    const res = await optoutGet(ctx(`/api/resenas/baja?t=${encodeURIComponent(t)}`))
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe(`/resenas/baja?t=${encodeURIComponent(t)}`)
    expect(optouts()).toHaveLength(0)
  })

  it('POST one-click (List-Unsubscribe) y POST del botón de la página', async () => {
    const t = signReviewReminderOptoutToken({ eventId: 10, email: 'ana@x.cl' })
    const oneClick = await optoutPost(ctx(`/api/resenas/baja?t=${encodeURIComponent(t)}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' }))
    expect(oneClick.status).toBe(200)
    expect(optouts()).toEqual([expect.objectContaining({ event_id: 10, email: 'ana@x.cl', attendee_id: null, status: 'optout' })])

    const form = new URLSearchParams({ t: signReviewReminderOptoutToken({ eventId: 11, email: 'hugo@x.cl' }), from: 'page' })
    const page = await optoutPost(ctx('/api/resenas/baja', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() }))
    expect(page.status).toBe(303)
    expect(page.headers.get('Location')).toBe('/resenas/baja?listo=1')
    expect(optouts()).toHaveLength(2)

    const bad = await optoutPost(ctx('/api/resenas/baja?t=basura', { method: 'POST' }))
    expect(bad.status).toBe(400)
  })

  it('un token de reseña no sirve para dar de baja (ni al revés)', async () => {
    expect(await optOutOfReviewReminders('x.y', db)).toBe(false)
    const { signReviewToken } = await import('../../netlify/lib/review-token.mjs')
    expect(await optOutOfReviewReminders(signReviewToken({ eventId: 10, email: 'ana@x.cl' }), db)).toBe(false)
    expect(verifyReviewToken(signReviewReminderOptoutToken({ eventId: 10, email: 'ana@x.cl' }))).toBeNull()
  })
})
