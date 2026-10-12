// Persistencia del bot de WhatsApp: conversaciones (aitickets_wa_conversations) y mensajes
// (aitickets_wa_messages). Migración 202610120100_whatsapp_bot.sql.

export const HISTORY_LIMIT = 24
// Cuando una persona del equipo responde desde el Inbox de Kapso, el bot se calla este tiempo.
export const HUMAN_PAUSE_HOURS = Number(process.env.WHATSAPP_HUMAN_PAUSE_HOURS) > 0 ? Number(process.env.WHATSAPP_HUMAN_PAUSE_HOURS) : 12
// Un envío del bot "en vuelo" (fila sin wamid aún) más reciente que esto se considera del bot, no humano.
const IN_FLIGHT_SECONDS = 60

const clip = (v, n) => (v == null ? null : String(v).slice(0, n))
const isUniqueViolation = (error) => String(error?.code || '') === '23505'

/** Crea o actualiza la conversación con la identidad que trae el webhook. */
export async function upsertConversation(supabase, conversation, phoneNumberId, { inbound = false } = {}) {
  const now = new Date().toISOString()
  const row = {
    id: String(conversation.id),
    phone_number_id: String(phoneNumberId),
    updated_at: now,
  }
  const phone = conversation.phone_number ? String(conversation.phone_number).replace(/\D/g, '') : ''
  if (phone) row.wa_phone = phone
  if (conversation.business_scoped_user_id) row.bsuid = clip(conversation.business_scoped_user_id, 120)
  if (conversation.contact_name) row.contact_name = clip(conversation.contact_name, 120)
  if (inbound) row.last_inbound_at = now
  const { error } = await supabase.from('aitickets_wa_conversations').upsert(row, { onConflict: 'id' })
  if (error) throw new Error(`wa conversation upsert: ${error.message}`)
}

/** Guarda un mensaje. Devuelve false si el wamid ya existía (reintento del webhook). */
export async function insertMessage(supabase, { conversationId, wamid = null, direction, author, body, processed = false }) {
  const row = {
    conversation_id: conversationId,
    wamid,
    direction,
    author,
    body: String(body || '').slice(0, 8000),
    processed_at: processed ? new Date().toISOString() : null,
  }
  const { data, error } = await supabase.from('aitickets_wa_messages').insert(row).select('id').single()
  if (error) {
    if (isUniqueViolation(error)) return null
    throw new Error(`wa message insert: ${error.message}`)
  }
  return data?.id || null
}

export async function getConversation(supabase, id) {
  const { data, error } = await supabase
    .from('aitickets_wa_conversations')
    .select('id, phone_number_id, wa_phone, bsuid, contact_name, bot_paused_until, paused_reason, lead_id')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`wa conversation load: ${error.message}`)
  return data
}

export function isBotPaused(conversation, now = Date.now()) {
  const until = conversation?.bot_paused_until ? Date.parse(conversation.bot_paused_until) : NaN
  return Number.isFinite(until) && until > now
}

export async function pauseBot(supabase, conversationId, { hours = HUMAN_PAUSE_HOURS, reason } = {}) {
  const until = new Date(Date.now() + hours * 3600_000).toISOString()
  const { error } = await supabase
    .from('aitickets_wa_conversations')
    .update({ bot_paused_until: until, paused_reason: clip(reason, 300), updated_at: new Date().toISOString() })
    .eq('id', conversationId)
  if (error) throw new Error(`wa pause: ${error.message}`)
  return until
}

export async function setConversationLead(supabase, conversationId, leadId) {
  await supabase.from('aitickets_wa_conversations').update({ lead_id: leadId }).eq('id', conversationId)
}

/** Mensajes entrantes aún sin responder (más antiguos primero). */
export async function pendingInbound(supabase, conversationId) {
  const { data, error } = await supabase
    .from('aitickets_wa_messages')
    .select('id, wamid, body, created_at')
    .eq('conversation_id', conversationId)
    .eq('direction', 'in')
    .is('processed_at', null)
    .order('created_at', { ascending: true })
    .limit(50)
  if (error) throw new Error(`wa pending: ${error.message}`)
  return data || []
}

export async function markProcessed(supabase, ids) {
  if (!ids.length) return
  const { error } = await supabase.from('aitickets_wa_messages').update({ processed_at: new Date().toISOString() }).in('id', ids)
  if (error) throw new Error(`wa mark processed: ${error.message}`)
}

/** Últimos mensajes de la conversación, en orden cronológico. */
export async function recentHistory(supabase, conversationId, limit = HISTORY_LIMIT) {
  const { data, error } = await supabase
    .from('aitickets_wa_messages')
    .select('direction, author, body, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`wa history: ${error.message}`)
  return (data || []).reverse()
}

/**
 * Historial → mensajes para Claude. Las respuestas humanas del equipo cuentan como turnos del asistente
 * (marcadas), y los turnos consecutivos del mismo rol se unen (la API exige alternancia y empezar por user).
 */
export function historyToClaudeMessages(history) {
  const out = []
  for (const m of history) {
    const role = m.direction === 'in' ? 'user' : 'assistant'
    const text = m.author === 'human' ? `[Respuesta de una persona del equipo de AI Tickets]: ${m.body}` : m.body
    if (!String(text || '').trim()) continue
    const last = out[out.length - 1]
    if (last && last.role === role) last.content += `\n\n${text}`
    else out.push({ role, content: text })
  }
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

/** Registra un envío del bot ANTES de llamar a Kapso (fila sin wamid) para no confundirlo con un humano. */
export async function beginOutbound(supabase, conversationId, body) {
  return insertMessage(supabase, { conversationId, direction: 'out', author: 'bot', body, processed: true })
}

export async function completeOutbound(supabase, messageId, wamid) {
  if (!messageId || !wamid) return
  const { error } = await supabase.from('aitickets_wa_messages').update({ wamid }).eq('id', messageId)
  if (error && !isUniqueViolation(error)) console.error('[wa] guardar wamid:', error.message)
}

export async function discardOutbound(supabase, messageId) {
  if (messageId) await supabase.from('aitickets_wa_messages').delete().eq('id', messageId)
}

/**
 * ¿Un mensaje saliente (whatsapp.message.sent) lo mandó el bot? Sí si su wamid ya está guardado, o si hay
 * un envío del bot en vuelo (sin wamid) reciente en la conversación: el webhook puede llegar antes de que
 * guardemos el wamid que devolvió la API.
 */
export async function isOwnOutbound(supabase, conversationId, wamid) {
  if (wamid) {
    const { data } = await supabase.from('aitickets_wa_messages').select('id').eq('wamid', wamid).maybeSingle()
    if (data) return true
  }
  const since = new Date(Date.now() - IN_FLIGHT_SECONDS * 1000).toISOString()
  const { data: inFlight } = await supabase
    .from('aitickets_wa_messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('direction', 'out')
    .eq('author', 'bot')
    .is('wamid', null)
    .gte('created_at', since)
    .limit(1)
  return Boolean(inFlight?.length)
}

export async function claimConversation(supabase, id, seconds = 120) {
  const { data, error } = await supabase.rpc('aitickets_wa_claim_conversation', { p_id: id, p_seconds: seconds })
  if (error) throw new Error(`wa claim: ${error.message}`)
  return data === true
}

export async function releaseConversation(supabase, id) {
  const { error } = await supabase.rpc('aitickets_wa_release_conversation', { p_id: id })
  if (error) console.error('[wa] release:', error.message)
}
