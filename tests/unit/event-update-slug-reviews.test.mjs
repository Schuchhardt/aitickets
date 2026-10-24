// /api/events/update desde el formulario de edición: link público (slug) y toggle de reseñas al final.
// Las funciones, recintos y entradas se prueban en otros tests: aquí van vacíos.
import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
const session = { dbUser: { id: 1, organization_id: 7, role: 'producer', name: 'Ana' } }

vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))
vi.mock('../../src/lib/supabaseServer', () => ({
  EVENT_MANAGER_ROLES: ['admin', 'producer', 'editor'],
  getSessionContext: async () => session,
  hasRole: (u, roles) => roles.includes(u?.role),
  jsonResponse: (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  getOwnedEvent: async (eventId, orgId) => (db.tables.events || []).find((e) => String(e.id) === String(eventId) && e.organization_id === orgId) || null,
}))
vi.mock('../../src/lib/orgVenues', () => ({ listOrgVenues: async () => ({ venues: [], hasOrgColumn: true }), isVenueAllowed: () => true, insertOrgVenue: async () => 'v1' }))
vi.mock('../../src/pages/api/_lib/eventSchedule', () => ({ loadSchedule: async () => ({ locations: [], dates: [] }), describeScheduleChange: () => null }))
vi.mock('../../src/pages/api/_lib/events', async (importOriginal) => ({
  ...(await importOriginal()),
  syncEventCategory: async () => {},
  refreshEventDenorm: async () => {},
  saveCoverSettings: async () => {},
  savePageSettings: async () => {},
}))

const { POST } = await import('../../src/pages/api/events/update.ts')

function seed({ status = 'published', review_settings = null } = {}) {
  db = createFakeSupabase({
    tables: {
      events: [
        { id: 10, name: 'Fiesta', slug: 'fiesta', status, accessibility: 'public', organization_id: 7, review_settings },
        { id: 11, name: 'Otra', slug: 'ocupado', status: 'published', organization_id: 7 },
      ],
      aitickets_event_slug_redirects: [],
      event_orders: [],
      event_attendees: [],
      aitickets_guests: [],
      event_tickets: [],
    },
  })
}

const save = (general, extra = {}) => POST({
  request: new Request('https://example.test/api/events/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId: 10, general: { name: 'Fiesta grande', description: '<p>Una fiesta muy buena</p>', ...general }, locations: [], tickets: [], ...extra }),
  }),
})

describe('/api/events/update: link público', () => {
  it('cambia el slug (normalizado) y, publicado, deja el anterior redirigiendo', async () => {
    seed()
    const res = await save({ slug: 'Fiesta Grande 2030' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ slug: 'fiesta-grande-2030', slug_redirect_created: true })
    expect(db.tables.events[0]).toMatchObject({ slug: 'fiesta-grande-2030', name: 'Fiesta grande' })
    expect(db.tables.aitickets_event_slug_redirects).toEqual([expect.objectContaining({ old_slug: 'fiesta', event_id: 10, organization_id: 7 })])
  })

  it('slug ocupado: 409 con field "slug" y no guarda nada más', async () => {
    seed()
    const res = await save({ slug: 'ocupado' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ field: 'slug' })
    expect(db.tables.events[0]).toMatchObject({ slug: 'fiesta', name: 'Fiesta' })
  })

  it('slug inválido: 400; sin slug en el formulario no se toca', async () => {
    seed()
    expect((await save({ slug: 'ab' })).status).toBe(400)
    const res = await save({})
    expect(res.status).toBe(200)
    expect(db.tables.events[0].slug).toBe('fiesta')
  })
})

describe('/api/events/update: toggle de reseñas', () => {
  it('desactiva el correo de reseñas sin perder el premio ni la moderación', async () => {
    seed({ review_settings: { enabled: true, reward: { value: 15, valid_days: 30 }, moderate_photos: true } })
    expect((await save({}, { reviewsEnabled: false })).status).toBe(200)
    expect(db.tables.events[0].review_settings).toEqual({ enabled: false, reward: { value: 15, valid_days: 30 }, moderate_photos: true })
  })

  it('sin cambios (activado por defecto) no escribe review_settings', async () => {
    seed()
    expect((await save({}, { reviewsEnabled: true })).status).toBe(200)
    expect(db.tables.events[0].review_settings).toBeNull()
  })
})
