// Background: enriquece hasta OUTREACH_ENRICH_BATCH (50) leads en estado 'new' por corrida.
import { getSupabaseAdmin, hasValidInternalSecret, json } from '../../lib/supabase.mjs'
import { getOutreachConfig } from '../../lib/outreach/config.mjs'
import { enrichLead } from '../../lib/outreach/enrich.mjs'
import { isPaused } from '../../lib/outreach/guardrails.mjs'
import { createRunBudget } from '../../lib/outreach/llm.mjs'

const MAX_RUN_MS = 13 * 60 * 1000

export default async (req) => {
  if (req.method !== 'POST' || !hasValidInternalSecret(req)) return json({ error: 'No autorizado' }, 401)
  const cfg = getOutreachConfig()
  if (!cfg.enabled) return json({ skipped: 'outreach_disabled' })
  const supabase = getSupabaseAdmin()
  const started = Date.now()
  try {
    if (await isPaused(supabase)) return json({ skipped: 'paused' })
    const { data: leads, error } = await supabase
      .from('aitickets_leads')
      .select('*')
      .eq('status', 'new')
      // Leads de seguimiento manual (p. ej. passline_search): el dueño los contacta desde su Gmail; el
      // outreach automático nunca los enriquece ni los pone en secuencia.
      .eq('manual_only', false)
      .lt('enrich_attempts', 2)
      .order('created_at', { ascending: true })
      .limit(cfg.enrichBatch)
    if (error) throw new Error(error.message)
    const budget = createRunBudget(cfg)
    const summary = {}
    for (const lead of leads || []) {
      if (Date.now() - started > MAX_RUN_MS) break
      try {
        const r = await enrichLead({ supabase, budget, lead })
        summary[r.status] = (summary[r.status] || 0) + 1
      } catch (err) {
        if (err?.name === 'LlmBudgetError') { summary.budget = err.message; break }
        summary.error = (summary.error || 0) + 1
        console.error('[leads-enrich] lead', lead.id, err?.message)
      }
    }
    console.log('[leads-enrich]', JSON.stringify({ summary, tokens: budget.used }))
    return json({ ok: true, summary, tokens: budget.used })
  } catch (err) {
    console.error('[leads-enrich] error:', err?.message)
    return json({ error: 'enrich_failed' }, 500)
  }
}
