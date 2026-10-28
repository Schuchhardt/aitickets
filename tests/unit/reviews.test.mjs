// Reseñas de eventos: reglas puras (netlify/lib/reviews.mjs), tokens firmados (review-token.mjs), lectura del
// link del correo en la página (eventView.js) y búsqueda de asistencia con un Supabase falso.
import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import {
  normalizeReviewSettings,
  normalizeRating,
  normalizeComment,
  reviewDisplayName,
  summarizeRatings,
  functionEndsAt,
  dueReviewFunctions,
  lastFunctionOf,
  reviewsOpen,
  generateRewardCode,
  parseAttendanceReference,
  filterInviteRecipients,
  findAttendanceByEmail,
  findAttendanceByReference,
  maskEmail,
  escapeLike,
  REWARD_LIMITS,
} from '../../netlify/lib/reviews.mjs'
import { signReviewToken, verifyReviewToken, signInviteOptoutToken, verifyInviteOptoutToken } from '../../netlify/lib/review-token.mjs'
import { DISCOUNT_CODE_RE, normalizeDiscountCode } from '../../netlify/lib/discounts.mjs'
import { readReviewHash, formatRating, reviewsCountLabel } from '../../src/components/event/eventView.js'

describe('normalizeReviewSettings', () => {
  it('por defecto: correo activado, sin premio, fotos sin moderación', () => {
    expect(normalizeReviewSettings(null)).toEqual({ enabled: true, reward: null, moderate_photos: false, show_while_on_sale: false })
    expect(normalizeReviewSettings('basura')).toEqual({ enabled: true, reward: null, moderate_photos: false, show_while_on_sale: false })
  })
  it('acota el premio a los límites y completa los días', () => {
    expect(normalizeReviewSettings({ reward: { value: 80 } }).reward).toEqual({ value: REWARD_LIMITS.maxValue, valid_days: REWARD_LIMITS.defaultDays })
    expect(normalizeReviewSettings({ reward: { value: 1, valid_days: 2 } }).reward).toEqual({ value: REWARD_LIMITS.minValue, valid_days: REWARD_LIMITS.minDays })
    expect(normalizeReviewSettings({ reward: { value: 'x' } }).reward).toBeNull()
  })
  it('respeta enabled=false y moderate_photos=true', () => {
    expect(normalizeReviewSettings({ enabled: false, moderate_photos: true })).toMatchObject({ enabled: false, moderate_photos: true })
  })
})

describe('validación de la reseña', () => {
  it('rating entero de 1 a 5', () => {
    expect([1, 5, '3'].map(normalizeRating)).toEqual([1, 5, 3])
    expect([0, 6, 4.5, null, 'abc'].map(normalizeRating)).toEqual([null, null, null, null, null])
  })
  it('comentarios: sin caracteres de control, espacios recortados, máximo 2 saltos seguidos y largo acotado', () => {
    expect(normalizeComment('  Muy   bueno\u0007\r\n\r\n\r\n\r\nvolvería  ', 100)).toBe('Muy bueno\n\nvolvería')
    expect(normalizeComment('   ', 100)).toBeNull()
    expect(normalizeComment(42, 100)).toBeNull()
    expect(normalizeComment('a'.repeat(50), 10)).toHaveLength(10)
  })
  it('nombre público: nombre de pila + inicial del apellido', () => {
    expect(reviewDisplayName('María José', 'Pérez Soto')).toBe('María P.')
    expect(reviewDisplayName('seba', 'schuchhardt')).toBe('seba S.')
    expect(reviewDisplayName('Ana', '')).toBe('Ana')
    expect(reviewDisplayName('', 'Pérez')).toBeNull()
  })
})

describe('summarizeRatings', () => {
  it('promedio con un decimal y distribución', () => {
    expect(summarizeRatings([{ rating: 5 }, { rating: 4 }, { rating: 4 }, { rating: 2 }, { rating: 9 }])).toEqual({
      count: 4,
      average: 3.8,
      distribution: { 1: 0, 2: 1, 3: 0, 4: 2, 5: 1 },
    })
    expect(summarizeRatings([])).toEqual({ count: 0, average: null, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } })
  })
})

describe('término de funciones y ventana del correo de 24 h', () => {
  // 2026-10-17 es primavera en Chile (UTC-3)
  it('usa end_time, o start + 3 h, y cruza medianoche', () => {
    expect(functionEndsAt({ date: '2026-10-17', start_time: '20:00', end_time: '23:30' }).toISOString()).toBe('2026-10-18T02:30:00.000Z')
    expect(functionEndsAt({ date: '2026-10-17', start_time: '20:00', end_time: null }).toISOString()).toBe('2026-10-18T02:00:00.000Z')
    expect(functionEndsAt({ date: '2026-10-17', start_time: '22:00', end_time: '04:00' }).toISOString()).toBe('2026-10-18T07:00:00.000Z')
    expect(functionEndsAt({ date: 'nope' })).toBeNull()
  })
  it('pide la reseña entre 24 y 72 h después del término', () => {
    const fn = { id: 1, date: '2026-10-17', start_time: '20:00', end_time: '23:00' } // termina 2026-10-18T02:00Z
    const due = (iso) => dueReviewFunctions([fn], new Date(iso)).map((f) => f.id)
    expect(due('2026-10-19T01:59:00Z')).toEqual([]) // 23 h 59
    expect(due('2026-10-19T02:00:00Z')).toEqual([1]) // 24 h
    expect(due('2026-10-21T01:59:00Z')).toEqual([1]) // < 72 h
    expect(due('2026-10-21T02:00:00Z')).toEqual([]) // 72 h: ya no
  })
  it('última función y apertura de reseñas', () => {
    const dates = [
      { id: 1, date: '2026-10-17', start_time: '20:00' },
      { id: 2, date: '2026-10-24', start_time: '20:00' },
      { id: 3, date: '2026-10-20', start_time: '20:00' },
    ]
    expect(lastFunctionOf(dates).id).toBe(2)
    expect(reviewsOpen({}, dates, new Date('2026-10-17T22:59:00Z'))).toBe(false)
    expect(reviewsOpen({}, dates, new Date('2026-10-17T23:00:00Z'))).toBe(true)
    expect(reviewsOpen({ start_date: '2026-10-01T00:00:00Z' }, [], new Date('2026-10-02T00:00:00Z'))).toBe(true)
    expect(reviewsOpen({}, [], new Date())).toBe(false)
  })
})

describe('código de premio', () => {
  it('cabe en el formato de los códigos de descuento y no usa caracteres ambiguos', () => {
    const code = generateRewardCode()
    expect(code).toMatch(/^GRACIAS-[A-HJ-KMNP-Z2-9]{6}$/)
    expect(DISCOUNT_CODE_RE.test(code)).toBe(true)
    expect(normalizeDiscountCode(code.toLowerCase())).toBe(code)
    expect(generateRewardCode(() => [0, 1, 2, 3, 4, 30])).toBe('GRACIAS-ABCDE9')
  })
})

describe('parseAttendanceReference', () => {
  const ORDER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  it('reconoce link de orden, de entrada, id suelto y código QR', () => {
    expect(parseAttendanceReference(`https://aitickets.cl/order/${ORDER}`)).toEqual({ kind: 'order', value: ORDER })
    expect(parseAttendanceReference(`https://aitickets.cl/ticket/${ORDER.toUpperCase()}`)).toEqual({ kind: 'ticket', value: ORDER })
    expect(parseAttendanceReference(` ${ORDER} `)).toEqual({ kind: 'uuid', value: ORDER })
    const qr = 'ab'.repeat(32)
    expect(parseAttendanceReference(qr.toUpperCase())).toEqual({ kind: 'qr', value: qr })
    expect(parseAttendanceReference('hola')).toBeNull()
    expect(parseAttendanceReference('')).toBeNull()
  })
})

describe('filterInviteRecipients', () => {
  const holders = [
    { id: 1, email: 'a@x.cl', checkedIn: true },
    { id: 2, email: 'b@x.cl', checkedIn: false },
    { id: 3, email: 'c@x.cl', checkedIn: true },
    { id: 4, email: 'd@x.cl', checkedIn: true },
    { id: 5, email: 'e@x.cl', checkedIn: true },
  ]
  const ratings = new Map([['a@x.cl', 5], ['b@x.cl', 2], ['c@x.cl', 4]])
  const opts = { ratings, optedOut: new Set(['d@x.cl']), alreadyInvited: new Set(['5']), targetHolders: new Set(['c@x.cl']) }
  const emails = (audience) => filterInviteRecipients(holders, { ...opts, audience }).map((h) => h.email)
  it('excluye bajas, ya invitados y quienes ya tienen entradas del evento destino', () => {
    expect(emails('all')).toEqual(['a@x.cl', 'b@x.cl'])
  })
  it('audiencias: ingresaron, calificaron, calificaron 4-5', () => {
    expect(emails('checked_in')).toEqual(['a@x.cl'])
    expect(emails('reviewers')).toEqual(['a@x.cl', 'b@x.cl'])
    expect(emails('promoters')).toEqual(['a@x.cl'])
  })
})

describe('helpers de presentación', () => {
  it('maskEmail, escapeLike, formatRating y reviewsCountLabel', () => {
    expect(maskEmail('sebastian@gmail.com')).toBe('se******@gmail.com')
    expect(maskEmail('ab@x.cl')).toBe('ab*@x.cl')
    expect(escapeLike('a_b%c\\d')).toBe('a\\_b\\%c\\\\d')
    expect(formatRating(4.56)).toBe('4,6')
    expect(reviewsCountLabel(1)).toBe('1 reseña')
    expect(reviewsCountLabel(23)).toBe('23 reseñas')
  })
  it('readReviewHash lee el token y la nota del fragmento del correo', () => {
    expect(readReviewHash('#resena=abc.def&nota=4')).toEqual({ token: 'abc.def', rating: 4 })
    expect(readReviewHash('#resena=abc.def&nota=9')).toEqual({ token: 'abc.def', rating: null })
    expect(readReviewHash('#resenas')).toBeNull()
    expect(readReviewHash('')).toBeNull()
  })
})

describe('tokens firmados', () => {
  it('sin secreto no firma ni verifica (falla cerrado)', () => {
    expect(signReviewToken({ eventId: 1, email: 'a@x.cl' })).toBe('')
    expect(verifyReviewToken('abc.def')).toBeNull()
  })
  it('token de reseña: ida y vuelta, vía, vencimiento y manipulación', () => {
    vi.stubEnv('REVIEW_TOKEN_SECRET', 'test-secret')
    const now = new Date('2026-10-20T00:00:00Z')
    const token = signReviewToken({ eventId: 12, email: ' Ana@X.cl ', via: 'order' }, { now })
    expect(verifyReviewToken(token, { now })).toEqual({ eventId: 12, email: 'ana@x.cl', via: 'order' })
    expect(verifyReviewToken(signReviewToken({ eventId: 12, email: 'a@x.cl' }, { now }), { now }).via).toBe('email_link')
    expect(verifyReviewToken(token, { now: new Date('2027-02-01T00:00:00Z') })).toBeNull() // > 90 días
    const [body, mac] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), e: 13 })).toString('base64url')
    expect(verifyReviewToken(`${forged}.${mac}`, { now })).toBeNull()
    // Otro propósito no sirve
    expect(verifyReviewToken(signInviteOptoutToken({ organizationId: 7, email: 'a@x.cl' }), { now })).toBeNull()
  })
  it('token de baja: sin vencimiento y atado a la organización', () => {
    vi.stubEnv('REVIEW_TOKEN_SECRET', 'test-secret')
    const token = signInviteOptoutToken({ organizationId: 7, email: 'A@x.cl' })
    expect(verifyInviteOptoutToken(token, { now: new Date('2040-01-01T00:00:00Z') })).toEqual({ organizationId: 7, email: 'a@x.cl' })
    vi.stubEnv('REVIEW_TOKEN_SECRET', 'otro-secreto')
    expect(verifyInviteOptoutToken(token)).toBeNull()
  })
  it('sin REVIEW_TOKEN_SECRET usa una clave derivada de EMAIL_VERIFY_SECRET', () => {
    vi.stubEnv('EMAIL_VERIFY_SECRET', 'verify-secret')
    const token = signReviewToken({ eventId: 1, email: 'a@x.cl' })
    expect(token).not.toBe('')
    expect(verifyReviewToken(token)?.eventId).toBe(1)
  })
})

describe('asistencia', () => {
  const ORDER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const ORDER_OTHER_EVENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const TICKET = '11111111-1111-4111-8111-111111111111'
  const db = () =>
    createFakeSupabase({
      tables: {
        attendees: [
          { id: 1, first_name: 'Ana', last_name: 'Rojas', email: 'Ana@X.cl' },
          { id: 2, first_name: 'Beto', last_name: 'Soto', email: 'beto@x.cl' },
          { id: 3, first_name: 'Caro', last_name: 'Vera', email: 'caro@x.cl' },
        ],
        event_orders: [
          { id: ORDER, event_id: 10, status: 'paid', attendee_id: 1, buyer_first_name: 'Ana María', buyer_last_name: 'Rojas', buyer_email: 'ana@x.cl' },
          { id: ORDER_OTHER_EVENT, event_id: 11, status: 'paid', attendee_id: 1, buyer_email: 'ana@x.cl' },
          { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', event_id: 10, status: 'paid', attendee_id: 3, buyer_first_name: 'Caro', buyer_email: 'caro@x.cl' },
        ],
        event_attendees: [
          { id: TICKET, event_id: 10, attendee_id: 1, status: 'validated', validated_at: '2026-10-17T23:30:00Z', event_order_id: ORDER, qr_code: 'f'.repeat(64), attendees: { id: 1, first_name: 'Ana', last_name: 'Rojas', email: 'Ana@X.cl' }, event_orders: { buyer_first_name: 'Ana María', buyer_last_name: 'Rojas', buyer_email: 'ana@x.cl' } },
          { id: '22222222-2222-4222-8222-222222222222', event_id: 10, attendee_id: 2, status: 'cancelled', event_order_id: null, attendees: { id: 2, email: 'beto@x.cl' } },
          // Caro compró una entrada a nombre de Beto (otra persona)
          { id: '33333333-3333-4333-8333-333333333333', event_id: 10, attendee_id: 2, status: 'active', event_order_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', attendees: { id: 2, email: 'beto@x.cl' } },
        ],
      },
    })

  it('por email: titular con entrada vigente (sin distinguir mayúsculas) y el nombre de la orden', async () => {
    const found = await findAttendanceByEmail(db(), 10, 'ANA@x.cl')
    expect(found).toEqual({ attendeeId: 1, email: 'ana@x.cl', first_name: 'Ana María', last_name: 'Rojas', checkedIn: true })
  })
  it('por email: comprador que compró para otro también puede calificar', async () => {
    const found = await findAttendanceByEmail(db(), 10, 'caro@x.cl')
    expect(found).toMatchObject({ email: 'caro@x.cl', first_name: 'Caro', checkedIn: false })
  })
  it('por email: sin entradas vigentes o de otro evento => null', async () => {
    expect(await findAttendanceByEmail(db(), 12, 'ana@x.cl')).toBeNull()
    expect(await findAttendanceByEmail(db(), 10, 'nadie@x.cl')).toBeNull()
  })
  it('por referencia: orden pagada del evento, entrada y QR', async () => {
    expect(await findAttendanceByReference(db(), 10, { kind: 'order', value: ORDER })).toMatchObject({ email: 'ana@x.cl', via: 'order', checkedIn: true })
    expect(await findAttendanceByReference(db(), 10, { kind: 'uuid', value: TICKET })).toMatchObject({ email: 'ana@x.cl', via: 'ticket' })
    expect(await findAttendanceByReference(db(), 10, { kind: 'qr', value: 'f'.repeat(64) })).toMatchObject({ email: 'ana@x.cl', via: 'ticket' })
  })
  it('por referencia: orden de otro evento o entrada anulada => null', async () => {
    expect(await findAttendanceByReference(db(), 10, { kind: 'order', value: ORDER_OTHER_EVENT })).toBeNull()
    expect(await findAttendanceByReference(db(), 10, { kind: 'ticket', value: '22222222-2222-4222-8222-222222222222' })).toBeNull()
  })
})
