// JSON-LD de la página del evento (src/lib/eventJsonLd.ts) y artistas (src/lib/eventPerformers.mjs). Search Console
// marcaba como faltantes tres campos recomendados de los resultados enriquecidos de eventos:
//   - offers[].validFrom: desde cuándo se vende la entrada
//   - organizer.url: la web de la productora (o su sitio en AI Tickets, o su Instagram)
//   - performer: los artistas del evento (o los expositores de la agenda); nunca inventados
import { describe, expect, it } from 'vitest'

import { buildEventJsonLd, buildOffers, buildOrganizer, buildPerformers, serializeJsonLd } from '../../src/lib/eventJsonLd.ts'
import { MAX_PERFORMERS, normalizePerformers, performerJsonLd, performersForDb, performersFromAgenda } from '../../src/lib/eventPerformers.mjs'
import { normalizeWebsiteUrl, socialProfileUrl } from '../../src/lib/siteTemplates.ts'

const CTX = {
  siteUrl: 'https://aitickets.cl',
  canonicalUrl: 'https://aitickets.cl/eventos/festival',
  images: ['https://cdn.test/portada.jpg'],
  fallbackDescription: 'Festival en Santiago.',
  brand: 'AI Tickets',
  supportEmail: 'soporte@aitickets.cl',
}

const event = (overrides = {}) => ({
  id: 1,
  name: 'Festival',
  description: '<p>Música en vivo</p>',
  created_at: '2026-09-01T10:00:00.000Z',
  location: 'Teatro Caupolicán, Santiago',
  dates: [{ start_iso: '2026-12-01T21:00:00-03:00', end_iso: '2026-12-02T00:00:00-03:00', venue: { name: 'Teatro Caupolicán', city: 'Santiago' } }],
  tickets: [{ ticket_name: 'General', price: 15000, remaining: null, init_date: null, valid_from: '2026-09-02T10:00:00.000Z' }],
  sale_state: 'on_sale',
  organization: { name: 'Productora X', url: 'https://productora.cl/', same_as: ['https://www.instagram.com/productorax'] },
  performers: [],
  agenda: [],
  ...overrides,
})

describe('normalizePerformers', () => {
  it('acepta objetos o nombres, limpia espacios, descarta vacíos y repetidos y por defecto es persona', () => {
    expect(normalizePerformers([' Ana  Tijoux ', { name: 'Los Bunkers', type: 'group' }, { name: 'ana tijoux' }, '', { name: '  ' }, { name: 'DJ X', type: 'otro' }])).toEqual([
      { name: 'Ana Tijoux', type: 'person' },
      { name: 'Los Bunkers', type: 'group' },
      { name: 'DJ X', type: 'person' },
    ])
  })

  it('cualquier cosa que no sea una lista es [] y se guarda null sin artistas', () => {
    for (const raw of [null, undefined, 'Ana', { name: 'Ana' }, 3]) expect(normalizePerformers(raw)).toEqual([])
    expect(performersForDb([])).toBeNull()
    expect(performersForDb(['Ana'])).toEqual([{ name: 'Ana', type: 'person' }])
  })

  it(`se queda con los primeros ${MAX_PERFORMERS} y recorta nombres largos`, () => {
    const many = Array.from({ length: MAX_PERFORMERS + 5 }, (_, i) => `Artista ${i}`)
    expect(normalizePerformers(many)).toHaveLength(MAX_PERFORMERS)
    expect(normalizePerformers(['x'.repeat(300)])[0].name).toHaveLength(100)
  })

  it('performer del JSON-LD: Person o PerformingGroup', () => {
    expect(performerJsonLd([{ name: 'Ana', type: 'person' }, { name: 'Coro', type: 'group' }])).toEqual([
      { '@type': 'Person', name: 'Ana' },
      { '@type': 'PerformingGroup', name: 'Coro' },
    ])
  })
})

describe('performersFromAgenda (expositores de seminarios y congresos)', () => {
  it('separa por coma, punto y coma, "·" y " / " y quita la empresa entre paréntesis', () => {
    const agenda = [
      { blocks: [{ speakers: 'Ana Pérez (Empresa X), Juan Soto' }, { speakers: null }] },
      { blocks: [{ speakers: 'María Díaz; Juan Soto · Pedro Rojas / Laura Muñoz (CEO, Startup)' }] },
    ]
    expect(performersFromAgenda(agenda).map((p) => p.name)).toEqual(['Ana Pérez', 'Juan Soto', 'María Díaz', 'Pedro Rojas', 'Laura Muñoz'])
  })

  it('sin agenda o sin expositores: []', () => {
    expect(performersFromAgenda(undefined)).toEqual([])
    expect(performersFromAgenda([{ blocks: [{ title: 'Bienvenida' }] }])).toEqual([])
  })
})

describe('offers[].validFrom', () => {
  it('usa la apertura de la tanda; si no tiene, cuándo se creó la entrada; si tampoco, cuándo se creó el evento', () => {
    const offers = buildOffers(
      event({
        tickets: [
          { ticket_name: 'Preventa', price: 10000, init_date: '2026-09-10T15:00:00Z', valid_from: '2026-09-10T15:00:00Z' },
          { ticket_name: 'General', price: 15000, init_date: null, valid_from: '2026-09-02T10:00:00.000Z' },
          { ticket_name: 'VIP', price: 30000 },
        ],
      }),
      CTX.canonicalUrl
    )
    expect(offers.map((o) => o.validFrom)).toEqual(['2026-09-10T15:00:00.000Z', '2026-09-02T10:00:00.000Z', '2026-09-01T10:00:00.000Z'])
  })

  it('evento agotado: la oferta SoldOut también lleva validFrom', () => {
    const [offer] = buildOffers(event({ tickets: [], sale_state: 'sold_out' }), CTX.canonicalUrl)
    expect(offer).toMatchObject({ availability: 'https://schema.org/SoldOut', validFrom: '2026-09-01T10:00:00.000Z' })
  })

  it('sin entradas a la venta ni agotado: sin offers (nunca un precio inventado)', () => {
    expect(buildOffers(event({ tickets: [], sale_state: 'closed' }), CTX.canonicalUrl)).toBeNull()
  })

  it('sin ninguna fecha conocida no inventa validFrom', () => {
    const [offer] = buildOffers(event({ created_at: undefined, tickets: [{ ticket_name: 'General', price: 0 }] }), CTX.canonicalUrl)
    expect(offer).not.toHaveProperty('validFrom')
  })
})

describe('organizer', () => {
  it('lleva url y sameAs de la productora (sin repetir la url en sameAs)', () => {
    const org = buildOrganizer(event({ organization: { name: 'P', url: 'https://p.cl/', same_as: ['https://p.cl/', 'https://www.instagram.com/p'] } }), CTX)
    expect(org).toEqual({ '@type': 'Organization', name: 'P', url: 'https://p.cl/', sameAs: ['https://www.instagram.com/p'] })
  })

  it('datos anteriores sin url: usa website', () => {
    expect(buildOrganizer(event({ organization: { name: 'P', website: 'https://p.cl/' } }), CTX)).toMatchObject({ url: 'https://p.cl/' })
  })

  it('evento sin organización: AI Tickets con su url y contacto', () => {
    expect(buildOrganizer(event({ organization: null }), CTX)).toMatchObject({ name: 'AI Tickets', url: 'https://aitickets.cl' })
  })
})

describe('buildEventJsonLd', () => {
  it('con artistas: performer, offers con validFrom y organizer con url', () => {
    const data = buildEventJsonLd(event({ performers: [{ name: 'Ana Tijoux', type: 'person' }] }), CTX)
    expect(data).toMatchObject({
      '@type': 'Event',
      name: 'Festival',
      startDate: '2026-12-01T21:00:00-03:00',
      performer: { '@type': 'Person', name: 'Ana Tijoux' },
      organizer: { url: 'https://productora.cl/' },
      offers: [{ validFrom: '2026-09-02T10:00:00.000Z', priceCurrency: 'CLP' }],
    })
  })

  it('sin artistas usa los expositores de la agenda; sin ninguno, no hay performer', () => {
    const fromAgenda = buildEventJsonLd(event({ agenda: [{ blocks: [{ speakers: 'Ana Pérez (X), Juan Soto' }] }] }), CTX)
    expect(fromAgenda.performer).toEqual([{ '@type': 'Person', name: 'Ana Pérez' }, { '@type': 'Person', name: 'Juan Soto' }])
    expect(buildEventJsonLd(event(), CTX)).not.toHaveProperty('performer')
    expect(buildPerformers(event())).toEqual([])
  })

  it('una entrada por función, todas con el mismo performer', () => {
    const data = buildEventJsonLd(
      event({
        performers: ['Ana'],
        dates: [
          { start_iso: '2026-12-01T21:00:00-03:00', venue: null },
          { start_iso: '2026-12-02T21:00:00-03:00', venue: null },
        ],
      }),
      CTX
    )
    expect(data).toHaveLength(2)
    expect(data.map((d) => d.performer.name)).toEqual(['Ana', 'Ana'])
  })

  it('el JSON nunca cierra el <script>', () => {
    expect(serializeJsonLd(buildEventJsonLd(event({ name: '</script><b>x' }), CTX))).not.toContain('</script>')
  })
})

describe('urls del organizador', () => {
  it('socialProfileUrl: URL tal cual o usuario con o sin @', () => {
    expect(socialProfileUrl('https://www.instagram.com/', '@productora')).toBe('https://www.instagram.com/productora')
    expect(socialProfileUrl('https://www.tiktok.com/@', 'productora')).toBe('https://www.tiktok.com/@productora')
    expect(socialProfileUrl('https://www.instagram.com/', 'https://instagram.com/p')).toBe('https://instagram.com/p')
    expect(socialProfileUrl('https://www.instagram.com/', 'no vale')).toBeUndefined()
    expect(socialProfileUrl('https://www.instagram.com/', null)).toBeUndefined()
  })

  it('normalizeWebsiteUrl sigue agregando https://', () => {
    expect(normalizeWebsiteUrl('productora.cl')).toBe('https://productora.cl/')
  })
})
