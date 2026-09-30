// Backfill de app_metadata (scripts/backfill-app-metadata.mjs): solo la lógica pura de decisión.
// Nunca se conecta a Supabase.
import { describe, expect, it } from 'vitest'

import {
  ACTIONS,
  createRateLimiter,
  decideBackfill,
  formatTable,
  maskEmail,
  parseArgs,
} from '../../scripts/backfill-app-metadata.mjs'

describe('decideBackfill', () => {
  const db = { email: 'Seba@Example.cl', created_at: '2025-03-01T12:00:05Z' }
  // Mismo registro: Auth se crea segundos antes que la fila de public.users
  const created_at = '2025-03-01T12:00:00Z'

  it('marca cuando no hay app y el correo coincide sin distinguir mayúsculas', () => {
    const d = decideBackfill(db, { email: 'seba@example.cl ', created_at, app_metadata: { provider: 'email', providers: ['email'] } })
    expect(d.action).toBe(ACTIONS.TAG)
    expect(d.appMetadata).toEqual({ provider: 'email', providers: ['email'], app: 'aitickets' })
  })

  it('marca aunque app_metadata sea null', () => {
    const d = decideBackfill(db, { email: 'seba@example.cl', created_at, app_metadata: null })
    expect(d).toEqual({ action: ACTIONS.TAG, appMetadata: { app: 'aitickets' } })
  })

  it('no muta el app_metadata original', () => {
    const meta = { provider: 'email' }
    decideBackfill(db, { email: 'seba@example.cl', created_at, app_metadata: meta })
    expect(meta).toEqual({ provider: 'email' })
  })

  it('omite si ya está marcado como aitickets', () => {
    expect(decideBackfill(db, { email: 'otro@x.cl', app_metadata: { app: 'aitickets' } }).action).toBe(ACTIONS.ALREADY)
  })

  it('omite y reporta si pertenece a otra app, aunque el correo coincida', () => {
    const d = decideBackfill(db, { email: 'seba@example.cl', app_metadata: { app: 'otraapp' } })
    expect(d.action).toBe(ACTIONS.OTHER_APP)
    expect(d.reason).toBe('app=otraapp')
    expect(d.appMetadata).toBeUndefined()
  })

  it('omite si los correos no coinciden', () => {
    expect(decideBackfill(db, { email: 'otra@example.cl', app_metadata: {} }).action).toBe(ACTIONS.EMAIL_MISMATCH)
  })

  it('omite si falta algún correo', () => {
    expect(decideBackfill({ email: null }, { email: 'a@b.cl', app_metadata: {} }).action).toBe(ACTIONS.NO_EMAIL)
    expect(decideBackfill(db, { email: '', app_metadata: {} }).action).toBe(ACTIONS.NO_EMAIL)
    expect(decideBackfill(db, { phone: '+569', app_metadata: {} }).action).toBe(ACTIONS.NO_EMAIL)
  })

  it('omite si el usuario de Auth no existe', () => {
    expect(decideBackfill(db, null).action).toBe(ACTIONS.AUTH_MISSING)
  })

  it('no marca una identidad preexistente vinculada al registrarse (otra app del proyecto compartido)', () => {
    // /api/auth/register vinculó una identidad de Auth creada meses antes por otra app sin app_metadata.app
    const d = decideBackfill(db, { email: 'seba@example.cl', created_at: '2024-11-20T09:00:00Z', app_metadata: { provider: 'email' } })
    expect(d.action).toBe(ACTIONS.PREEXISTING)
    expect(d.appMetadata).toBeUndefined()
    expect(d.reason).toMatch(/min antes que public\.users/)
  })

  it('respeta el margen de 10 minutos entre Auth y public.users', () => {
    const at = (iso) => ({ email: 'seba@example.cl', created_at: iso, app_metadata: {} })
    expect(decideBackfill(db, at('2025-03-01T11:50:05Z')).action).toBe(ACTIONS.TAG) // justo 10 min
    expect(decideBackfill(db, at('2025-03-01T11:50:04Z')).action).toBe(ACTIONS.PREEXISTING)
    expect(decideBackfill(db, at('2025-03-01T12:30:00Z')).action).toBe(ACTIONS.PREEXISTING) // Auth muy posterior
  })

  it('sin fechas de creación no marca (falla cerrado)', () => {
    expect(decideBackfill({ email: 'seba@example.cl' }, { email: 'seba@example.cl', created_at, app_metadata: {} })).toEqual({
      action: ACTIONS.PREEXISTING,
      reason: 'sin fecha de creación',
    })
    expect(decideBackfill(db, { email: 'seba@example.cl', app_metadata: {} }).action).toBe(ACTIONS.PREEXISTING)
  })
})

describe('maskEmail', () => {
  it('deja la primera letra y el dominio', () => {
    expect(maskEmail('seba@schuchhardt.cl')).toBe('s***@schuchhardt.cl')
    expect(maskEmail(' a@b.cl ')).toBe('a***@b.cl')
  })
  it('maneja valores raros sin filtrar datos', () => {
    expect(maskEmail(null)).toBe('(sin correo)')
    expect(maskEmail('sinarroba')).toBe('***')
    expect(maskEmail('@dominio.cl')).toBe('***')
  })
})

describe('parseArgs', () => {
  it('simulación por defecto', () => {
    expect(parseArgs([])).toEqual({ apply: false, help: false, unknown: [] })
  })
  it('--apply y argumentos desconocidos', () => {
    expect(parseArgs(['--apply']).apply).toBe(true)
    expect(parseArgs(['--aply']).unknown).toEqual(['--aply'])
  })
})

describe('createRateLimiter', () => {
  it('espacia las llamadas según la tasa', async () => {
    let t = 0
    const waits = []
    const throttle = createRateLimiter(5, { now: () => t, sleep: async (ms) => { waits.push(ms); t += ms } })
    await throttle()
    await throttle()
    await throttle()
    expect(waits).toEqual([200, 200])
  })
})

describe('formatTable', () => {
  it('imprime encabezado y filas alineadas', () => {
    const out = formatTable([{ id: 7, maskedEmail: 's***@x.cl', action: ACTIONS.TAG, reason: 'simulación' }])
    const lines = out.split('\n')
    expect(lines[0]).toMatch(/^users\.id\s+email\s+acción\s+detalle$/)
    expect(lines[2]).toContain('s***@x.cl')
    expect(lines[2]).toContain('tag')
  })
})
