// Background: responde por WhatsApp los mensajes pendientes de una conversación (bot de Kapso + Claude).
// Lo dispara whatsapp-webhook con {conversationId} y x-internal-secret.
import { getSupabaseAdmin, hasValidInternalSecret, json } from '../../lib/supabase.mjs'
import { getKapsoConfig } from '../../lib/whatsapp/kapso.mjs'
import { processConversation } from '../../lib/whatsapp/agent.mjs'

export default async (req) => {
  if (req.method !== 'POST' || !hasValidInternalSecret(req)) return json({ error: 'No autorizado' }, 401)
  let body = {}
  try { body = await req.json() } catch { /* sin body */ }
  const conversationId = typeof body?.conversationId === 'string' && /^[\w.:-]{1,120}$/.test(body.conversationId) ? body.conversationId : null
  if (!conversationId) return json({ error: 'conversationId inválido' }, 400)
  const cfg = getKapsoConfig()
  if (!cfg.apiKey || !cfg.phoneNumberId || !process.env.ANTHROPIC_API_KEY) {
    console.error('[wa-bot] faltan KAPSO_API_KEY, KAPSO_PHONE_NUMBER_ID o ANTHROPIC_API_KEY')
    return json({ error: 'No configurado' }, 503)
  }
  try {
    const outcome = await processConversation(getSupabaseAdmin(), conversationId)
    console.log('[wa-bot]', JSON.stringify(outcome))
    return json({ ok: true, outcome })
  } catch (err) {
    console.error('[wa-bot] error:', err?.message)
    return json({ error: 'bot_failed' }, 500)
  }
}
