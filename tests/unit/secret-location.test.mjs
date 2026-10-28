// Dirección que solo ven quienes compran (ítem 10): no sale en la página pública (ni en su JSON-LD, que se arma con
// los mismos datos), ni en el chat del comprador ni en el copy de marketing; quien compró la ve en la orden y el correo,
// o desde N horas antes, cuando le llega el aviso programado. Sin red ni BD.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import {
  firstRelevantStart,
  isRevealed,
  normalizeRevealHours,
  normalizeSecretLocation,
  pendingRevealText,
  publicPlace,
  revealAt,
  dueReveals,
  sendSecretLocationReveals,
} from '../../netlify/lib/secret-location.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))

const { getPublicEventData } = await import('../../src/lib/eventPage.ts')
const { refreshEventDenorm } = await import('../../src/pages/api/_lib/events.ts')
const { buildSystemPrompt } = await import('../../netlify/functions/ai-assistant/index.mjs')
const { buildEventContext } = await import('../../src/lib/marketing.ts')

const STREET = 'Av. Irarrázaval 1234'
const SECRET = 'Pasaje Los Aromos 77, Ñuñoa'
const LOC = { name: 'Main', display_name: null, address_line1_override: null, city_override: null, latitude_override: null, longitude_override: null, venues: { id: 'v1', name: 'Casa Sur', address_line1: STREET, city: 'Ñuñoa', latitude: -33.45, longitude: -70.6, country_code: 'CL' } }
// Sábado 5 de diciembre de 2026, 22:00 (Santiago, UTC-3)
const DATES = [{ id: 501, event_id: 10, date: '2026-12-05', start_time: '22:00:00', end_time: '04:00:00', event_locations: LOC }]
const at = (iso) => new Date(`${iso}-03:00`)

afterEach(() => vi.useRealTimers())

describe('cuándo se revela', () => {
  it('normaliza y calcula desde la primera función de la entrada', () => {
    expect(normalizeSecretLocation('  Pasaje   Los Aromos 77 ')).toBe('Pasaje Los Aromos 77')
    expect(normalizeSecretLocation('   ')).toBeNull()
    expect(normalizeRevealHours('6')).toBe(6)
    expect(normalizeRevealHours(0)).toBeNull()
    expect(normalizeRevealHours(500)).toBeNull()
    const dates = [...DATES, { id: 502, date: '2026-12-12', start_time: '22:00:00' }]
    expect(firstRelevantStart(dates, [502]).toISOString()).toBe('2026-12-13T01:00:00.000Z')
    // Una entrada para todas las funciones: la primera del evento
    expect(firstRelevantStart(dates, [null]).toISOString()).toBe('2026-12-06T01:00:00.000Z')
    const start = firstRelevantStart(dates, [501])
    expect(revealAt(start, 6).toISOString()).toBe('2026-12-05T19:00:00.000Z')
    expect(isRevealed({ revealHours: 6, start, now: at('2026-12-05T15:59:00') })).toBe(false)
    expect(isRevealed({ revealHours: 6, start, now: at('2026-12-05T16:00:00') })).toBe(true)
    expect(isRevealed({ revealHours: null, start, now: at('2026-11-01T12:00:00') })).toBe(true)
    expect(pendingRevealText(6, revealAt(start, 6))).toBe('La dirección exacta te llega por correo 6 horas antes (sábado, 5 de diciembre de 2026 a las 16:00). También aparecerá en tu orden.')
  })

  it('lo público va sin la calle: nombre y comuna', () => {
    expect(publicPlace(LOC)).toBe('Casa Sur, Ñuñoa')
  })
})

describe('la página pública no trae la dirección', () => {
  const seed = (hasSecret) => {
    db = createFakeSupabase({
      tables: {},
      rpc: {
        aitickets_public_event_page: () => ({
          event: { id: 10, slug: 'fiesta', name: 'Fiesta', title: 'Fiesta', status: 'published', accessibility: 'public', organization_id: 7, location: `Casa Sur, ${STREET}, Ñuñoa`, image_url: null, description: 'Fiesta' },
          categories: [],
          tickets: [{ id: 100, ticket_name: 'General', price: 5000, total_quantity: null, status: 'available', is_gift: false, init_date: null, end_date: null, event_date_id: null }],
          faqs: [],
          dates: DATES,
          org: null,
          trust: null,
          has_secret_location: hasSecret,
          gallery: [],
          availability: [],
        }),
      },
    })
  }

  it('con dirección privada: sin calle, sin coordenadas ni events.location antiguo', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(at('2026-11-20T12:00:00'))
    seed(true)
    const page = await getPublicEventData('fiesta')
    const json = JSON.stringify(page)
    expect(json).not.toContain(STREET)
    expect(json).not.toContain(SECRET)
    expect(json).not.toContain('-70.6')
    expect(page.eventData.has_secret_location).toBe(true)
    expect(page.eventData.location).toBe('Casa Sur, Ñuñoa')
    expect(page.eventData.venue).toMatchObject({ name: 'Casa Sur', city: 'Ñuñoa', address: null, latitude: null })
  })

  it('sin dirección privada se ve la calle, como siempre', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(at('2026-11-20T12:00:00'))
    seed(false)
    const page = await getPublicEventData('fiesta')
    expect(page.eventData.venue.address).toBe(STREET)
  })
})

describe('lo demás que es público', () => {
  it('events.location (listados y sitios) queda sin la calle', async () => {
    db = createFakeSupabase({
      tables: {
        events: [{ id: 10, secret_location: SECRET, location: null }],
        event_dates: [{ id: 501, event_id: 10, date: '2026-12-05', start_time: '22:00:00', end_time: null, event_location_id: 'l1' }],
        event_locations: [{ id: 'l1', event_id: 10, created_at: '2026-11-01', venues: { name: 'Casa Sur', address_line1: STREET, city: 'Ñuñoa' } }],
      },
    })
    const res = await refreshEventDenorm(10)
    expect(res.location).toBe('Casa Sur, Ñuñoa')
    db.tables.events[0].secret_location = null
    expect((await refreshEventDenorm(10)).location).toContain(STREET)
  })

  it('el chat del comprador no la conoce', () => {
    const base = { event: { id: 10, name: 'Fiesta', description: '', location: 'Casa Sur, Ñuñoa' }, isDemo: false, dates: DATES, tickets: [], faqs: [] }
    const secret = buildSystemPrompt({ ...base, hasSecretLocation: true })
    expect(secret).not.toContain(STREET)
    expect(secret).toContain('La dirección exacta solo la reciben quienes compran')
    expect(buildSystemPrompt(base)).toContain(STREET)
  })

  it('el copy de marketing y redes va sin la calle', () => {
    const event = { name: 'Fiesta', description: '', secret_location: SECRET, event_dates: [], event_tickets: [], event_locations: [{ venues: { name: 'Casa Sur', city: 'Ñuñoa', address_line1: STREET } }] }
    const text = buildEventContext(event)
    expect(text).not.toContain(STREET)
    expect(text).not.toContain(SECRET)
    expect(text).toContain('Casa Sur, Ñuñoa')
  })
})

describe('aviso programado cuando se revela', () => {
  const seedReveal = () => {
    db = createFakeSupabase({
      tables: {
        events: [{ id: 10, name: 'Fiesta', slug: 'fiesta', status: 'published', secret_location: SECRET, secret_location_reveal_hours: 6 }],
        event_dates: DATES.map(({ event_locations: _l, ...d }) => d),
        event_attendees: [
          { id: 'a1', event_id: 10, attendee_id: 1, event_order_id: 'o1', status: 'active', created_at: '2026-11-10T12:00:00Z', attendees: { id: 1, first_name: 'Ana', last_name: 'P', email: 'ana@x.cl' }, event_tickets: { event_date_id: null }, event_orders: null },
          { id: 'a2', event_id: 10, attendee_id: 2, event_order_id: 'o2', status: 'cancelled', created_at: '2026-11-10T12:00:00Z', attendees: { id: 2, first_name: 'Beto', last_name: '', email: 'beto@x.cl' }, event_tickets: { event_date_id: null }, event_orders: null },
          // Compró después de que se reveló: su correo de la entrada ya la traía
          { id: 'a3', event_id: 10, attendee_id: 3, event_order_id: 'o3', status: 'active', created_at: '2026-12-05T20:00:00Z', attendees: { id: 3, first_name: 'Ceci', last_name: '', email: 'ceci@x.cl' }, event_tickets: { event_date_id: null }, event_orders: null },
        ],
        notification_log: [],
      },
    })
  }
  const deps = (sent) => ({
    sendEmail: async (msg) => sent.push(msg),
    renderEmail: async (o) => ({ subject: `La dirección de ${o.eventName}`, html: o.address, text: o.address }),
    siteUrl: 'https://aitickets.test',
    formatRecipient: (_n, e) => e,
    isValidEmail: (e) => /@/.test(e),
    escapeHtml: (s) => s,
    greetingName: (f) => f,
    holderName: (a) => ({ first_name: a.first_name, last_name: a.last_name }),
    fetchAllRows: async (q) => (await q()).data,
    formatDateOnlyLong: (d) => d,
    formatTimeShort: (t) => String(t).slice(0, 5),
  })

  it('a la hora (6 h antes) manda la dirección una vez a quien ya había comprado', async () => {
    seedReveal()
    expect(dueReveals(db.tables.events, db.tables.event_dates, at('2026-12-05T15:00:00'))).toHaveLength(0)
    expect(dueReveals(db.tables.events, db.tables.event_dates, at('2026-12-05T16:10:00'))).toHaveLength(1)

    const sent = []
    const now = at('2026-12-05T16:10:00')
    expect(await sendSecretLocationReveals(db, { ...deps(sent), now })).toEqual({ sent: 1, events: 1 })
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toEqual(['ana@x.cl'])
    expect(sent[0].html).toBe(SECRET)
    expect(sent[0].recipientVariables['ana@x.cl'].order_url.text).toBe('https://aitickets.test/order/o1')
    // El siguiente turno no repite
    expect(await sendSecretLocationReveals(db, { ...deps(sent), now: at('2026-12-05T16:25:00') })).toEqual({ sent: 0, events: 0 })
  })

  it('sin la columna de horas (migración pendiente) no hace nada', async () => {
    seedReveal()
    db.failOn('events', 'select', { code: '42703', message: 'column events.secret_location_reveal_hours does not exist' })
    expect(await sendSecretLocationReveals(db, { ...deps([]), now: at('2026-12-05T16:10:00') })).toEqual({ sent: 0, events: 0 })
  })
})
