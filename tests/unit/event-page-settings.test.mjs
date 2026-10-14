// Diseño de la página pública del evento (events.page_settings): normalización y update_event / get_event del MCP.
// Sin red ni BD: Supabase falso en memoria.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))

const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { getTool } = await import('../../src/lib/producer-api/tools/index.ts')
const { normalizePageSettings, isDefaultPageSettings, stripDemoSuffix } = await import('../../src/lib/eventPageSettings.ts')

beforeEach(() => {
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Mi Productora' }, { id: 8, public_name: 'Otra' }],
      events: [
        { id: 10, name: 'Fiesta', slug: 'fiesta-1234', status: 'draft', accessibility: 'public', organization_id: 7, page_settings: null },
        { id: 20, name: 'Ajeno', slug: 'ajeno-1', status: 'published', organization_id: 8, page_settings: null },
      ],
      event_dates: [],
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
const settingsOf = (id) => db.tables.events.find((e) => e.id === id).page_settings

describe('normalizePageSettings', () => {
  it('NULL o valores inválidos => por defecto (póster, organizador visible)', () => {
    expect(normalizePageSettings(null)).toEqual({ layout: "poster", show_organizer: true, background: "none" })
    expect(normalizePageSettings({ layout: 'carrusel', show_organizer: 'no' })).toEqual({ layout: 'poster', show_organizer: true, background: 'none' })
    expect(normalizePageSettings({ layout: 'banner', show_organizer: false, background: 'lime' })).toEqual({ layout: 'banner', show_organizer: false, background: 'lime' })
    expect(normalizePageSettings({ background: 'neon' }).background).toBe('none')
  })
  it('detecta los valores por defecto', () => {
    expect(isDefaultPageSettings({ layout: 'poster', show_organizer: true })).toBe(true)
    expect(isDefaultPageSettings({ layout: 'compact', show_organizer: true })).toBe(false)
  })
  it('quita el sufijo de los eventos demo', () => {
    expect(stripDemoSuffix('Noche de Stand-up (evento de demostración)')).toBe('Noche de Stand-up')
    expect(stripDemoSuffix('Fiesta')).toBe('Fiesta')
  })
})

describe('update_event: diseño de la página', () => {
  it('cambia el diseño y oculta el organizador', async () => {
    const res = await run({ event_id: 10, page_layout: 'banner', show_organizer: false })
    expect(res.ok).toBe(true)
    expect(res.result).toMatchObject({ updated: ['page_layout', 'show_organizer'], page_layout: 'banner', show_organizer: false })
    expect(settingsOf(10)).toEqual({ layout: 'banner', show_organizer: false, background: 'none' })
  })

  it('combina con lo guardado: cambiar solo el organizador mantiene el diseño', async () => {
    await run({ event_id: 10, page_layout: 'compact' })
    await run({ event_id: 10, show_organizer: false })
    expect(settingsOf(10)).toEqual({ layout: 'compact', show_organizer: false, background: 'none' })
  })

  it('volver a los valores por defecto guarda NULL', async () => {
    await run({ event_id: 10, page_layout: 'banner' })
    await run({ event_id: 10, page_layout: 'poster' })
    expect(settingsOf(10)).toBeNull()
  })

  it('cambia el fondo sin tocar el diseño', async () => {
    await run({ event_id: 10, page_layout: 'banner' })
    const res = await run({ event_id: 10, page_background: 'lavender' })
    expect(res.result).toMatchObject({ updated: ['page_background'], page_layout: 'banner', page_background: 'lavender' })
    expect(settingsOf(10)).toEqual({ layout: 'banner', show_organizer: true, background: 'lavender' })
    expect(await run({ event_id: 10, page_background: 'neon' })).toMatchObject({ ok: false, code: 'invalid_input' })
  })

  it('rechaza un diseño desconocido', async () => {
    expect(await run({ event_id: 10, page_layout: 'carrusel' })).toMatchObject({ ok: false, code: 'invalid_input' })
  })

  it('no toca eventos de otra organización', async () => {
    expect(await run({ event_id: 20, page_layout: 'banner' })).toMatchObject({ ok: false, code: 'not_found' })
    expect(settingsOf(20)).toBeNull()
  })
})
