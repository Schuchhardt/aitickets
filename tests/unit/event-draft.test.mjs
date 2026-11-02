// Borrador automático de "Crear evento" (/api/events/draft) y "Crear Evento" completando ese mismo borrador
// (/api/events/create con draftId): nunca quedan dos eventos.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
const session = { dbUser: { id: 1, organization_id: 7, role: 'producer', name: 'Ana' } }

vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))
vi.mock('../../src/lib/supabaseServer', () => ({
  EVENT_MANAGER_ROLES: ['admin', 'producer', 'editor'],
  getSessionContext: async () => session,
  hasRole: (u, roles) => roles.includes(u?.role),
  jsonResponse: (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))
vi.mock('../../src/lib/orgVenues', () => ({ listOrgVenues: async () => ({ venues: [{ id: 'v1', name: 'Sala', city: null }], hasOrgColumn: true }), isVenueAllowed: () => true, insertOrgVenue: async () => 'v1' }))
vi.mock('../../src/pages/api/_lib/server-utils', async (importOriginal) => ({ ...(await importOriginal()), notifySlack: async () => {} }))
vi.mock('../../src/pages/api/_lib/events', async (importOriginal) => ({
  ...(await importOriginal()),
  syncEventCategory: async () => {},
  refreshEventDenorm: async () => {},
  saveCoverSettings: async () => {},
}))

const { POST: draftPOST } = await import('../../src/pages/api/events/draft.ts')
const { POST: createPOST } = await import('../../src/pages/api/events/create.ts')
const { draftIsSavable, draftSlug } = await import('../../src/pages/api/_lib/events.ts')

const req = (body) => ({ request: new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) }) })
const call = async (handler, body) => {
  const res = await handler(req(body))
  return { status: res.status, data: await res.json() }
}

beforeEach(() => {
  db = createFakeSupabase({ tables: { events: [], event_locations: [], event_dates: [], event_tickets: [], event_tags: [] } })
})

describe('cuándo se guarda', () => {
  it('nombre de más de 3 letras y además categoría, descripción o imagen', () => {
    expect(draftIsSavable({ name: 'Cine' })).toBe(false)
    expect(draftIsSavable({ name: 'Cin', category: 'Cine' })).toBe(false)
    expect(draftIsSavable({ name: 'Ciclo de cine', description: '<p> </p>' })).toBe(false)
    expect(draftIsSavable({ name: 'Ciclo de cine', category: 'Cine' })).toBe(true)
    expect(draftIsSavable({ name: 'Ciclo de cine', description: '<p>Clásicos</p>' })).toBe(true)
    expect(draftIsSavable({ name: 'Ciclo de cine', imageUrl: 'https://x/y.jpg' })).toBe(true)
  })
  it('el slug sigue el nombre y conserva su sufijo', () => {
    expect(draftSlug('Ciclo de Cine', 'cicl-1234')).toBe('ciclo-de-cine-1234')
    expect(draftSlug('Ciclo', null)).toMatch(/^ciclo-\d{4}$/)
  })
})

describe('/api/events/draft', () => {
  it('rechaza sin datos suficientes', async () => {
    const r = await call(draftPOST, { general: { name: 'Fiesta' } })
    expect(r.status).toBe(400)
    expect(db.tables.events).toHaveLength(0)
  })

  it('crea el borrador y después lo actualiza (mismo evento)', async () => {
    const first = await call(draftPOST, { general: { name: 'Ciclo', category: 'Cine' } })
    expect(first.status).toBe(200)
    expect(db.tables.events).toHaveLength(1)
    expect(db.tables.events[0]).toMatchObject({ id: first.data.id, name: 'Ciclo', status: 'draft', organization_id: 7, created_by: 1 })
    const suffix = db.tables.events[0].slug.slice(-4)

    const second = await call(draftPOST, { draftId: first.data.id, general: { name: 'Ciclo de cine francés', category: 'Cine', description: '<p>Hola</p>', isPrivate: true } })
    expect(second.data.id).toBe(first.data.id)
    expect(db.tables.events).toHaveLength(1)
    expect(db.tables.events[0]).toMatchObject({ name: 'Ciclo de cine francés', slug: `ciclo-de-cine-frances-${suffix}`, accessibility: 'private' })
  })

  it('no toca un borrador ya completado ni uno de otra organización', async () => {
    db.tables.events.push({ id: 50, name: 'Completo', slug: 'completo-1111', status: 'draft', organization_id: 7 }, { id: 51, name: 'Ajeno', status: 'draft', organization_id: 8 })
    db.tables.event_locations.push({ id: 'l1', event_id: 50 })
    expect((await call(draftPOST, { draftId: 50, general: { name: 'Pisar', category: 'Cine' } })).status).toBe(409)
    expect((await call(draftPOST, { draftId: 51, general: { name: 'Pisar', category: 'Cine' } })).status).toBe(404)
    expect(db.tables.events.find((e) => e.id === 50).name).toBe('Completo')
  })

  it('el tipo Cortesía que crea la base no cuenta como entradas', async () => {
    const { data } = await call(draftPOST, { general: { name: 'Ciclo', category: 'Cine' } })
    db.tables.event_tickets.push({ id: 1, event_id: data.id, ticket_name: 'Cortesía', is_gift: true })
    expect((await call(draftPOST, { draftId: data.id, general: { name: 'Ciclo 2', category: 'Cine' } })).status).toBe(200)
  })
})

describe('Crear Evento con el borrador', () => {
  const full = (name) => ({
    general: { name, description: '<p>Clásicos del cine</p>', category: 'Cine' },
    locations: [{ id: 1700000000000001, venueId: 'v1', isNewVenue: false, dates: [{ id: 1700000000000002, date: '2099-01-01', startTime: '20:00', endTime: '22:00' }] }],
    tickets: [{ id: 1700000000000003, name: 'General', price: 5000, quantity: 80 }],
  })

  it('completa el borrador en vez de crear otro evento', async () => {
    const { data } = await call(draftPOST, { general: { name: 'Ciclo', category: 'Cine' } })
    const r = await call(createPOST, { ...full('Ciclo de cine'), draftId: data.id })
    expect(r.status).toBe(200)
    expect(r.data.id).toBe(data.id)
    expect(db.tables.events).toHaveLength(1)
    expect(db.tables.events[0]).toMatchObject({ name: 'Ciclo de cine', status: 'draft' })
    expect(db.tables.event_locations.filter((l) => l.event_id === data.id)).toHaveLength(1)
    expect(db.tables.event_tickets.filter((t) => t.event_id === data.id && t.ticket_name === 'General')).toHaveLength(1)
  })

  it('sin borrador crea el evento como siempre', async () => {
    const r = await call(createPOST, full('Otro evento'))
    expect(r.status).toBe(200)
    expect(db.tables.events).toHaveLength(1)
  })

  it('un borrador ya completado no se completa dos veces', async () => {
    const { data } = await call(draftPOST, { general: { name: 'Ciclo', category: 'Cine' } })
    await call(createPOST, { ...full('Ciclo'), draftId: data.id })
    const again = await call(createPOST, { ...full('Ciclo'), draftId: data.id })
    expect(again.status).toBe(409)
    expect(db.tables.event_locations).toHaveLength(1)
  })
})
