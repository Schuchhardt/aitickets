// Latido de las funciones programadas (netlify/lib/job-heartbeat.mjs): deja constancia de cada ejecución y nunca afecta
// al job. Y que cada función programada lo use.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

vi.mock('../../netlify/lib/supabase.mjs', () => ({ getSupabaseAdmin: () => { throw new Error('sin cliente') } }))
const { recordHeartbeat, summarizeResponse, withHeartbeat, HEARTBEATS_TABLE } = await import('../../netlify/lib/job-heartbeat.mjs')

let db
const row = (job = 'j') => db.tables[HEARTBEATS_TABLE].find((r) => r.job === job)
const T1 = new Date('2026-11-05T10:00:00Z')
const T2 = new Date('2026-11-05T10:15:00Z')
const json = (body, status = 200) => new Response(JSON.stringify(body), { status })

beforeEach(() => {
  db = createFakeSupabase({ tables: { [HEARTBEATS_TABLE]: [] }, unique: { [HEARTBEATS_TABLE]: [['job']] } })
})

describe('summarizeResponse', () => {
  it('saca lo procesado de la respuesta de cada job', async () => {
    expect(await summarizeResponse(json({ message: 'No events tomorrow', count: 0 }))).toMatchObject({ ok: true, items: 0, note: null })
    expect(await summarizeResponse(json({ events: 2, sent: 40, failed: 1 }))).toMatchObject({ ok: true, items: 40 })
    expect(await summarizeResponse(json({ expired: 3, recovered: 1, scanned: 9 }))).toMatchObject({ items: 3 })
    expect(await summarizeResponse(json({ paused: false }))).toMatchObject({ ok: true, items: null })
  })

  it('un job apagado corrió bien, y lo dice en la nota', async () => {
    expect(await summarizeResponse(new Response('skipped: LEADS_PASSLINE_ENABLED=false'))).toMatchObject({ ok: true, note: 'skipped: LEADS_PASSLINE_ENABLED=false' })
    expect(await summarizeResponse(json({ skipped: 'disabled' }))).toMatchObject({ ok: true, note: 'skipped: disabled' })
  })

  it('un HTTP 4xx o 5xx es un error, con su detalle', async () => {
    expect(await summarizeResponse(json({ error: 'Error interno' }, 500))).toMatchObject({ ok: false, error: 'HTTP 500: Error interno' })
    expect(await summarizeResponse(new Response('', { status: 502 }))).toMatchObject({ ok: false, error: 'HTTP 502' })
  })

  it('una función que no devuelve Response cuenta como ejecución correcta', async () => {
    expect(await summarizeResponse(undefined)).toMatchObject({ ok: true, items: null })
  })
})

describe('recordHeartbeat', () => {
  it('un éxito limpia el error; un fallo conserva el último éxito', async () => {
    await recordHeartbeat('j', { ok: false, error: 'boom' }, { supabase: db, now: T1 })
    expect(row()).toMatchObject({ last_run_at: T1.toISOString(), last_error: 'boom', last_error_at: T1.toISOString() })
    expect(row().last_success_at ?? null).toBeNull()

    await recordHeartbeat('j', { ok: true, items: 4 }, { supabase: db, now: T2 })
    expect(row()).toMatchObject({ last_run_at: T2.toISOString(), last_success_at: T2.toISOString(), last_error: null, items_processed: 4 })

    const T3 = new Date('2026-11-05T10:30:00Z')
    await recordHeartbeat('j', { ok: false, error: 'otra vez' }, { supabase: db, now: T3 })
    expect(row()).toMatchObject({ last_run_at: T3.toISOString(), last_success_at: T2.toISOString(), last_error: 'otra vez' })
    expect(db.tables[HEARTBEATS_TABLE].length).toBe(1)
  })

  it('no lanza si falta la tabla, falla la base o no hay cliente', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const missing = { from: () => ({ upsert: async () => ({ error: { code: '42P01', message: 'no existe' } }) }) }
    await expect(recordHeartbeat('j', { ok: true }, { supabase: missing })).resolves.toBeUndefined()
    const broken = { from: () => { throw new Error('caída') } }
    await expect(recordHeartbeat('j', { ok: true }, { supabase: broken })).resolves.toBeUndefined()
    await expect(recordHeartbeat('j', { ok: true })).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(3)
    warn.mockRestore()
  })

  it('una base colgada no se come los 30 s de la función', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const hung = { from: () => ({ upsert: () => new Promise(() => {}) }) }
    const done = recordHeartbeat('j', { ok: true }, { supabase: hung })
    await vi.advanceTimersByTimeAsync(3000)
    await expect(done).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
    vi.useRealTimers()
  })
})

describe('withHeartbeat', () => {
  it('devuelve la misma respuesta, con el cuerpo sin consumir, y pasa los argumentos', async () => {
    const req = new Request('https://aitickets.cl/x')
    const handler = vi.fn(async () => json({ count: 2 }))
    const res = await withHeartbeat('j', handler, { supabase: db })(req)
    expect(handler).toHaveBeenCalledWith(req)
    expect(await res.json()).toEqual({ count: 2 })
    expect(row()).toMatchObject({ items_processed: 2, last_error: null })
    expect(row().last_success_at).toBeTruthy()
  })

  it('una ejecución sin trabajo igual deja latido', async () => {
    await withHeartbeat('j', async () => json({ message: 'No events tomorrow', count: 0 }), { supabase: db })()
    expect(row()).toMatchObject({ items_processed: 0 })
    expect(row().last_run_at).toBeTruthy()
  })

  it('si el job lanza, registra el error y relanza el mismo', async () => {
    const err = new Error('boom')
    await expect(withHeartbeat('j', async () => { throw err }, { supabase: db })()).rejects.toBe(err)
    expect(row()).toMatchObject({ last_error: 'boom' })
  })

  it('un 500 del job se registra como error y la respuesta sigue igual', async () => {
    const res = await withHeartbeat('j', async () => json({ error: 'Error interno' }, 500), { supabase: db })()
    expect(res.status).toBe(500)
    expect(row().last_error).toBe('HTTP 500: Error interno')
  })

  it('si falla el latido, el job responde igual', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = { from: () => { throw new Error('caída') } }
    const res = await withHeartbeat('j', async () => json({ count: 1 }), { supabase: broken })()
    expect(await res.json()).toEqual({ count: 1 })
    warn.mockRestore()
  })
})

describe('funciones programadas', () => {
  const dir = 'netlify/functions'
  const scheduled = readdirSync(dir)
    .filter((name) => existsSync(join(dir, name, 'index.mjs')))
    .filter((name) => /^\s*schedule:/m.test(readFileSync(join(dir, name, 'index.mjs'), 'utf8')))
  const healthSource = readFileSync('src/lib/admin-api/tools/health.ts', 'utf8')
  // El dispatcher de la difusión queda fuera mientras no se pueda desplegar: se agrega junto con sus cambios (ver PR #71)
  const PENDING = ['social-series-dispatch']

  it('todas registran su latido con su propio nombre y salen en get_system_health', () => {
    expect(scheduled.length).toBeGreaterThan(10)
    for (const name of scheduled.filter((n) => !PENDING.includes(n))) {
      const src = readFileSync(join(dir, name, 'index.mjs'), 'utf8')
      expect(src, name).toContain(`export default withHeartbeat('${name}', `)
      expect(healthSource, name).toContain(`job: "${name}"`)
    }
  })

  it('el dispatcher de la difusión no cambió', () => {
    expect(readFileSync(join(dir, 'social-series-dispatch', 'index.mjs'), 'utf8')).not.toContain('withHeartbeat')
  })
})
