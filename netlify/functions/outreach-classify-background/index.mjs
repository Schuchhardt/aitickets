// Background: clasifica respuestas pendientes y ejecuta la acción de cada intención.
// Body opcional: {messageId} para procesar un mensaje puntual (lo manda el webhook).
import { getSupabaseAdmin, hasValidInternalSecret, json } from '../../lib/supabase.mjs'
import { getOutreachConfig } from '../../lib/outreach/config.mjs'
import { createRunBudget } from '../../lib/outreach/llm.mjs'
import { classifyPending } from '../../lib/outreach/webhook.mjs'

export default async (req) => {
  if (req.method !== 'POST' || !hasValidInternalSecret(req)) return json({ error: 'No autorizado' }, 401)
  const cfg = getOutreachConfig()
  if (!cfg.enabled) return json({ skipped: 'outreach_disabled' })
  let body = {}
  try { body = await req.json() } catch { /* sin body */ }
  const messageId = typeof body?.messageId === 'string' && /^[0-9a-f-]{36}$/i.test(body.messageId) ? body.messageId : null
  try {
    const results = await classifyPending({ supabase: getSupabaseAdmin(), budget: createRunBudget(cfg), messageId })
    console.log('[outreach-classify]', JSON.stringify(results))
    return json({ ok: true, results })
  } catch (err) {
    console.error('[outreach-classify] error:', err?.message)
    return json({ error: 'classify_failed' }, 500)
  }
}
