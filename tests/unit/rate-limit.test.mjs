// Límite de tasa durable (netlify/lib/rate-limit.mjs): RPC aitickets_rate_limit_hit con la clave en sha256,
// y respaldo en memoria (falla abierto) si la RPC no existe, da error o tarda.
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { _resetRateLimitMemory, hashRateLimitKey, rateLimit } from '../../netlify/lib/rate-limit.mjs'
import { lintMigration } from '../../scripts/lint-migrations.mjs'

/** Emula la función SQL: ventana fija, count+1 atómico, true si count <= max. */
function sqlLikeRpc() {
  const rows = new Map()
  return {
    rows,
    aitickets_rate_limit_hit: ({ p_bucket, p_key_hash, p_window_seconds, p_max }) => {
      const windowStart = Math.floor(Date.now() / 1000 / p_window_seconds) * p_window_seconds
      const id = `${p_bucket}|${p_key_hash}|${windowStart}`
      const count = (rows.get(id) || 0) + 1
      rows.set(id, count)
      return count <= p_max
    },
  }
}

beforeEach(() => {
  _resetRateLimitMemory()
})

describe('rateLimit con la RPC', () => {
  it('permite hasta max en la ventana y luego bloquea; la clave viaja como sha256', async () => {
    const rpc = sqlLikeRpc()
    const supabase = createFakeSupabase({ rpc })
    const opts = { windowSeconds: 600, max: 3, supabase }
    const results = []
    for (let i = 0; i < 5; i++) results.push(await rateLimit('purchase:ip', '203.0.113.7', opts))
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false])
    expect(results.every((r) => r.source === 'db')).toBe(true)

    const args = supabase.calls.find((c) => c.op === 'rpc').values
    expect(args.name).toBe('aitickets_rate_limit_hit')
    expect(args.args).toEqual({ p_bucket: 'purchase:ip', p_key_hash: hashRateLimitKey('203.0.113.7'), p_window_seconds: 600, p_max: 3 })
    expect(args.args.p_key_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(supabase.calls)).not.toContain('203.0.113.7')

    // Otra clave u otro bucket tienen su propio contador
    expect((await rateLimit('purchase:ip', '198.51.100.1', opts)).allowed).toBe(true)
    expect((await rateLimit('purchase:email', '203.0.113.7', opts)).allowed).toBe(true)
  })

  it('una ventana nueva reinicia el contador', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-29T12:00:05Z'))
    const supabase = createFakeSupabase({ rpc: sqlLikeRpc() })
    const opts = { windowSeconds: 60, max: 1, supabase }
    expect((await rateLimit('b', 'k', opts)).allowed).toBe(true)
    expect((await rateLimit('b', 'k', opts)).allowed).toBe(false)
    vi.setSystemTime(new Date('2026-09-29T12:01:01Z'))
    expect((await rateLimit('b', 'k', opts)).allowed).toBe(true)
  })

  it('sin clave (o IP "unknown") no limita ni consulta la BD', async () => {
    const supabase = createFakeSupabase({ rpc: sqlLikeRpc() })
    for (const key of ['', null, undefined, 'unknown', '   ']) {
      expect(await rateLimit('b', key, { windowSeconds: 60, max: 0, supabase })).toEqual({ allowed: true, source: 'none' })
    }
    expect(supabase.calls).toHaveLength(0)
  })
})

describe('rateLimit falla abierto con respaldo en memoria', () => {
  it('si la función no existe (migración sin aplicar) usa el contador en memoria', async () => {
    const supabase = createFakeSupabase() // sin rpc => PGRST202
    const opts = { windowSeconds: 600, max: 2, supabase }
    const r = []
    for (let i = 0; i < 3; i++) r.push(await rateLimit('ai-assistant:ip', '203.0.113.9', opts))
    expect(r.map((x) => x.allowed)).toEqual([true, true, false])
    expect(r.every((x) => x.source === 'memory')).toBe(true)
  })

  it('si la RPC da error, permite (hasta el límite en memoria)', async () => {
    const supabase = createFakeSupabase({ rpc: { aitickets_rate_limit_hit: () => { throw new Error('boom') } } })
    expect(await rateLimit('b', 'k', { windowSeconds: 60, max: 5, supabase })).toEqual({ allowed: true, source: 'memory' })
  })

  it('si la RPC tarda más que el timeout, permite', async () => {
    const supabase = { rpc: () => new Promise(() => {}) }
    const started = Date.now()
    expect(await rateLimit('b', 'k', { windowSeconds: 60, max: 5, supabase, timeoutMs: 30 })).toEqual({ allowed: true, source: 'memory' })
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('sin credenciales de Supabase, permite', async () => {
    expect(await rateLimit('b', 'k', { windowSeconds: 60, max: 5 })).toEqual({ allowed: true, source: 'memory' })
  })

  it('una respuesta que no es booleana no bloquea', async () => {
    const supabase = createFakeSupabase({ rpc: { aitickets_rate_limit_hit: () => null } })
    expect((await rateLimit('b', 'k', { windowSeconds: 60, max: 5, supabase })).allowed).toBe(true)
  })
})

describe('migración 202609290300_rate_limits.sql', () => {
  const file = '202609290300_rate_limits.sql'
  const sql = readFileSync(new URL(`../../db/migrations/${file}`, import.meta.url), 'utf8')

  it('pasa el lint de migraciones', () => {
    expect(lintMigration(file, sql)).toEqual([])
  })

  it('RLS activo, sin acceso para anon/authenticated (tabla y función) y EXECUTE solo para service_role', () => {
    expect(sql).toMatch(/ALTER TABLE public\.aitickets_rate_limits ENABLE ROW LEVEL SECURITY/)
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.aitickets_rate_limits FROM PUBLIC, anon, authenticated/)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.aitickets_rate_limit_hit\(text, text, int, int\) FROM anon, authenticated/)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.aitickets_rate_limit_hit\(text, text, int, int\) FROM PUBLIC/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.aitickets_rate_limit_hit\(text, text, int, int\) TO service_role/)
    expect(sql).toMatch(/SECURITY DEFINER\s+SET search_path = public/)
    expect(sql).toMatch(/ON CONFLICT \(bucket, key_hash, window_start\)/)
  })
})
