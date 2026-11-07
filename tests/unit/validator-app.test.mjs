// App de puerta (/validador, src/lib/validatorApp.ts): qué puede abrir el rol Puerta del panel, cómo se ordenan los
// eventos y a dónde llega al aceptar una invitación.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => ({}) }))

const { validatorMayOpen, splitValidatorEvents, validatorEventPath, CHECKIN_ROLES } = await import('../../src/lib/validatorApp.ts')
const { homeForRole } = await import('../../src/lib/team-accept.ts')
const { CHECKIN_ROLES: API_CHECKIN_ROLES } = await import('../../netlify/lib/session.mjs')

describe('rol Puerta en el panel', () => {
  it('solo puede abrir su perfil y el check-in (que lo manda a /validador/<slug>)', () => {
    expect(validatorMayOpen('/dashboard/profile')).toBe(true)
    expect(validatorMayOpen('/dashboard/profile/')).toBe(true)
    expect(validatorMayOpen('/dashboard/events/12/checkin')).toBe(true)
    for (const path of ['/dashboard', '/dashboard/events', '/dashboard/events/12', '/dashboard/events/12/edit', '/dashboard/ia', '/dashboard/team', '/dashboard/finance', '/dashboard/events/12/checkin/x']) {
      expect(validatorMayOpen(path)).toBe(false)
    }
  })

  it('al aceptar la invitación llega al validador', () => {
    expect(homeForRole('validator')).toBe('/validador')
    expect(homeForRole('finance')).toBe('/dashboard/finance')
    expect(homeForRole('editor')).toBe('/dashboard')
  })

  it('los roles de check-in de las páginas coinciden con los de las APIs del escáner', () => {
    expect([...CHECKIN_ROLES].sort()).toEqual([...API_CHECKIN_ROLES].sort())
  })
})

describe('lista de eventos del validador', () => {
  const NOW = Date.parse('2026-11-07T03:00:00Z') // 00:00 del 7 de noviembre en Chile
  const ev = (id, start, end = null) => ({ id, name: `E${id}`, slug: `e${id}`, start_date: start, end_date: end, location: null })

  it('en curso y próximos primero (por fecha); los terminados hace más de 12 h van a anteriores', () => {
    const events = [
      ev(1, '2026-11-20T23:00:00Z'),
      ev(2, '2026-11-07T01:00:00Z', '2026-11-07T07:00:00Z'), // fiesta en curso
      ev(3, '2026-11-01T23:00:00Z', '2026-11-02T05:00:00Z'), // terminó hace días
      ev(4, '2026-11-06T20:00:00Z'), // sin término: empezó hace 7 h
      ev(5, null),
    ]
    const { upcoming, past } = splitValidatorEvents(events, NOW)
    expect(upcoming.map((e) => e.id)).toEqual([5, 4, 2, 1])
    expect(past.map((e) => e.id)).toEqual([3])
  })

  it('muestra como máximo los 10 anteriores más recientes', () => {
    const old = Array.from({ length: 15 }, (_, i) => ev(i + 1, new Date(NOW - (i + 2) * 86400000).toISOString()))
    const { past } = splitValidatorEvents(old, NOW)
    expect(past).toHaveLength(10)
    expect(past[0].id).toBe(1)
  })

  it('arma la URL del escáner', () => {
    expect(validatorEventPath('mi-fiesta')).toBe('/validador/mi-fiesta')
  })
})
