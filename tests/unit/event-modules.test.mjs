// Módulos del detalle del evento en el panel (src/lib/eventModules.ts): perfil por categoría, fase, condiciones,
// lo que el productor activa a mano y pestañas visibles.
import { describe, expect, it } from 'vitest'

const { eventProfile, eventPhase, normalizeAddedModules, resolveModules, panelTabs, defaultTab, isAddableModule } = await import('../../src/lib/eventModules.ts')

const ctx = (over = {}) => ({ profile: 'general', status: 'published', functionCount: 1, ticketTypeCount: 1, phase: 'before', waitlistCount: 0, hasAttendees: true, isMassive: false, ...over })
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
  it('los permisos solo vienen en eventos masivos o con documentos exigidos; si no, quedan para agregar', () => {
    expect(byId(resolveModules(ctx({ profile: 'noche', isMassive: true }))).documents.enabled).toBe(true)
    expect(byId(resolveModules(ctx({ profile: 'noche' }))).documents).toMatchObject({ enabled: false, suggested: false })
  })
  it('un borrador que nunca tuvo asistentes no muestra mensajes ni reseñas', () => {
    const neverSold = byId(resolveModules(ctx({ status: 'draft', phase: 'after', hasAttendees: false })))
    expect(neverSold.community).toBeUndefined()
    expect(neverSold.reviews).toBeUndefined()
    expect(byId(resolveModules(ctx({ status: 'draft', phase: 'after' }))).reviews.enabled).toBe(true)
  })
  it('la lista de espera aparece solo si alguien se anotó', () => {
    expect(byId(resolveModules(ctx())).waitlist).toBeUndefined()
    expect(byId(resolveModules(ctx({ waitlistCount: 3 }))).waitlist).toMatchObject({ tab: 'ventas', enabled: true })
  })
  it('las reseñas solo aparecen cuando el evento terminó', () => {
    expect(byId(resolveModules(ctx()))['reviews']).toBeUndefined()
    expect(byId(resolveModules(ctx({ phase: 'during' })))['reviews']).toBeUndefined()
    expect(byId(resolveModules(ctx({ phase: 'after' }))).reviews.enabled).toBe(true)
  })
  it('lo agregado desde Más herramientas se suma a lo del tipo de evento', () => {
    expect(byId(resolveModules(ctx({ profile: 'funciones' }), ['documents'])).documents).toMatchObject({ enabled: true, suggested: false })
  })
  it('solo se pueden agregar módulos opcionales que existen', () => {
    expect(isAddableModule('tickets')).toBe(false)
    expect(isAddableModule('documents')).toBe(true)
    expect(isAddableModule('no-existe')).toBe(false)
  })
  it('la serie de Instagram solo aplica publicado y antes del evento', () => {
    expect(byId(resolveModules(ctx({ status: 'draft' })))['social-series']).toBeUndefined()
    expect(byId(resolveModules(ctx({ phase: 'after' })))['social-series']).toBeUndefined()
    expect(byId(resolveModules(ctx()))['social-series'].enabled).toBe(true)
  })
  it('en borrador se comparte con vista previa; publicado, con el link público y los de seguimiento', () => {
    const published = byId(resolveModules(ctx()))
    expect(published['preview-links']).toBeUndefined()
    expect(published['public-link'].enabled).toBe(true)
    expect(published['tracking-links'].enabled).toBe(true)
    const draft = byId(resolveModules(ctx({ status: 'draft' })))
    expect(draft['preview-links'].enabled).toBe(true)
    expect(draft['public-link']).toBeUndefined()
    expect(draft['tracking-links']).toBeUndefined()
  })
  it('los atajos a posts y anuncios solo aplican con el evento a la venta', () => {
    expect(byId(resolveModules(ctx({ status: 'draft' }))).promote).toBeUndefined()
    expect(byId(resolveModules(ctx({ phase: 'after' }))).promote).toBeUndefined()
    expect(byId(resolveModules(ctx())).promote).toMatchObject({ tab: 'difusion', enabled: true })
  })
})

describe('normalizeAddedModules', () => {
  it('deja solo ids opcionales conocidos, sin repetir y en el orden del registro', () => {
    expect(normalizeAddedModules(['gallery', 'tickets', 'x', 'documents', 'gallery'])).toEqual(['gallery', 'documents'])
    expect(normalizeAddedModules(null)).toEqual([])
    expect(normalizeAddedModules({ documents: true })).toEqual([])
  })
})

describe('pestañas', () => {
  it('omite pestañas sin módulos y abre ventas antes y asistentes después', () => {
    const tabs = panelTabs(resolveModules(ctx()))
    expect(tabs.map((t) => t.id)).toEqual(['ventas', 'difusion', 'pagina', 'despues'])
    expect(defaultTab(ctx(), tabs)).toBe('ventas')
    expect(defaultTab(ctx({ phase: 'after' }), tabs)).toBe('despues')
  })
  it('cada pestaña trae también las herramientas que no vienen para el tipo de evento (para Más herramientas)', () => {
    const page = panelTabs(resolveModules(ctx({ profile: 'funciones' }))).find((t) => t.id === 'pagina')
    expect(page.modules.map((m) => [m.id, m.enabled])).toEqual([['cover', true], ['faq', true], ['gallery', true], ['documents', false]])
  })
})
