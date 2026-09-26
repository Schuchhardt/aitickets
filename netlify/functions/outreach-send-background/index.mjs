// Background: envía (o, en dry-run, publica en Slack) los correos con acción vencida.
import { getSupabaseAdmin, hasValidInternalSecret, json } from '../../lib/supabase.mjs'
import { getOutreachConfig } from '../../lib/outreach/config.mjs'
import { notifyOutreach } from '../../lib/outreach/notify.mjs'
import { runSendBatch } from '../../lib/outreach/send.mjs'

export default async (req) => {
  if (req.method !== 'POST' || !hasValidInternalSecret(req)) return json({ error: 'No autorizado' }, 401)
  if (!getOutreachConfig().enabled) return json({ skipped: 'outreach_disabled' })
  try {
    const summary = await runSendBatch({ supabase: getSupabaseAdmin() })
    console.log('[outreach-send]', JSON.stringify(summary))
    return json({ ok: true, summary })
  } catch (err) {
    console.error('[outreach-send] error:', err?.message)
    await notifyOutreach(`⚠️ outreach-send falló: ${String(err?.message || err).slice(0, 300)}`)
    return json({ error: 'send_failed' }, 500)
  }
}
