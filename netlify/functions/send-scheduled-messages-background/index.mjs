// Background function (hasta 15 min): envía UN mensaje del productor ya reclamado (status 'sending').
// Solo acepta llamadas internas (x-internal-secret) desde send-scheduled-messages o desde la API de
// productores (send_attendee_message inmediato). Body: { messageId }.
import { getSupabaseAdmin, hasValidInternalSecret, json } from '../../lib/supabase.mjs'
import { notifySlack } from '../../lib/slack.mjs'
import { MESSAGE_COLUMNS, deliverScheduledMessage } from '../../lib/scheduled-messages.mjs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req) {
  if (req.method !== 'POST' || !hasValidInternalSecret(req)) return json({ message: 'No autorizado' }, 401)
  let body
  try {
    body = await req.json()
  } catch {
    return json({ message: 'Solicitud inválida' }, 400)
  }
  const messageId = String(body?.messageId || '')
  if (!UUID_RE.test(messageId)) return json({ message: 'messageId inválido' }, 400)

  const supabase = getSupabaseAdmin()
  const { data: message, error } = await supabase
    .from('aitickets_scheduled_messages')
    .select(MESSAGE_COLUMNS)
    .eq('id', messageId)
    .maybeSingle()
  if (error) {
    console.error('send-scheduled-messages-background:', error.message)
    return json({ message: 'Error interno' }, 500)
  }
  // Solo se envía lo que fue reclamado: un mensaje 'scheduled', 'sent' o 'cancelled' no se toca
  if (!message || message.status !== 'sending') return json({ message: 'Nada que enviar' }, 200)

  const result = await deliverScheduledMessage(supabase, message, { notify: notifySlack })
  console.log(`mensaje ${messageId} (evento #${message.event_id}): ${result.status}, enviados ${result.sent}, fallidos ${result.failed}`)
  return json(result, 200)
}
