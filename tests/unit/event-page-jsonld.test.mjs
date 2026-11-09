// De la BD al JSON-LD: getPublicEventData (src/lib/eventPage.ts) con aitickets_public_event_page falsa y después
// buildEventJsonLd (src/lib/eventJsonLd.ts). Cubre la función nueva (migración 202611090100: performers, created_at y
// el sitio de la productora) y la anterior (sin esos datos: la página sigue funcionando).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))

const { getPublicEventData } = await import('../../src/lib/eventPage.ts')
const { buildEventJsonLd } = await import('../../src/lib/eventJsonLd.ts')

const CTX = { siteUrl: 'https://aitickets.cl', canonicalUrl: 'https://aitickets.cl/eventos/tocata', images: [], fallbackDescription: '', brand: 'AI Tickets', supportEmail: 'soporte@aitickets.cl' }
const DATES = [{ id: 501, event_id: 10, date: '2026-12-05', start_time: '21:00:00', end_time: '23:30:00', event_locations: null }]

const seed = ({ event = {}, ticket = {}, org, site } = {}) => {
  db = createFakeSupabase({
    tables: {},
    rpc: {
      aitickets_public_event_page: () => ({
        event: { id: 10, slug: 'tocata', name: 'Tocata', title: 'Tocata', status: 'published', accessibility: 'public', organization_id: 7, location: 'Bar Loreto, Santiago', image_url: null, description: 'Tocata', ...event },
        categories: [],
        tickets: [{ id: 100, ticket_name: 'General', price: 8000, total_quantity: null, status: 'available', is_gift: false, init_date: null, end_date: null, event_date_id: null, ...ticket }],
        faqs: [],
        dates: DATES,
        org: org === undefined ? { public_name: 'Sello Sur', website: 'sellosur.cl', instagram: '@sellosur', facebook: null, tiktok: null } : org,
        ...(site !== undefined ? { site } : {}),
        trust: null,
        has_secret_location: false,
        gallery: [],
        availability: [],
      }),
    },
  })
}

afterEach(() => vi.useRealTimers())

describe('página pública → JSON-LD', () => {
  it('con la migración: artistas, validFrom desde la creación de la entrada y organizer.url con la web de la productora', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-20T12:00:00-03:00'))
    seed({
      event: { created_at: '2026-10-01T10:00:00Z', performers: [{ name: 'Niebla Norte', type: 'group' }, 'Ana Tijoux', { name: '' }] },
      ticket: { created_at: '2026-10-02T10:00:00Z' },
      site: { slug: 'sello-sur', custom_domain: null, domain_status: 'none' },
    })
    const { eventData } = await getPublicEventData('tocata')
    expect(eventData.performers).toEqual([{ name: 'Niebla Norte', type: 'group' }, { name: 'Ana Tijoux', type: 'person' }])
    expect(eventData.tickets[0].valid_from).toBe('2026-10-02T10:00:00Z')
    expect(eventData.organization).toMatchObject({
      website: 'https://sellosur.cl/',
      url: 'https://sellosur.cl/',
      same_as: ['https://aitickets.cl/o/sello-sur', 'https://www.instagram.com/sellosur'],
    })

    const data = buildEventJsonLd(eventData, CTX)
    expect(data.performer).toEqual([{ '@type': 'PerformingGroup', name: 'Niebla Norte' }, { '@type': 'Person', name: 'Ana Tijoux' }])
    expect(data.offers[0].validFrom).toBe('2026-10-02T10:00:00.000Z')
    expect(data.organizer).toMatchObject({ url: 'https://sellosur.cl/', sameAs: ['https://aitickets.cl/o/sello-sur', 'https://www.instagram.com/sellosur'] })
  })

  it('sin web: organizer.url es el sitio de la productora en AI Tickets (su dominio propio si lo tiene)', async () => {
    seed({ org: { public_name: 'Sello Sur', website: null, instagram: null }, site: { slug: 'sello-sur', custom_domain: 'entradas.sellosur.cl', domain_status: 'active' } })
    const { eventData } = await getPublicEventData('tocata')
    expect(eventData.organization.url).toBe('https://entradas.sellosur.cl')
    expect(buildEventJsonLd(eventData, CTX).organizer).toEqual({ '@type': 'Organization', name: 'Sello Sur', url: 'https://entradas.sellosur.cl' })
  })

  it('función anterior a la migración (sin site, performers ni created_at): Instagram como url y sin performer', async () => {
    seed({ org: { public_name: 'Sello Sur', website: null, instagram: 'sellosur' } })
    const { eventData } = await getPublicEventData('tocata')
    expect(eventData.performers).toEqual([])
    expect(eventData.tickets[0].valid_from).toBeNull()
    const data = buildEventJsonLd(eventData, CTX)
    expect(data.organizer.url).toBe('https://www.instagram.com/sellosur')
    expect(data).not.toHaveProperty('performer')
    expect(data.offers[0]).not.toHaveProperty('validFrom')
  })
})
