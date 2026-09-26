// Webhook del proveedor de outreach (Instantly): POST /api/outreach/webhook?k=<OUTREACH_WEBHOOK_SECRET>
// Autenticación por token en la URL comparado en tiempo constante (Instantly no firma sus webhooks).
// Siempre procesa bajas/rebotes aunque OUTREACH_ENABLED=false (obligación legal).
import { getSupabaseAdmin, json } from '../../lib/supabase.mjs'
import { functionsOrigin, triggerBackground } from '../../lib/outreach/background.mjs'
import { safeEqual } from '../../lib/outreach/tokens.mjs'
import { processInstantlyWebhook } from '../../lib/outreach/webhook.mjs'

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
  const secret = process.env.OUTREACH_WEBHOOK_SECRET
  const k = new URL(req.url).searchParams.get('k') || ''
  if (!secret || !safeEqual(k, secret)) return json({ error: 'No autorizado' }, 401)

  let payload
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'JSON inválido' }, 400)
  }
  try {
    const supabase = getSupabaseAdmin()
    const result = await processInstantlyWebhook(supabase, payload)
    if (result.classifyMessageId) {
      await triggerBackground(functionsOrigin(req), 'outreach-classify-background', { messageId: result.classifyMessageId })
    }
    return json(result.body, result.status)
  } catch (err) {
    console.error('[outreach-webhook] error:', err?.message)
    // 500 => el proveedor reintenta; el insert idempotente evita duplicados.
    return json({ error: 'webhook_failed' }, 500)
  }
}

export const config = {
  path: ['/api/outreach/webhook'],
}
