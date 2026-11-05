// Latido de las funciones programadas (aitickets_job_heartbeats): cada ejecución deja constancia de que corrió, cómo
// terminó y cuánto procesó, aunque no haya tenido nada que hacer. Lo lee get_system_health.
//
// El latido nunca afecta al job: si falla la escritura, se avisa en el log, y la respuesta o el error del job siguen igual.
// Tiene un tope de tiempo porque las funciones programadas mueren a los 30 s.
import { getSupabaseAdmin } from './supabase.mjs'

export const HEARTBEATS_TABLE = 'aitickets_job_heartbeats'
const WRITE_TIMEOUT_MS = 3000
const TEXT_MAX = 500
/** Campos de la respuesta de cada job que dicen cuánto procesó, por orden de preferencia. */
const ITEM_KEYS = ['count', 'sent', 'dispatched', 'expired', 'deleted', 'scanned', 'checked']

const clip = (value) => String(value ?? '').slice(0, TEXT_MAX)

/** Resume la respuesta de un job: { ok, error, items, note }. */
export async function summarizeResponse(res) {
  if (!(res instanceof Response)) return { ok: true, error: null, items: null, note: null }
  const text = await res.clone().text().catch(() => '')
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    // Algunos jobs responden texto plano ("skipped: …", "weekly reports disabled")
  }
  const isObject = body && typeof body === 'object' && !Array.isArray(body)
  const key = isObject ? ITEM_KEYS.find((k) => typeof body[k] === 'number') : null
  const items = key ? body[key] : null
  if (res.status >= 400) {
    const detail = (isObject && (body.error || body.message)) || text
    return { ok: false, error: clip(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`), items, note: null }
  }
  const note = isObject ? (body.skipped ? `skipped: ${body.skipped}` : null) : text || null
  return { ok: true, error: null, items, note: note ? clip(note) : null }
}

/** Escribe el latido. No lanza nunca. */
export async function recordHeartbeat(job, { ok, error = null, items = null, note = null }, { supabase, now = new Date() } = {}) {
  const at = now.toISOString()
  const row = {
    job,
    last_run_at: at,
    items_processed: items,
    last_note: note,
    ...(ok ? { last_success_at: at, last_error: null } : { last_error: clip(error), last_error_at: at }),
  }
  let timer
  try {
    const client = supabase || getSupabaseAdmin()
    const write = Promise.resolve(client.from(HEARTBEATS_TABLE).upsert(row, { onConflict: 'job' }))
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ error: { message: 'tiempo agotado' } }), WRITE_TIMEOUT_MS)
    })
    const { error: writeError } = await Promise.race([write, timeout])
    if (writeError) console.warn(`[heartbeat] ${job}:`, writeError.message)
  } catch (err) {
    console.warn(`[heartbeat] ${job}:`, err?.message || err)
  } finally {
    clearTimeout(timer)
  }
}

/** Envuelve el handler de una función programada: devuelve lo mismo y relanza lo mismo, y deja el latido. */
export function withHeartbeat(job, handler, deps = {}) {
  return async function heartbeatHandler(...args) {
    let res
    try {
      res = await handler(...args)
    } catch (err) {
      await recordHeartbeat(job, { ok: false, error: err?.message || String(err) }, deps)
      throw err
    }
    let summary = { ok: true }
    try {
      summary = await summarizeResponse(res)
    } catch (err) {
      console.warn(`[heartbeat] ${job}:`, err?.message || err)
    }
    await recordHeartbeat(job, summary, deps)
    return res
  }
}
