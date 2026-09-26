// Función programada del outreach (cada 20 min, lun-vie 12-22 UTC ≈ horario hábil de Chile).
// Solo decide qué trabajo toca y dispara las background functions (con await de cada 202).
// Siempre (aunque OUTREACH_ENABLED=false):
//  1. Sincroniza la campaña de Instantly con los interruptores (apagado/pausa/dry-run => campaña pausada),
//     porque Instantly envía por su cuenta los seguimientos ya programados. Si falla: Slack fuerte y reintento.
//  2. Al final, con presupuesto de tiempo, reintenta los bloqueos de bajas pendientes en Instantly.
// Las funciones programadas mueren a los 30 s: se disparan primero las background functions y los
// reintentos van al final con un tope de ~8 s.
import { getSupabaseAdmin } from '../../lib/supabase.mjs'
import { getOutreachConfig } from '../../lib/outreach/config.mjs'
import { isPaused, isWithinSendWindow } from '../../lib/outreach/guardrails.mjs'
import { functionsOrigin, triggerBackground } from '../../lib/outreach/background.mjs'
import { retryPendingBlocks } from '../../lib/outreach/provider-block.mjs'
import { syncProviderCampaign } from '../../lib/outreach/provider-campaign.mjs'

const TICK_BUDGET_MS = 25_000
const RETRY_BUDGET_MS = 8_000

async function retryBlocks(supabase, started) {
  if (!process.env.INSTANTLY_API_KEY) return
  const budgetMs = Math.min(RETRY_BUDGET_MS, TICK_BUDGET_MS - (Date.now() - started))
  if (budgetMs <= 0) {
    console.warn('[outreach-tick] sin tiempo para reintentar bloqueos pendientes; quedan para la próxima corrida')
    return
  }
  try {
    const r = await retryPendingBlocks(supabase, { budgetMs })
    if (r.retried || r.outOfTime) console.log('[outreach-tick] provider blocks', JSON.stringify(r))
  } catch (err) {
    console.error('[outreach-tick] provider blocks:', err?.message)
  }
}

export default async (req) => {
  const started = Date.now()
  const cfg = getOutreachConfig()
  const supabase = getSupabaseAdmin()

  let paused = false
  let stateOk = true
  try {
    paused = await isPaused(supabase)
  } catch (err) {
    // Deploy sin la migración aplicada (p. ej. preview): no se dispara trabajo, pero sí se pausa la campaña.
    console.error('[outreach-tick] estado no disponible:', err?.message)
    stateOk = false
    paused = true
  }

  // Interruptor de emergencia en el proveedor (nunca lanza; si falla avisa por Slack y reintenta aquí).
  const campaign = await syncProviderCampaign(supabase, { paused, cfg, reason: !cfg.enabled ? 'OUTREACH_ENABLED=false' : paused ? 'outreach en pausa' : '' })
  if (campaign.action !== 'noop' && campaign.action !== 'not_configured') console.log('[outreach-tick] campaign', JSON.stringify(campaign))

  if (!cfg.enabled || !stateOk) {
    await retryBlocks(supabase, started)
    const msg = !cfg.enabled ? 'outreach disabled' : 'outreach state unavailable'
    console.log(msg)
    return new Response(msg, { status: 200 })
  }

  const origin = functionsOrigin(req)
  const due = []

  // Clasificación de respuestas pendientes: corre aunque esté pausado (las respuestas no esperan; la
  // respuesta automática igual respeta la pausa y la supresión: ver guardrails.canReply).
  const { count: pendingReplies } = await supabase
    .from('aitickets_outreach_messages')
    .select('id', { count: 'exact', head: true })
    .eq('direction', 'in').eq('status', 'received').is('ai_intent', null)
  if (pendingReplies) due.push('outreach-classify-background')

  if (!paused) {
    // Descubrimiento: la función revisa last_run_at por fuente (máx. 1 vez al día).
    const { data: sources } = await supabase.from('aitickets_lead_sources').select('key, enabled, last_run_at').eq('enabled', true)
    const stale = (sources || []).some((s) => ['chilecultura', 'places', 'websearch', 'ticketing'].includes(s.key) &&
      (!s.last_run_at || Date.now() - new Date(s.last_run_at).getTime() > 20 * 3600_000))
    if (stale) due.push('leads-discover-background')

    const { count: newLeads } = await supabase.from('aitickets_leads').select('id', { count: 'exact', head: true }).eq('status', 'new').lt('enrich_attempts', 2)
    if (newLeads) due.push('leads-enrich-background')

    if (isWithinSendWindow(new Date(), cfg)) {
      const { count: dueLeads } = await supabase
        .from('aitickets_leads')
        .select('id', { count: 'exact', head: true })
        .in('status', ['enriched', 'contacted'])
        .lte('next_action_at', new Date().toISOString())
      if (dueLeads) due.push('outreach-send-background')
    }
  }

  const results = []
  for (const name of due) results.push(await triggerBackground(origin, name))

  await retryBlocks(supabase, started)
  console.log('[outreach-tick]', JSON.stringify({ paused, campaign: campaign.action, results }))
  return Response.json({ paused, campaign: campaign.action, results })
}

export const config = {
  // 24/7: el interruptor de emergencia (pausar la campaña en el proveedor) debe aplicarse en ≤20 min a
  // cualquier hora; los envíos propios igual se limitan a la ventana de envío (isWithinSendWindow).
  schedule: '*/20 * * * *',
}
