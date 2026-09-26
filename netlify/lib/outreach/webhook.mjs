// Procesamiento de webhooks de Instantly (reply_received, email_bounced, lead_unsubscribed, ...).
// - Idempotente: aitickets_outreach_events.provider_event_id es UNIQUE; un duplicado es un no-op. La fila
//   se inserta al inicio (reclama el evento frente a entregas concurrentes) y se BORRA si el procesamiento
//   falla, para que el reintento del proveedor vuelva a procesarlo (una baja nunca se pierde).
// - No confía en el cuerpo del webhook: re-lee el correo con la API del proveedor. Si no se puede
//   re-leer, solo se usa el texto del webhook para el pre-filtro de baja (dirección segura) y el resto
//   va a un humano.
// - Las bajas, rebotes y "no interesado" se registran SIEMPRE, aunque OUTREACH_ENABLED=false (obligación legal).
import { createHash } from 'node:crypto'

import { classifyReply, handleIntent, isUnsubscribeReply } from './classify.mjs'
import { getOutreachConfig } from './config.mjs'
import { normalizeEmail } from './domains.mjs'
import { suppress } from './guardrails.mjs'
import { notifyOutreach } from './notify.mjs'
import { blockAtProvider } from './provider-block.mjs'
import * as instantly from './providers/instantly.mjs'

function eventId(p) {
  const base = [p.event_type, p.email_id || '', p.lead_email || '', p.timestamp || '', p.campaign_id || ''].join('|')
  return `instantly:${createHash('sha256').update(base).digest('hex').slice(0, 40)}`
}

async function findLead(supabase, email) {
  const e = normalizeEmail(email)
  if (!e) return null
  const { data } = await supabase.from('aitickets_leads').select('*').eq('email', e).maybeSingle()
  return data || null
}

const COMPLAINT_RE = /complain|spam/i

/**
 * @returns {Promise<{status: number, body: object, classifyMessageId?: string}>}
 */
export async function processInstantlyWebhook(supabase, payload) {
  if (!payload || typeof payload !== 'object' || !payload.event_type) return { status: 400, body: { error: 'payload inválido' } }
  const type = String(payload.event_type)
  const lead = await findLead(supabase, payload.lead_email)
  const providerEventId = eventId(payload)

  const { error: dupErr } = await supabase.from('aitickets_outreach_events').insert({
    lead_id: lead?.id || null,
    type: `webhook:${type}`.slice(0, 80),
    provider_event_id: providerEventId,
    payload: { event_type: type, email_id: payload.email_id || null, campaign_id: payload.campaign_id || null, step: payload.step ?? null, timestamp: payload.timestamp || null },
  })
  if (dupErr?.code === '23505') return { status: 200, body: { ok: true, duplicate: true } }
  if (dupErr) throw new Error(`events: ${dupErr.message}`)

  try {
    return await handleEvent(supabase, payload, type, lead)
  } catch (err) {
    // Liberar el evento para que el reintento del proveedor lo procese (suppress es idempotente).
    const { error: delErr } = await supabase.from('aitickets_outreach_events').delete().eq('provider_event_id', providerEventId)
    if (delErr) {
      console.error('[outreach-webhook] no se pudo liberar el evento:', delErr.message)
      await notifyOutreach(`🚨 Webhook ${type} de ${normalizeEmail(payload.lead_email) || 'desconocido'} falló y no se podrá reintentar: procésalo a mano (${String(err?.message || err).slice(0, 200)}).`)
    }
    throw err
  }
}

async function handleEvent(supabase, payload, type, lead) {
  const email = normalizeEmail(payload.lead_email)
  switch (type) {
    case 'lead_unsubscribed':
      if (email) await suppress(supabase, { email, reason: 'unsubscribe', source: 'instantly' })
      if (lead) await supabase.from('aitickets_outreach_events').insert({ lead_id: lead.id, type: 'unsubscribe', payload: { via: 'instantly' } })
      return { status: 200, body: { ok: true, action: 'suppressed' } }
    case 'email_bounced':
      if (email) await suppress(supabase, { email, reason: 'hard_bounce', source: 'instantly' })
      if (lead) await supabase.from('aitickets_outreach_events').insert({ lead_id: lead.id, type: 'bounce_hard', payload: { via: 'instantly' } })
      return { status: 200, body: { ok: true, action: 'suppressed' } }
    case 'lead_not_interested':
      if (email) await suppress(supabase, { email, reason: 'not_interested', source: 'instantly' })
      // Instantly puede seguir con los pasos programados: bloquear y sacar de la campaña.
      if (email) await blockAtProvider(supabase, { email, leadId: lead?.id || null, source: 'webhook:not_interested' })
      return { status: 200, body: { ok: true, action: 'suppressed' } }
    case 'reply_received':
      break
    default:
      // Quejas / marcado como spam (el nombre exacto depende de la versión de webhooks de Instantly): se
      // suprime y se registra como 'complaint' para que checkAutoPause pueda pausar por tasa de quejas.
      if (COMPLAINT_RE.test(type)) {
        if (email) await suppress(supabase, { email, reason: 'complaint', source: 'instantly' })
        if (email) await blockAtProvider(supabase, { email, leadId: lead?.id || null, source: 'webhook:complaint' })
        await supabase.from('aitickets_outreach_events').insert({ lead_id: lead?.id || null, type: 'complaint', payload: { via: 'instantly', event_type: type } })
        return { status: 200, body: { ok: true, action: 'suppressed' } }
      }
      // email_sent, email_opened, auto_reply_received, lead_interested, etc.: solo quedan registrados.
      return { status: 200, body: { ok: true, action: 'recorded' } }
  }

  if (!lead) {
    await notifyOutreach(`📨 Respuesta de ${email || 'desconocido'} sin lead asociado (revisar en Instantly).`)
    return { status: 200, body: { ok: true, action: 'no_lead' } }
  }

  // Re-leer el correo desde Instantly.
  const fetched = payload.email_id ? await instantly.getEmail(payload.email_id) : null
  const verified = Boolean(fetched && normalizeEmail(fetched.lead || fetched.from) === lead.email)
  const text = verified ? fetched.text : String(payload.reply_text || payload.reply_text_snippet || '')

  // Un reintento tras un fallo parcial no duplica el mensaje entrante.
  let inbound = null
  if (payload.email_id) {
    const { data: prev } = await supabase.from('aitickets_outreach_messages').select('*')
      .eq('lead_id', lead.id).eq('direction', 'in').eq('provider_message_id', String(payload.email_id)).limit(1).maybeSingle()
    inbound = prev || null
  }
  // (Si ya existía, se vuelve a actuar igual: handleIntent/suppress son idempotentes y el intento anterior
  // pudo fallar a mitad de camino.)
  if (!inbound) inbound = await insertInbound(supabase, { payload, lead, fetched, verified, text })

  // Cualquier respuesta detiene la secuencia.
  await supabase.from('aitickets_leads').update({ status: 'replied', next_action_at: null, updated_at: new Date().toISOString() })
    .eq('id', lead.id).in('status', ['enriched', 'queued', 'contacted'])
  await supabase.from('aitickets_outreach_events').insert({ lead_id: lead.id, message_id: inbound.id, type: 'reply', payload: { verified } })

  // Pre-filtro de baja: sin LLM, siempre (aunque el outreach esté apagado o el correo no se pudo re-leer).
  if (isUnsubscribeReply(text)) {
    const r = await classifyReply({ supabase, budget: null, text })
    await handleIntent({ supabase, lead, inbound, result: r })
    return { status: 200, body: { ok: true, action: 'suppressed' } }
  }

  const cfg = getOutreachConfig()
  if (!cfg.enabled || !verified) {
    await handleIntent({ supabase, lead, inbound, result: null }) // => Slack para un humano
    return { status: 200, body: { ok: true, action: 'escalated' } }
  }
  return { status: 200, body: { ok: true, action: 'queued_for_classification' }, classifyMessageId: inbound.id }
}

async function insertInbound(supabase, { payload, lead, fetched, verified, text }) {
  const { data, error: inErr } = await supabase
    .from('aitickets_outreach_messages')
    .insert({
      lead_id: lead.id,
      direction: 'in',
      provider: 'instantly',
      provider_message_id: payload.email_id || null,
      thread_id: fetched?.threadId || null,
      mailbox: fetched?.mailbox || payload.email_account || null,
      subject: String((verified ? fetched.subject : payload.reply_subject) || '').slice(0, 300),
      body_text: String(text).slice(0, 20_000),
      status: 'received',
      ai_payload: { verified },
    })
    .select('*')
    .single()
  if (inErr) throw new Error(`inbound: ${inErr.message}`)
  return data
}

/** Clasifica y actúa sobre mensajes entrantes pendientes (usado por outreach-classify-background). */
export async function classifyPending({ supabase, budget, messageId = null, limit = 20 }) {
  let query = supabase.from('aitickets_outreach_messages').select('*').eq('direction', 'in').eq('status', 'received').is('ai_intent', null)
  query = messageId ? query.eq('id', messageId) : query.order('created_at', { ascending: true }).limit(limit)
  const { data: pending, error } = await query
  if (error) throw new Error(`pending: ${error.message}`)
  const results = []
  for (const inbound of pending || []) {
    const { data: lead } = await supabase.from('aitickets_leads').select('*').eq('id', inbound.lead_id).maybeSingle()
    if (!lead) continue
    let result = null
    try {
      result = await classifyReply({ supabase, budget, text: inbound.body_text })
    } catch (err) {
      if (err?.name === 'LlmBudgetError') {
        results.push({ id: inbound.id, action: 'budget_exhausted' })
        break
      }
      throw err
    }
    const outcome = await handleIntent({ supabase, lead, inbound, result: result?.intent ? result : null })
    results.push({ id: inbound.id, intent: result?.intent || null, ...outcome })
  }
  return results
}
