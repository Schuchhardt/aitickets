// Función programada (cada 10 minutos): reclama los mensajes del productor que ya vencieron
// (aitickets_scheduled_messages: status 'scheduled' y send_at <= ahora) y los entrega a la background
// function send-scheduled-messages-background (hasta 15 min por mensaje). El reclamo es atómico
// (UPDATE ... WHERE status = 'scheduled'): dos ejecuciones nunca envían el mismo mensaje.
// Los que quedaron 'sending' más de STUCK_SENDING_MINUTES (la invocación murió) se marcan 'failed' y se
// avisa por Slack: NO se reintentan solos para no duplicar correos a los asistentes.
import { getSupabaseAdmin } from '../../lib/supabase.mjs'
import { notifySlack } from '../../lib/slack.mjs'
import { BACKGROUND_PATH, MESSAGE_COLUMNS, STUCK_SENDING_MINUTES, claimScheduledMessage, releaseScheduledMessage } from '../../lib/scheduled-messages.mjs'

const MAX_PER_RUN = 20

function functionsOrigin() {
  const trusted = (process.env.DEPLOY_URL || process.env.SITE_URL || '').trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(trusted) ? trusted : ''
}

export default async function handler() {
  const supabase = getSupabaseAdmin()
  const now = new Date()
  try {
    const stuckBefore = new Date(now.getTime() - STUCK_SENDING_MINUTES * 60_000).toISOString()
    const { data: stuck } = await supabase
      .from('aitickets_scheduled_messages')
      .select('id, event_id')
      .eq('status', 'sending')
      .lt('claimed_at', stuckBefore)
      .limit(50)
    for (const m of stuck || []) {
      await supabase.from('aitickets_scheduled_messages').update({ status: 'failed' }).eq('id', m.id).eq('status', 'sending')
      await notifySlack(`⚠️ El mensaje ${m.id} del evento #${m.event_id} quedó a medio enviar (más de ${STUCK_SENDING_MINUTES} min). Revisa notification_log antes de reenviarlo.`)
    }

    const { data: due, error } = await supabase
      .from('aitickets_scheduled_messages')
      .select(MESSAGE_COLUMNS)
      .eq('status', 'scheduled')
      .lte('send_at', now.toISOString())
      .order('send_at', { ascending: true })
      .limit(MAX_PER_RUN)
    if (error) throw error

    const secret = process.env.INTERNAL_API_SECRET
    const origin = functionsOrigin()
    if ((due || []).length && (!secret || !origin)) {
      console.error('send-scheduled-messages: falta', !secret ? 'INTERNAL_API_SECRET' : 'DEPLOY_URL/SITE_URL')
      return new Response(JSON.stringify({ error: 'no configurado' }), { status: 500 })
    }

    let dispatched = 0
    for (const m of due || []) {
      if (!(await claimScheduledMessage(supabase, m.id, now))) continue
      let status = 0
      try {
        const res = await fetch(`${origin}${BACKGROUND_PATH}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
          body: JSON.stringify({ messageId: m.id }),
          signal: AbortSignal.timeout(10_000),
        })
        status = res.status
      } catch (err) {
        console.error(`send-scheduled-messages: no se pudo encolar ${m.id}:`, err?.message)
      }
      if (status === 202 || status === 200) dispatched += 1
      else await releaseScheduledMessage(supabase, m.id) // lo retoma la próxima ejecución
    }
    console.log(`send-scheduled-messages: ${dispatched} mensaje(s) encolado(s), ${(stuck || []).length} atascado(s)`)
    return new Response(JSON.stringify({ dispatched }), { status: 200 })
  } catch (err) {
    console.error('send-scheduled-messages:', err?.message)
    return new Response(JSON.stringify({ error: 'Error interno' }), { status: 500 })
  }
}

export const config = {
  schedule: '*/10 * * * *',
}
