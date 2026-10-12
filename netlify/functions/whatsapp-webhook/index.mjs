// POST /api/whatsapp/webhook — webhook de WhatsApp de Kapso (kind "kapso", payload v2) para el bot.
// Eventos: whatsapp.message.received (con o sin buffering) y whatsapp.message.sent.
// - Verifica X-Webhook-Signature (HMAC-SHA256 del cuerpo exacto con KAPSO_WEBHOOK_SECRET).
// - Guarda los mensajes entrantes (wamid único: los reintentos de Kapso no duplican) y dispara
//   whatsapp-bot-background, que responde con Claude. Kapso exige 200 en < 10 s, por eso no se responde aquí.
// - Un mensaje saliente que NO mandó el bot es una persona respondiendo desde el Inbox de Kapso:
//   se guarda en el historial y el bot se pausa en esa conversación (WHATSAPP_HUMAN_PAUSE_HOURS).
import { getSupabaseAdmin, json } from '../../lib/supabase.mjs'
import { functionsOrigin, triggerBackground } from '../../lib/outreach/background.mjs'
import { getKapsoConfig, verifyKapsoSignature, inboundText } from '../../lib/whatsapp/kapso.mjs'
import { upsertConversation, insertMessage, isOwnOutbound, pauseBot } from '../../lib/whatsapp/store.mjs'

function payloadsOf(body) {
  if (body?.batch === true && Array.isArray(body.data)) return body.data
  return [body]
}

export async function handleReceived(supabase, payload, cfg) {
  const message = payload?.message
  const conversation = payload?.conversation
  const phoneNumberId = String(payload?.phone_number_id || conversation?.phone_number_id || '')
  if (!message?.id || !conversation?.id) return null
  if (cfg.phoneNumberId && phoneNumberId !== cfg.phoneNumberId) return null
  if (message.kapso?.direction && message.kapso.direction !== 'inbound') return null
  await upsertConversation(supabase, conversation, phoneNumberId, { inbound: true })
  const inserted = await insertMessage(supabase, {
    conversationId: String(conversation.id),
    wamid: String(message.id),
    direction: 'in',
    author: 'customer',
    body: inboundText(message),
  })
  return inserted ? String(conversation.id) : null
}

export async function handleSent(supabase, payload, cfg) {
  const message = payload?.message
  const conversation = payload?.conversation
  const phoneNumberId = String(payload?.phone_number_id || conversation?.phone_number_id || '')
  if (!message?.id || !conversation?.id) return
  if (cfg.phoneNumberId && phoneNumberId !== cfg.phoneNumberId) return
  if (message.kapso?.origin === 'history_sync') return
  const conversationId = String(conversation.id)
  await upsertConversation(supabase, conversation, phoneNumberId)
  if (await isOwnOutbound(supabase, conversationId, String(message.id))) return
  const body = message.text?.body || message.kapso?.content || `[${message.type || 'mensaje'}]`
  const inserted = await insertMessage(supabase, { conversationId, wamid: String(message.id), direction: 'out', author: 'human', body, processed: true })
  if (inserted) await pauseBot(supabase, conversationId, { reason: 'respuesta humana desde el Inbox' })
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
  const cfg = getKapsoConfig()
  if (!cfg.webhookSecret) {
    console.error('[wa-webhook] falta KAPSO_WEBHOOK_SECRET')
    return json({ error: 'No configurado' }, 503)
  }
  const raw = await req.text()
  if (!verifyKapsoSignature(raw, req.headers.get('x-webhook-signature'), cfg.webhookSecret)) {
    return json({ error: 'Firma inválida' }, 401)
  }
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    return json({ error: 'JSON inválido' }, 400)
  }

  const event = req.headers.get('x-webhook-event') || body?.type || ''
  const supabase = getSupabaseAdmin()
  const toProcess = new Set()
  try {
    for (const payload of payloadsOf(body)) {
      if (event === 'whatsapp.message.received') {
        const id = await handleReceived(supabase, payload, cfg)
        if (id) toProcess.add(id)
      } else if (event === 'whatsapp.message.sent') {
        await handleSent(supabase, payload, cfg)
      }
    }
  } catch (err) {
    // 500 => Kapso reintenta (10 s y 40 s); los mensajes ya guardados no se duplican.
    console.error('[wa-webhook] error:', err?.message)
    return json({ error: 'Error procesando el webhook' }, 500)
  }

  if (toProcess.size) {
    const origin = functionsOrigin(req)
    const results = await Promise.all([...toProcess].map((conversationId) => triggerBackground(origin, 'whatsapp-bot-background', { conversationId })))
    for (const r of results) if (r.error) console.error('[wa-webhook] no se pudo disparar el bot:', r.error)
  }
  return json({ ok: true })
}

export const config = {
  path: ['/api/whatsapp/webhook'],
}
