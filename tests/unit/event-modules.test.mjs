// Módulos del detalle del evento en el panel (src/lib/eventModules.ts): perfil por categoría, fase, condiciones,
// lo que el productor activa a mano y pestañas visibles.
import { describe, expect, it } from 'vitest'

const { eventProfile, eventPhase, normalizeOverrides, resolveModules, visibleTabs, defaultTab, isToggleableModule } = await import('../../src/lib/eventModules.ts')

const ctx = (over = {}) => ({ profile: 'general', status: 'published', functionCount: 1, ticketTypeCount: 1, phase: 'before', ...over })
const byId = (mods) => Object.fromEntries(mods.map((m) => [m.id, m]))

describe('eventProfile', () => {
  it.each([
    ['Teatro', 'funciones'],
    ['Comedia / Stand-up', 'funciones'],
    ['Fiesta', 'noche'],
    ['Música', 'musica'],
    ['Festival de música', 'musica'],
    ['Taller / Charla', 'formacion'],
    ['Seminario de RRHH', 'formacion'],
    ['Deportes', 'general'],
    ['', 'general'],
    [null, 'general'],
  ])('%s => %s', (cat, profile) => expect(eventProfile(cat)).toBe(profile))
})

describe('eventPhase', () => {
  const now = new Date('2026-10-27T12:00:00Z')
  it('antes, durante y después', () => {
    expect(eventPhase('2026-11-01T23:00:00Z', null, now)).toBe('before')
    expect(eventPhase('2026-10-27T10:00:00Z', '2026-10-27T15:00:00Z', now)).toBe('during')
    expect(eventPhase('2026-10-20T10:00:00Z', '2026-10-20T15:00:00Z', now)).toBe('after')
    expect(eventPhase(null, null, now)).toBe('before')
  })
  it('sin fecha de término dura el día de la función', () => {
    expect(eventPhase('2026-10-27T02:00:00Z', null, now)).toBe('during')
    expect(eventPhase('2026-10-25T02:00:00Z', null, now)).toBe('after')
  })
})

describe('resolveModules', () => {
  it('los permisos vienen activos en fiestas y apagados en teatro', () => {
    expect(byId(resolveModules(ctx({ profile: 'noche' }))).documents.enabled).toBe(true)
    const theatre = byId(resolveModules(ctx({ profile: 'funciones' }))).documents
    expect(theatre).toMatchObject({ enabled: false, suggested: false })
  })
  it('lo activado a mano gana sobre el perfil', () => {
    expect(byId(resolveModules(ctx({ profile: 'funciones' }), { documents: true })).documents.enabled).toBe(true)
    expect(byId(resolveModules(ctx(), { faq: false })).faq.enabled).toBe(false)
  })
  it('los core no se pueden apagar', () => {
    expect(byId(resolveModules(ctx(), { tickets: false })).tickets.enabled).toBe(true)
    expect(isToggleableModule('tickets')).toBe(false)
    expect(isToggleableModule('faq')).toBe(true)
    expect(isToggleableModule('no-existe')).toBe(false)
  })
  it('la serie de Instagram solo aplica publicado y antes del evento', () => {
    expect(byId(resolveModules(ctx({ status: 'draft' })))['social-series']).toBeUndefined()
    expect(byId(resolveModules(ctx({ phase: 'after' })))['social-series']).toBeUndefined()
    expect(byId(resolveModules(ctx()))['social-series'].enabled).toBe(true)
  })
  it('los atajos a posts y anuncios solo aplican con el evento a la venta', () => {
    expect(byId(resolveModules(ctx({ status: 'draft' }))).promote).toBeUndefined()
    expect(byId(resolveModules(ctx({ phase: 'after' }))).promote).toBeUndefined()
    expect(byId(resolveModules(ctx())).promote).toMatchObject({ tab: 'difusion', enabled: true })
  })
})

describe('normalizeOverrides', () => {
  it('descarta ids desconocidos, core y valores no booleanos', () => {
    expect(normalizeOverrides({ faq: false, tickets: false, x: true, gallery: 'si' })).toEqual({ faq: false })
    expect(normalizeOverrides(null)).toEqual({})
    expect(normalizeOverrides([1])).toEqual({})
  })
})

describe('pestañas', () => {
  it('omite pestañas vacías y abre ventas antes y asistentes después', () => {
    const tabs = visibleTabs(resolveModules(ctx()))
    expect(tabs.map((t) => t.id)).toEqual(['ventas', 'difusion', 'pagina', 'despues'])
    expect(defaultTab(ctx(), tabs)).toBe('ventas')
    expect(defaultTab(ctx({ phase: 'after' }), tabs)).toBe('despues')
  })
  it('si se apaga todo lo de una pestaña, desaparece', () => {
    const tabs = visibleTabs(resolveModules(ctx(), { community: false, reviews: false, gallery: false }))
    expect(tabs.map((t) => t.id)).not.toContain('despues')
    expect(defaultTab(ctx({ phase: 'after' }), tabs)).toBe('ventas')
  })
})
