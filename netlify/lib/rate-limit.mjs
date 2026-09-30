// Límite de tasa DURABLE (compartido entre instancias serverless) con respaldo en memoria.
//
// rateLimit(bucket, key, { windowSeconds, max }) registra un intento en la ventana fija actual vía la
// función SQL aitickets_rate_limit_hit (db/migrations/202609290300_rate_limits.sql) y devuelve
// { allowed, source }. La clave (IP, email, IP+sitio) se guarda como sha256, nunca en claro.
//
// Falla ABIERTO: si la RPC da error, no existe todavía (migración sin aplicar), tarda demasiado o no hay
// credenciales, se usa un contador en memoria de la instancia con los mismos parámetros (mejor que nada,
// pero no se comparte entre instancias). Un corte de la BD nunca bloquea una compra por sí solo.
import { createHash } from 'node:crypto'

import { getSupabaseAdmin } from './supabase.mjs'

const env = (name) => globalThis.process?.env?.[name]

const RPC_NAME = 'aitickets_rate_limit_hit'
const DEFAULT_TIMEOUT_MS = 1500
const MEMORY_MAX_KEYS = 5000

/** sha256 hex de la clave (con un pimiento del servidor si existe, para que no sea reversible por diccionario). */
export function hashRateLimitKey(key) {
  const pepper = env('RATE_LIMIT_PEPPER') || env('INTERNAL_API_SECRET') || ''
  return createHash('sha256').update(`${String(key)}|${pepper}`).digest('hex')
}

// ---------- respaldo en memoria (ventana fija, por instancia) ----------

const memory = new Map()

function memoryHit(bucket, keyHash, windowSeconds, max, now = Date.now()) {
  const windowMs = windowSeconds * 1000
  const windowStart = Math.floor(now / windowMs) * windowMs
  if (memory.size > MEMORY_MAX_KEYS) {
    for (const [k, entry] of memory) if (entry.windowStart + entry.windowMs <= now) memory.delete(k)
    // Si siguen sobrando (ataque con muchas claves), se descarta lo más antiguo
    if (memory.size > MEMORY_MAX_KEYS) {
      for (const k of memory.keys()) {
        memory.delete(k)
        if (memory.size <= MEMORY_MAX_KEYS / 2) break
      }
    }
  }
  const id = `${bucket}\u0000${keyHash}`
  let entry = memory.get(id)
  if (!entry || entry.windowStart !== windowStart) {
    entry = { windowStart, windowMs, count: 0 }
    memory.set(id, entry)
  }
  entry.count += 1
  return entry.count <= max
}

/** Solo para tests. */
export function _resetRateLimitMemory() {
  memory.clear()
}

function withTimeout(promise, ms) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`rate limit: la RPC tardó más de ${ms} ms`)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

let warnedMissing = false

/**
 * Registra un intento y dice si está permitido.
 * @param {string} bucket  nombre corto del límite (p. ej. 'purchase:ip'); máx. 64 caracteres
 * @param {string | null | undefined} key  IP, email, etc. Sin clave no se limita (allowed: true).
 * @param {{ windowSeconds: number, max: number, supabase?: any, timeoutMs?: number }} opts
 * @returns {Promise<{ allowed: boolean, source: 'db' | 'memory' | 'none' }>}
 */
export async function rateLimit(bucket, key, { windowSeconds, max, supabase, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const k = key == null ? '' : String(key).trim()
  if (!k || k === 'unknown') return { allowed: true, source: 'none' }
  const win = Math.max(1, Math.floor(Number(windowSeconds) || 60))
  const limit = Math.max(0, Math.floor(Number(max) || 0))
  const name = String(bucket).slice(0, 64)
  const keyHash = hashRateLimitKey(k)

  try {
    const client = supabase || getSupabaseAdmin()
    const { data, error } = await withTimeout(
      client.rpc(RPC_NAME, { p_bucket: name, p_key_hash: keyHash, p_window_seconds: win, p_max: limit }),
      timeoutMs
    )
    if (error) throw Object.assign(new Error(error.message || 'error en la RPC'), { code: error.code })
    if (typeof data !== 'boolean') throw new Error('respuesta inesperada de la RPC')
    // También se cuenta en memoria: si la BD se cae a mitad de una ráfaga, el respaldo ya tiene historial
    memoryHit(name, keyHash, win, limit)
    return { allowed: data, source: 'db' }
  } catch (err) {
    const missing = /PGRST202|42883|could not find the function|does not exist/i.test(`${err?.code || ''} ${err?.message || ''}`)
    if (!missing || !warnedMissing) {
      console.warn(`[rate-limit] ${name}: se usa el límite en memoria (${missing ? 'falta la migración de rate limits' : err?.message || err})`)
      if (missing) warnedMissing = true
    }
    return { allowed: memoryHit(name, keyHash, win, limit), source: 'memory' }
  }
}
