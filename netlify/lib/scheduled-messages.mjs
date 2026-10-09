// Mensajes del productor a los asistentes (tabla aitickets_scheduled_messages, migración 202610090200).
// Los crean send_attendee_message / schedule_reminder de la API de productores. Los envía la background
// function send-scheduled-messages-background; la función programada send-scheduled-messages reclama los
// que vencen cada 10 minutos. Estados: scheduled → sending → sent | failed (o cancelled antes de enviarse).
import { escapeHtml, fetchAllRows } from './supabase.mjs'
import { sendEmail, SITE_URL, formatRecipient, isValidEmail } from './mailer.mjs'
import { renderProducerMessageEmail } from './emails/index.mjs'
import { LEGAL } from './legal.mjs'

export const MESSAGE_BATCH_SIZE = 50
export const BACKGROUND_PATH = '/.netlify/functions/send-scheduled-messages-background'
/** Un mensaje que quedó 'sending' más de esto se da por fallido (la invocación murió). */
export const STUCK_SENDING_MINUTES = 30
export const MESSAGE_COLUMNS = 'id, organization_id, event_id, kind, subject, body, audience, send_at, status, recipients_count, failed_count, claimed_at'

/**
 * Destinatarios: un correo por email entre los titulares de entradas no anuladas del evento.
 * audience 'not_checked_in' = solo quienes tienen alguna entrada sin validar.
 * @returns {Promise<Array<{id:number, email:string, first_name:string|null, last_name:string|null, order_url:string}>>}
 */
export async function collectMessageRecipients(supabase, event, audience = 'all') {
  const rows = await fetchAllRows(() => supabase
    .from('event_attendees')
    .select('id, status, event_order_id, attendees ( id, first_name, last_name, email )')
    .eq('event_id', event.id)
    .order('id', { ascending: true }))
  const eventUrl = `${SITE_URL}/eventos/${encodeURIComponent(event.slug || '')}`
  const byEmail = new Map()
  for (const ea of rows || []) {
    const status = ea.status ?? 'active'
    if (status !== 'active' && status !== 'validated') continue
    const a = Array.isArray(ea.attendees) ? ea.attendees[0] : ea.attendees
    const email = String(a?.email || '').trim().toLowerCase()
    if (!email || !isValidEmail(email)) continue
    const prev = byEmail.get(email)
    const pending = status === 'active'
    if (prev) {
      prev.pending = prev.pending || pending
      continue
    }
    byEmail.set(email, {
      id: a.id,
      email,
      first_name: a.first_name || null,
      last_name: a.last_name || null,
      order_url: ea.event_order_id ? `${SITE_URL}/order/${ea.event_order_id}` : eventUrl,
      pending,
    })
  }
  const list = [...byEmail.values()]
  return (audience === 'not_checked_in' ? list.filter((r) => r.pending) : list).map(({ pending: _p, ...r }) => r)
}

/**
 * Envía un mensaje ya reclamado (status 'sending') y deja su estado final. Nunca lanza.
 * @returns {Promise<{status:'sent'|'failed', sent:number, failed:number, error?:string}>}
 */
export async function deliverScheduledMessage(supabase, message, { notify = async () => {} } = {}) {
  const finish = async (status, sent, failed, error) => {
    const { error: updError } = await supabase
      .from('aitickets_scheduled_messages')
      .update({ status, recipients_count: sent + failed, failed_count: failed, sent_at: new Date().toISOString() })
      .eq('id', message.id)
    if (updError) console.warn('scheduled message update:', updError.message)
    return { status, sent, failed, ...(error ? { error } : {}) }
  }
  try {
    const { data: event } = await supabase
      .from('events')
      .select('id, name, slug, organization_id')
      .eq('id', message.event_id)
      .maybeSingle()
    if (!event || String(event.organization_id) !== String(message.organization_id)) return finish('failed', 0, 0, 'evento no encontrado')
    const { data: org } = await supabase.from('organizations').select('public_name, email').eq('id', event.organization_id).maybeSingle()

    const recipients = await collectMessageRecipients(supabase, event, message.audience)
    if (!recipients.length) return finish('sent', 0, 0)

    const reminder = message.kind === 'reminder'
    const { subject, html, text } = await renderProducerMessageEmail({
      eventName: event.name,
      organizerName: org?.public_name || '',
      subject: message.subject,
      message: message.body,
      reminder,
    })
    const replyTo = org?.email && isValidEmail(org.email) ? org.email : LEGAL.supportEmail

    const sentRecipients = []
    let firstError = ''
    for (let i = 0; i < recipients.length; i += MESSAGE_BATCH_SIZE) {
      const batch = recipients.slice(i, i + MESSAGE_BATCH_SIZE)
      const recipientVariables = {}
      const to = batch.map((r) => {
        const name = r.first_name || 'Asistente'
        recipientVariables[r.email] = {
          name: { html: escapeHtml(name), text: name },
          order_url: { html: escapeHtml(r.order_url), text: r.order_url },
        }
        return formatRecipient(`${r.first_name || ''} ${r.last_name || ''}`, r.email)
      })
      try {
        await sendEmail({
          to,
          subject,
          html,
          text,
          replyTo,
          recipientVariables,
          tags: ['producer-message', message.kind],
          idempotencyKey: `msg-${message.id}-${i}`,
        })
        sentRecipients.push(...batch)
      } catch (err) {
        firstError ||= String(err?.message || err).slice(0, 200)
        console.error(`mensaje ${message.id}: lote ${i} falló:`, err?.message)
      }
    }

    if (sentRecipients.length) {
      const { error: logError } = await supabase.from('notification_log').insert(
        sentRecipients.map((r) => ({ event_id: event.id, attendee_id: r.id, type: reminder ? 'producer_reminder' : 'producer_message', channel: 'email', status: 'sent' }))
      )
      if (logError) console.warn('notification_log:', logError.message)
    }
    const failed = recipients.length - sentRecipients.length
    if (failed > 0) {
      await notify(`⚠️ Mensaje del productor (${message.kind}) del evento #${event.id} (${String(event.name || '').slice(0, 80)}): ${failed} de ${recipients.length} correos fallaron. ${firstError}`)
    }
    return finish(sentRecipients.length ? 'sent' : 'failed', sentRecipients.length, failed, firstError || undefined)
  } catch (err) {
    console.error(`mensaje ${message.id}:`, err?.message)
    await notify(`⚠️ Falló el envío del mensaje ${message.id} del evento #${message.event_id}: ${String(err?.message || err).slice(0, 300)}`)
    return finish('failed', 0, 0, String(err?.message || err).slice(0, 200))
  }
}

/**
 * Reclama un mensaje (scheduled → sending). Devuelve true si esta llamada lo reclamó (nadie más lo enviará).
 */
export async function claimScheduledMessage(supabase, id, now = new Date()) {
  const { count, error } = await supabase
    .from('aitickets_scheduled_messages')
    .update({ status: 'sending', claimed_at: now.toISOString() }, { count: 'exact' })
    .eq('id', id)
    .eq('status', 'scheduled')
  if (error) throw error
  return Boolean(count)
}

/** Devuelve a 'scheduled' un mensaje reclamado cuya background function no se pudo invocar. */
export async function releaseScheduledMessage(supabase, id) {
  const { error } = await supabase
    .from('aitickets_scheduled_messages')
    .update({ status: 'scheduled', claimed_at: null })
    .eq('id', id)
    .eq('status', 'sending')
  if (error) console.warn('release scheduled message:', error.message)
}
