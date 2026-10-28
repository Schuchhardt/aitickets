// Reseñas mientras quedan fechas (ítem 12): una obra con funciones pasadas reseñadas y funciones futuras a la venta
// muestra las reseñas y el botón de compra si la productora lo activó (review_settings.show_while_on_sale). Sin red
// ni BD: la página pública (getPublicEventData), el módulo del panel y update_review_settings.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { normalizeReviewSettings } from '../../netlify/lib/reviews.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))

const { getPublicEventData } = await import('../../src/lib/eventPage.ts')
const { resolveModules } = await import('../../src/lib/eventModules.ts')
const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { reviewTools } = await import('../../src/lib/producer-api/tools/reviews.ts')

const at = (iso) => new Date(`${iso}-03:00`)
// Obra: viernes 6 (pasó), viernes 13 y 20 de noviembre de 2026 (a la venta), 20:00
const DATES = ['2026-11-06', '2026-11-13', '2026-11-20'].map((date, i) => ({ id: 501 + i, event_id: 10, date, start_time: '20:00:00', end_time: '22:00:00', event_locations: null }))

function seed({ settings = { show_while_on_sale: true }, reviews = true } = {}) {
  db = createFakeSupabase({
    tables: {
      events: [{ id: 10, organization_id: 7, review_settings: settings }],
      aitickets_event_reviews: reviews
        ? [
            { id: 'r1', event_id: 10, rating: 5, display_name: 'Ana R.', public_comment: '¡Qué obra!', public_status: 'visible', created_at: '2026-11-07T12:00:00Z' },
            { id: 'r2', event_id: 10, rating: 4, display_name: 'Beto S.', public_comment: null, public_status: 'visible', created_at: '2026-11-07T13:00:00Z' },
          ]
        : [],
      aitickets_event_review_photos: [],
      aitickets_api_audit: [],
    },
    rpc: {
      aitickets_public_event_page: () => ({
        event: { id: 10, slug: 'obra', name: 'La obra', title: 'La obra', status: 'published', accessibility: 'public', organization_id: 7, location: 'Sala, Santiago', image_url: null, description: 'Obra' },
        categories: [],
        tickets: [502, 503].map((fn, i) => ({ id: 100 + i, ticket_name: 'General', price: 8000, total_quantity: null, status: 'available', is_gift: false, init_date: null, end_date: null, event_date_id: fn })),
        faqs: [],
        dates: DATES,
        org: null,
        trust: null,
        has_secret_location: false,
        gallery: [],
        availability: [],
      }),
    },
  })
}

afterEach(() => vi.useRealTimers())

describe('configuración', () => {
  it('por defecto las reseñas esperan a que termine el evento', () => {
    expect(normalizeReviewSettings(null).show_while_on_sale).toBe(false)
    expect(normalizeReviewSettings({ show_while_on_sale: true }).show_while_on_sale).toBe(true)
  })

  it('update_review_settings la activa sin tocar lo demás', async () => {
    seed({ settings: { enabled: true, moderate_photos: true } })
    const ctx = {
      supabase: db,
      actor: { keyId: 'k', userId: 1, orgId: 7, role: 'admin', name: 'Ana', email: 'a@p.cl', scopes: ['read', 'write'], eventIds: null },
      origin: 'https://aitickets.test',
      requestUrl: new URL('https://aitickets.test/api/mcp'),
      channel: 'mcp',
    }
    const res = await runTool(reviewTools.find((t) => t.name === 'update_review_settings'), { event_id: 10, show_while_on_sale: true }, ctx)
    expect(res.result.settings).toEqual({ enabled: true, reward: null, moderate_photos: true, show_while_on_sale: true })
  })

  it('el panel ofrece las reseñas mientras quedan funciones', () => {
    const base = { profile: 'funciones', status: 'published', ticketTypeCount: 2, waitlistCount: 0, hasAttendees: true, isMassive: false }
    const has = (ctx) => resolveModules(ctx).some((m) => m.id === 'reviews')
    expect(has({ ...base, phase: 'during', functionCount: 3 })).toBe(true)
    expect(has({ ...base, phase: 'during', functionCount: 1 })).toBe(false)
    expect(has({ ...base, phase: 'after', functionCount: 1 })).toBe(true)
  })
})

describe('la página de la obra en cartelera', () => {
  it('muestra las reseñas de las funciones pasadas y sigue a la venta', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(at('2026-11-09T12:00:00'))
    seed()
    const { eventData } = await getPublicEventData('obra')
    expect(eventData.sale_state).toBe('on_sale')
    expect(eventData.tickets).toHaveLength(2)
    expect(eventData.reviews_during_run).toBe(true)
    expect(eventData.reviews.summary).toMatchObject({ count: 2, average: 4.5 })
  })

  it('sin activarlo, o sin funciones pasadas, no las muestra', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(at('2026-11-09T12:00:00'))
    seed({ settings: { enabled: true } })
    expect((await getPublicEventData('obra')).eventData).toMatchObject({ reviews: null, reviews_during_run: false })

    vi.setSystemTime(at('2026-11-01T12:00:00'))
    seed()
    expect((await getPublicEventData('obra')).eventData).toMatchObject({ reviews: null, reviews_during_run: false })
  })

  it('activado pero todavía sin reseñas: no muestra la sección vacía', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(at('2026-11-09T12:00:00'))
    seed({ reviews: false })
    expect((await getPublicEventData('obra')).eventData.reviews_during_run).toBe(false)
  })
})
