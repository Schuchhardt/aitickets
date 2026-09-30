// Background: seguimiento de productores en Passline (SOLO resultados de búsqueda; nunca visita passline.com)
// + enriquecimiento de contactos. Ver netlify/lib/leads/passline-watch.mjs y docs/runbooks/passline-leads.md.
// Solo server-to-server (x-internal-secret). Resumen a Slack (SLACK_WEBHOOK_URL) si hubo novedades o errores.
import { getSupabaseAdmin, hasValidInternalSecret, json } from '../../lib/supabase.mjs'
import { formatSlackSummary, passlineWatchGate, runPasslineWatch, SOURCE_KEY } from '../../lib/leads/passline-watch.mjs'
import { notifySlack } from '../../lib/slack.mjs'

const MAX_RUN_MS = 14 * 60 * 1000

export default async (req) => {
  if (req.method !== 'POST' || !hasValidInternalSecret(req)) return json({ error: 'No autorizado' }, 401)
  const gate = passlineWatchGate()
  if (!gate.ok) return json({ skipped: gate.reason })
  const started = Date.now()
  const supabase = getSupabaseAdmin()
  try {
    // La fila de aitickets_lead_sources también puede apagar la fuente (enabled=false).
    const { data: source } = await supabase.from('aitickets_lead_sources').select('enabled').eq('key', SOURCE_KEY).maybeSingle()
    if (source && source.enabled === false) return json({ skipped: 'lead_source_disabled' })

    const summary = await runPasslineWatch({ supabase, deadline: started + MAX_RUN_MS })
    await supabase
      .from('aitickets_lead_sources')
      .update({ last_run_at: new Date().toISOString(), last_result: { ok: true, ...summary, at: new Date().toISOString() } })
      .eq('key', SOURCE_KEY)
    console.log('[passline-watch-background]', JSON.stringify(summary))
    if (summary.newEvents || summary.leadsInserted || summary.enriched || summary.errors.length) {
      await notifySlack(formatSlackSummary(summary))
    }
    return json({ ok: true, summary })
  } catch (err) {
    console.error('[passline-watch-background] error:', err?.message)
    await supabase
      .from('aitickets_lead_sources')
      .update({ last_run_at: new Date().toISOString(), last_result: { ok: false, error: String(err?.message || err).slice(0, 500), at: new Date().toISOString() } })
      .eq('key', SOURCE_KEY)
      .then(() => {}, () => {})
    await notifySlack(`⚠️ passline-watch falló: ${String(err?.message || err).slice(0, 300)}`)
    return json({ error: 'passline_watch_failed' }, 500)
  }
}
