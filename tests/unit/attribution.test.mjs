// Atribución de compras (src/lib/attribution.js): último toque por evento, 7 días, localStorage + sessionStorage.
// Caso real (evento 134, serie de historias): las visitas llegaban con ?ref=ig-post-dm pero la atribución vivía solo
// en sessionStorage, así que se perdía si la persona volvía en otra pestaña o más tarde.
import { describe, expect, it } from 'vitest'
import { ATTRIBUTION_KEY, ATTRIBUTION_TTL_MS, attributionFromSearch, captureAttribution, readAttribution } from '../../src/lib/attribution.js'

class MemoryStorage {
  constructor() { this.map = new Map() }
  get length() { return this.map.size }
  key(i) { return [...this.map.keys()][i] ?? null }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null }
  setItem(k, v) { this.map.set(k, String(v)) }
  removeItem(k) { this.map.delete(k) }
}
const blocked = { get length() { throw new Error('blocked') }, key() { throw new Error('blocked') }, getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }

const T0 = Date.parse('2026-11-02T11:19:00Z')
const HOUR = 3_600_000
// Un navegador: localStorage compartido entre pestañas, sessionStorage por pestaña
const browser = () => {
  const local = new MemoryStorage()
  return { local, tab: () => ({ local, session: new MemoryStorage() }) }
}

describe('atribución: último toque por evento, 7 días', () => {
  it('lee ref y utm de la URL; sin parámetros no hay toque', () => {
    expect(attributionFromSearch('?ref=ig-story-dm', T0)).toEqual({ ref: 'ig-story-dm', utm: { source: null, medium: null, campaign: null }, landing_at: '2026-11-02T11:19:00.000Z' })
    expect(attributionFromSearch('?utm_source=ig&utm_campaign=x', T0)).toMatchObject({ ref: null, utm: { source: 'ig', campaign: 'x' } })
    expect(attributionFromSearch('?checkout=1&paso=2', T0)).toBeNull()
    expect(attributionFromSearch('', T0)).toBeNull()
  })

  it('llega por el DM y compra en otra pestaña al día siguiente: la compra lleva ig-story-dm', () => {
    const b = browser()
    captureAttribution(134, '?ref=ig-story-dm', { now: T0, storages: b.tab() })
    // Pestaña nueva, sin parámetros (volvió escribiendo la URL o desde el historial)
    const later = b.tab()
    captureAttribution(134, '', { now: T0 + 26 * HOUR, storages: later })
    expect(readAttribution(134, { now: T0 + 26 * HOUR, storages: later })).toEqual({ ref: 'ig-story-dm', utm: { source: undefined, medium: undefined, campaign: undefined } })
  })

  it('pasados 7 días el toque vence', () => {
    const b = browser()
    captureAttribution(134, '?ref=ig-post-dm', { now: T0, storages: b.tab() })
    expect(readAttribution(134, { now: T0 + ATTRIBUTION_TTL_MS - 1000, storages: b.tab() }).ref).toBe('ig-post-dm')
    expect(readAttribution(134, { now: T0 + ATTRIBUTION_TTL_MS + 1000, storages: b.tab() })).toEqual({})
  })

  it('último toque: un link nuevo con ref o utm pisa al anterior; una visita directa no', () => {
    const b = browser()
    captureAttribution(134, '?ref=ig-story-dm', { now: T0, storages: b.tab() })
    captureAttribution(134, '?utm_source=whatsapp&utm_medium=social', { now: T0 + HOUR, storages: b.tab() })
    expect(readAttribution(134, { now: T0 + 2 * HOUR, storages: b.tab() })).toMatchObject({ ref: undefined, utm: { source: 'whatsapp', medium: 'social' } })
  })

  it('por evento: el DM del evento 134 no se lleva la venta de otro evento', () => {
    const b = browser()
    const tab = b.tab()
    captureAttribution(134, '?ref=ig-story-dm', { now: T0, storages: tab })
    expect(readAttribution(999, { now: T0 + HOUR, storages: tab })).toEqual({})
    expect(readAttribution(134, { now: T0 + HOUR, storages: tab }).ref).toBe('ig-story-dm')
  })

  it('sin localStorage (bloqueado): sigue funcionando en la misma pestaña', () => {
    const session = new MemoryStorage()
    const storages = { local: blocked, session }
    captureAttribution(134, '?ref=ig-story-dm', { now: T0, storages })
    expect(readAttribution(134, { now: T0 + HOUR, storages }).ref).toBe('ig-story-dm')
  })

  it('compatible con lo guardado antes del cambio (sessionStorage sin evento ni vencimiento propio)', () => {
    const session = new MemoryStorage()
    session.setItem(ATTRIBUTION_KEY, JSON.stringify({ ref: 'rrpp-ana', utm: { source: null, medium: null, campaign: null }, landing_at: new Date(T0).toISOString() }))
    expect(readAttribution(134, { now: T0 + HOUR, storages: { local: new MemoryStorage(), session } }).ref).toBe('rrpp-ana')
  })

  it('borra los toques vencidos de otros eventos al guardar uno nuevo', () => {
    const b = browser()
    captureAttribution(1, '?ref=a', { now: T0, storages: b.tab() })
    captureAttribution(2, '?ref=b', { now: T0 + 8 * 24 * HOUR, storages: b.tab() })
    expect(b.local.getItem(`${ATTRIBUTION_KEY}:1`)).toBeNull()
    expect(b.local.getItem(`${ATTRIBUTION_KEY}:2`)).not.toBeNull()
  })

  it('JSON roto o fechas del futuro no rompen ni atribuyen', () => {
    const local = new MemoryStorage()
    local.setItem(`${ATTRIBUTION_KEY}:134`, '{no es json')
    expect(readAttribution(134, { now: T0, storages: { local, session: new MemoryStorage() } })).toEqual({})
    local.setItem(`${ATTRIBUTION_KEY}:134`, JSON.stringify({ ref: 'x', landing_at: new Date(T0 + 5 * HOUR).toISOString() }))
    expect(readAttribution(134, { now: T0, storages: { local, session: new MemoryStorage() } })).toEqual({})
  })
})
