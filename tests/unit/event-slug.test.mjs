// Cambio de slug de un evento (update_event con slug) y redirects del slug anterior cuando ya hay registrados.
// Sin red ni BD: Supabase falso en memoria.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))

const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { getTool } = await import('../../src/lib/producer-api/tools/index.ts')
const { resolveEventSlugRedirect, normalizeSlug, slugRedirectResponse } = await import('../../src/lib/eventSlug.ts')

beforeEach(() => {
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Mi Productora' }, { id: 8, public_name: 'Otra' }],
      events: [
        { id: 10, name: 'Fiesta', slug: 'fiesta-1234', status: 'published', accessibility: 'public', organization_id: 7 },
        { id: 11, name: 'Otra fiesta', slug: 'otra-fiesta-1', status: 'draft', accessibility: 'public', organization_id: 7 },
        { id: 20, name: 'Ajeno', slug: 'ajeno-1', status: 'published', organization_id: 8 },
      ],
      event_dates: [],
      event_attendees: [],
      event_orders: [],
      aitickets_guests: [],
      aitickets_event_slug_redirects: [],
      aitickets_api_audit: [],
    },
  })
})

const ctx = () => ({
  supabase: db,
  actor: { keyId: 'k1', userId: 1, orgId: 7, role: 'producer', name: 'Ana', email: 'ana@prod.cl', scopes: ['read', 'write', 'publish'] },
  origin: 'https://aitickets.cl',
  requestUrl: new URL('https://aitickets.cl/api/mcp'),
  channel: 'mcp',
})
const run = (args) => runTool(getTool('update_event'), args, ctx())
const slugOf = (id) => db.tables.events.find((e) => e.id === id).slug

describe('update_event: slug', () => {
  it('sin registrados cambia el slug y no deja redirect', async () => {
    const res = await run({ event_id: 10, slug: 'fiesta-verano-2026' })
    expect(res.ok).toBe(true)
    expect(slugOf(10)).toBe('fiesta-verano-2026')
    expect(res.result).toMatchObject({
      updated: ['slug'],
      public_url: 'https://aitickets.cl/eventos/fiesta-verano-2026',
      slug_change: { changed: true, old_slug: 'fiesta-1234', new_slug: 'fiesta-verano-2026', redirect_created: false },
    })
    expect(db.tables.aitickets_event_slug_redirects).toHaveLength(0)
  })

  it('normaliza tildes, espacios y mayúsculas', async () => {
    expect(normalizeSlug('  Año Nuevo  Ñuñoa 2027! ')).toBe('ano-nuevo-nunoa-2027')
    await run({ event_id: 10, slug: 'Año Nuevo 2027' })
    expect(slugOf(10)).toBe('ano-nuevo-2027')
  })

  it('con registrados deja el slug anterior redirigiendo al nuevo', async () => {
    db.tables.event_orders.push({ id: 'o1', event_id: 10, status: 'paid', amount: 10000 })
    const res = await run({ event_id: 10, slug: 'fiesta-verano' })
    expect(res.result.slug_change).toMatchObject({ redirect_created: true, old_url: 'https://aitickets.cl/eventos/fiesta-1234' })
    expect(db.tables.aitickets_event_slug_redirects).toEqual([expect.objectContaining({ old_slug: 'fiesta-1234', event_id: 10, organization_id: 7, created_by_user_id: 1 })])
    expect(await resolveEventSlugRedirect('fiesta-1234')).toBe('fiesta-verano')
    expect(await resolveEventSlugRedirect('fiesta-1234', { organizationId: 8 })).toBeNull()
    expect(await resolveEventSlugRedirect('no-existe')).toBeNull()
  })

  it('invitados o entradas emitidas también cuentan como registrados', async () => {
    db.tables.aitickets_guests.push({ id: 'g1', event_id: 10 })
    await run({ event_id: 10, slug: 'con-invitados' })
    expect(db.tables.aitickets_event_slug_redirects).toHaveLength(1)
  })

  it('una cadena de cambios redirige siempre al slug vigente y volver atrás libera el redirect', async () => {
    db.tables.event_attendees.push({ id: 1, event_id: 10 })
    await run({ event_id: 10, slug: 'paso-b' })
    await run({ event_id: 10, slug: 'paso-c' })
    expect(await resolveEventSlugRedirect('fiesta-1234')).toBe('paso-c')
    expect(await resolveEventSlugRedirect('paso-b')).toBe('paso-c')

    await run({ event_id: 10, slug: 'fiesta-1234' })
    expect(slugOf(10)).toBe('fiesta-1234')
    expect(db.tables.aitickets_event_slug_redirects.map((r) => r.old_slug).sort()).toEqual(['paso-b', 'paso-c'])
    expect(await resolveEventSlugRedirect('fiesta-1234')).toBeNull()
    expect(await resolveEventSlugRedirect('paso-c')).toBe('fiesta-1234')
  })

  it('no permite tomar el slug de otro evento ni el link anterior de otro evento', async () => {
    expect(await run({ event_id: 10, slug: 'ajeno-1' })).toMatchObject({ ok: false, code: 'conflict' })
    expect(await run({ event_id: 10, slug: 'otra-fiesta-1' })).toMatchObject({ ok: false, code: 'conflict' })
    db.tables.aitickets_event_slug_redirects.push({ old_slug: 'link-viejo', event_id: 20, organization_id: 8 })
    expect(await run({ event_id: 10, slug: 'link-viejo', name: 'Nombre nuevo' })).toMatchObject({ ok: false, code: 'conflict' })
    // Nada se aplicó (el slug se valida antes que el resto)
    expect(db.tables.events.find((e) => e.id === 10)).toMatchObject({ slug: 'fiesta-1234', name: 'Fiesta' })
  })

  it('rechaza slugs inválidos o reservados', async () => {
    expect(await run({ event_id: 10, slug: '---' })).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(await run({ event_id: 10, slug: 'vista-previa' })).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(slugOf(10)).toBe('fiesta-1234')
  })

  it('el mismo slug no cambia nada', async () => {
    const res = await run({ event_id: 10, slug: 'fiesta-1234' })
    expect(res.result.slug_change).toMatchObject({ changed: false })
    expect(res.result.updated).toEqual([])
  })

  it('no cambia eventos de otra organización', async () => {
    expect(await run({ event_id: 20, slug: 'hackeado' })).toMatchObject({ ok: false, code: 'not_found' })
    expect(slugOf(20)).toBe('ajeno-1')
  })

  it('sin la tabla de redirects (BD sin migrar) rechaza el cambio si hay registrados', async () => {
    db.tables.event_orders.push({ id: 'o1', event_id: 10, status: 'paid', amount: 10000 })
    db.failOn('aitickets_event_slug_redirects', 'select', { code: '42P01', message: 'relation "aitickets_event_slug_redirects" does not exist' })
    expect(await run({ event_id: 10, slug: 'nuevo-link' })).toMatchObject({ ok: false, code: 'conflict' })
    expect(slugOf(10)).toBe('fiesta-1234')
    expect(await resolveEventSlugRedirect('fiesta-1234')).toBeNull()
  })

  it('el redirect es 301 con caché acotado', () => {
    const res = slugRedirectResponse('/eventos/nuevo?utm_source=ig')
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/eventos/nuevo?utm_source=ig')
    expect(res.headers.get('cache-control')).toMatch(/max-age=3600/)
  })
})
