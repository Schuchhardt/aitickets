// Background: descubrimiento diario de leads (Chile Cultura; el resto de fuentes son stubs apagados).
import { getSupabaseAdmin, hasValidInternalSecret, json } from '../../lib/supabase.mjs'
import { getOutreachConfig } from '../../lib/outreach/config.mjs'
import { isPaused } from '../../lib/outreach/guardrails.mjs'
import { notifyOutreach } from '../../lib/outreach/notify.mjs'
import { runDiscovery } from '../../lib/outreach/sources/index.mjs'

export default async (req) => {
  if (req.method !== 'POST' || !hasValidInternalSecret(req)) return json({ error: 'No autorizado' }, 401)
  if (!getOutreachConfig().enabled) return json({ skipped: 'outreach_disabled' })
  const supabase = getSupabaseAdmin()
  try {
    if (await isPaused(supabase)) return json({ skipped: 'paused' })
    const results = await runDiscovery({ supabase })
    const inserted = Object.values(results).reduce((n, r) => n + (r?.inserted || 0), 0)
    const failed = Object.entries(results).filter(([, r]) => r && r.ok === false)
    if (inserted || failed.length) {
      await notifyOutreach(`🔎 Descubrimiento: ${inserted} leads nuevos${failed.length ? ` · errores: ${failed.map(([k, r]) => `${k}: ${r.error}`).join('; ')}` : ''}`)
    }
    console.log('[leads-discover]', JSON.stringify(results))
    return json({ ok: true, results })
  } catch (err) {
    console.error('[leads-discover] error:', err?.message)
    await notifyOutreach(`⚠️ leads-discover falló: ${String(err?.message || err).slice(0, 300)}`)
    return json({ error: 'discover_failed' }, 500)
  }
}
