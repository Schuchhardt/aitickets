// Background: recolector de eventos externos para /panoramas (netlify/lib/market/ticketing-watch.mjs). SOLO resultados de
// búsqueda y la API oficial de Ticketmaster; nunca visita páginas de ticketeras. Registra por /api/internal/market-import.
// Solo server-to-server (x-internal-secret). Resumen a Slack (SLACK_WEBHOOK_URL) si hubo novedades o errores.
// Body opcional: { "dry_run": true } → arma la lista sin registrar (va en la respuesta).
import { hasValidInternalSecret, json } from '../../lib/supabase.mjs'
import { formatMarketSlack, marketWatchGate, runMarketWatch } from '../../lib/market/ticketing-watch.mjs'
import { notifySlack } from '../../lib/slack.mjs'

const MAX_RUN_MS = 14 * 60 * 1000

export default async (req) => {
  if (req.method !== 'POST' || !hasValidInternalSecret(req)) return json({ error: 'No autorizado' }, 401)
  const gate = marketWatchGate()
  if (!gate.ok) return json({ skipped: gate.reason })
  const body = await req.json().catch(() => ({}))
  const started = Date.now()
  try {
    const summary = await runMarketWatch({ deadline: started + MAX_RUN_MS, dryRun: body?.dry_run === true })
    console.log('[market-watch-background]', JSON.stringify({ ...summary, plan: summary.plan ? summary.plan.length : undefined }))
    const r = summary.registered
    if (r.events_created || r.events_updated || summary.competitor.created || summary.errors.length || summary.dryRun) {
      await notifySlack(formatMarketSlack(summary))
    }
    return json({ ok: true, summary })
  } catch (err) {
    console.error('[market-watch-background] error:', err?.message)
    await notifySlack(`⚠️ market-watch falló: ${String(err?.message || err).slice(0, 300)}`)
    return json({ error: 'market_watch_failed' }, 500)
  }
}
