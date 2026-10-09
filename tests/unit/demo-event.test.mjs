// Fecha dinámica del evento de demostración (src/lib/demoEvent.mjs): último día del mes en Chile,
// o del mes siguiente si la función de ese día ya terminó (22:30 hora de Chile).
import { describe, expect, it } from 'vitest'

import { DEMO_EVENT_SLUG, DEMO_EVENT_SLUGS, getDemoEventDate, isDemoEventSlug } from '../../src/lib/demoEvent.mjs'

describe('getDemoEventDate', () => {
  it('a mitad de mes devuelve el último día del mes en curso', () => {
    expect(getDemoEventDate(new Date('2026-09-15T15:00:00Z'))).toBe('2026-09-30')
    expect(getDemoEventDate(new Date('2026-10-01T15:00:00Z'))).toBe('2026-10-31')
  })

  it('el último día antes de las 22:30 (Chile) sigue siendo ese día', () => {
    // 30-sep 21:00 en Chile (UTC-3) = 01-oct 00:00 UTC
    expect(getDemoEventDate(new Date('2026-10-01T00:00:00Z'))).toBe('2026-09-30')
  })

  it('el último día después de las 22:30 (Chile) salta al último día del mes siguiente', () => {
    // 30-sep 23:00 en Chile = 01-oct 02:00 UTC
    expect(getDemoEventDate(new Date('2026-10-01T02:00:00Z'))).toBe('2026-10-31')
  })

  it('usa la zona horaria de Chile, no UTC', () => {
    // 01-oct 01:00 UTC es todavía 30-sep 22:00 en Chile: la función de hoy aún no termina
    expect(getDemoEventDate(new Date('2026-10-01T01:00:00Z'))).toBe('2026-09-30')
  })

  it('cambia de año en diciembre y respeta años bisiestos', () => {
    expect(getDemoEventDate(new Date('2026-12-31T23:59:00-03:00'))).toBe('2027-01-31')
    expect(getDemoEventDate(new Date('2028-02-10T12:00:00Z'))).toBe('2028-02-29')
    expect(getDemoEventDate(new Date('2027-02-10T12:00:00Z'))).toBe('2027-02-28')
  })

  it('devuelve siempre YYYY-MM-DD y nunca una fecha pasada', () => {
    const now = new Date('2026-09-26T12:00:00Z')
    const d = getDemoEventDate(now)
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(d >= '2026-09-26').toBe(true)
  })
})

describe('isDemoEventSlug', () => {
  it('solo reconoce el slug del evento demo', () => {
    expect(DEMO_EVENT_SLUG).toBe('evento-demo-aitickets')
    expect(isDemoEventSlug('evento-demo-aitickets')).toBe(true)
    expect(isDemoEventSlug('evento-demo-aitickets-2')).toBe(false)
    expect(isDemoEventSlug(undefined)).toBe(false)
  })
})

describe('getDemoEventDate (varios eventos demo)', () => {
  it('lista tres eventos demo', () => {
    expect(DEMO_EVENT_SLUGS).toEqual(['evento-demo-aitickets', 'evento-demo-concierto', 'evento-demo-feria'])
    expect(isDemoEventSlug('evento-demo-concierto')).toBe(true)
    expect(isDemoEventSlug('evento-demo-feria')).toBe(true)
  })

  it('concierto: el próximo sábado (el mismo sábado hasta las 23:30 de Chile)', () => {
    // 2026-10-09 es viernes
    expect(getDemoEventDate(new Date('2026-10-09T15:00:00Z'), 'evento-demo-concierto')).toBe('2026-10-10')
    // sábado 10 a las 20:00 de Chile => ese mismo día
    expect(getDemoEventDate(new Date('2026-10-10T23:00:00Z'), 'evento-demo-concierto')).toBe('2026-10-10')
    // sábado 10 a las 23:45 de Chile => el sábado siguiente
    expect(getDemoEventDate(new Date('2026-10-11T02:45:00Z'), 'evento-demo-concierto')).toBe('2026-10-17')
  })

  it('feria: el día 15 del mes, o del siguiente si ya pasó', () => {
    expect(getDemoEventDate(new Date('2026-10-09T15:00:00Z'), 'evento-demo-feria')).toBe('2026-10-15')
    expect(getDemoEventDate(new Date('2026-10-15T22:00:00Z'), 'evento-demo-feria')).toBe('2026-10-15')
    expect(getDemoEventDate(new Date('2026-10-16T12:00:00Z'), 'evento-demo-feria')).toBe('2026-11-15')
    expect(getDemoEventDate(new Date('2026-12-20T12:00:00Z'), 'evento-demo-feria')).toBe('2027-01-15')
  })
})
