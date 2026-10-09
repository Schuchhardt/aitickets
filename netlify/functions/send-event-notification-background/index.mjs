// Background function (hasta 15 min): envía el aviso de cambio de un evento a todos sus asistentes.
// Solo acepta llamadas internas (x-internal-secret) desde /api/send-event-notification.
// Body: { eventId, changeType, changeDescription, requestedBy, includeCancelled?, excludeOrderIds? }
// (includeCancelled y excludeOrderIds solo con 'cancellation': excludeOrderIds = órdenes ya reembolsadas antes de
// cancelar, cuyos titulares no deben recibir el aviso)
// Envía en lotes de 50 con recipient-variables (sendEmail manda un correo individual a cada destinatario vía el batch de Resend),
// con el pie legal, registra notification_log y avisa por Slack si algo falla.
import { getSupabaseAdmin, hasValidInternalSecret, json, escapeHtml, fetchAllRows } from '../../lib/supabase.mjs'
import { sendEmail, SITE_URL, formatRecipient, isValidEmail } from '../../lib/mailer.mjs'
import { renderEventNotificationEmail, CHANGE_TYPES } from '../../lib/emails/index.mjs'
import { notifySlack } from '../../lib/slack.mjs'

const BATCH_SIZE = 50

async function sendNotificationEmails(attendees, eventName, changeType, changeDescription, eventUrl) {
  const { subject, html, text } = await renderEventNotificationEmail({ eventName, changeType, changeDescription, eventUrl })
  const results = []

  for (let i = 0; i < attendees.length; i += BATCH_SIZE) {
    const batch = attendees.slice(i, i + BATCH_SIZE)
    const recipientVariables = {}
    const to = batch.map((a) => {
      // HTML con el nombre escapado; texto plano y asunto con el nombre tal cual (sin "O&#39;Brien")
      const name = a.first_name || 'Asistente'
      recipientVariables[a.email] = { name: { html: escapeHtml(name), text: name } }
      return formatRecipient(`${a.first_name || ''} ${a.last_name || ''}`, a.email)
    })
    try {
      const data = await sendEmail({ to, subject, html, text, recipientVariables, tags: ['event-notification', changeType] })
      results.push({ batch: i, success: true, id: data.id, attendees: batch })
    } catch (error) {
      console.error(`Error enviando lote ${i}:`, error?.message)
      results.push({ batch: i, success: false, error: String(error?.message || error).slice(0, 200), attendees: batch })
    }
  }
  return results
}

export default async function handler(req) {
  if (req.method !== 'POST' || !hasValidInternalSecret(req)) return json({ message: 'No autorizado' }, 401)

  let body
  try {
    body = await req.json()
  } catch {
    return json({ message: 'Solicitud inválida' }, 400)
  }

  const eventId = Number(body?.eventId)
  const changeType = String(body?.changeType || '')
  const changeDescription = typeof body?.changeDescription === 'string' ? body.changeDescription.trim().slice(0, 2000) : ''
  const requestedBy = body?.requestedBy && typeof body.requestedBy === 'object' ? body.requestedBy : null
  const includeCancelled = body?.includeCancelled === true && changeType === 'cancellation'
  const excludeOrderIds = new Set(
    includeCancelled && Array.isArray(body?.excludeOrderIds) ? body.excludeOrderIds.slice(0, 5000).map((id) => String(id)) : []
  )
  if (!Number.isInteger(eventId) || !CHANGE_TYPES[changeType] || !changeDescription) {
    return json({ message: 'eventId, changeType y changeDescription son requeridos' }, 400)
  }

  const tag = `[send-event-notification] evento #${eventId} ${changeType}`
  try {
    const supabase = getSupabaseAdmin()
    const { data: event, error: eventError } = await supabase.from('events').select('id, name, slug').eq('id', eventId).maybeSingle()
    if (eventError) throw eventError
    if (!event) {
      console.warn(`${tag}: evento no encontrado`)
      return json({ message: 'Evento no encontrado' }, 404)
    }

    // Paginado: PostgREST devuelve como máximo 1000 filas por consulta
    // includeCancelled (cancel_event de la API): las entradas ya se anularon al cancelar, pero sus titulares
    // deben recibir el aviso de cancelación.
    const eventAttendees = await fetchAllRows(() => {
      const query = supabase
        .from('event_attendees')
        .select('id, attendee_id, event_order_id, attendees ( id, first_name, last_name, email )')
        .eq('event_id', event.id)
      return (includeCancelled ? query : query.or('status.is.null,status.neq.cancelled')).order('id', { ascending: true })
    })

    // Un correo por email
    const uniqueAttendees = []
    const seen = new Set()
    for (const ea of eventAttendees || []) {
      if (ea.event_order_id && excludeOrderIds.has(String(ea.event_order_id))) continue
      const email = ea.attendees?.email?.toLowerCase()
      if (email && isValidEmail(email) && !seen.has(email)) {
        seen.add(email)
        uniqueAttendees.push({ ...ea.attendees, email })
      }
    }
    if (!uniqueAttendees.length) {
      console.log(`${tag}: sin asistentes para notificar`)
      return json({ message: 'No hay asistentes para notificar', count: 0 }, 200)
    }

    const eventUrl = `${SITE_URL}/eventos/${encodeURIComponent(event.slug || '')}`
    const results = await sendNotificationEmails(uniqueAttendees, event.name, changeType, changeDescription, eventUrl)
    const sentAttendees = results.filter((r) => r.success).flatMap((r) => r.attendees)
    const failed = uniqueAttendees.length - sentAttendees.length

    if (sentAttendees.length) {
      const { error: logError } = await supabase.from('notification_log').insert(
        sentAttendees.map((a) => ({ event_id: event.id, attendee_id: a.id, type: changeType, channel: 'email', status: 'sent' }))
      )
      if (logError) console.warn('No se pudo registrar notification_log:', logError.message)
    }

    console.log(`${tag}: enviados ${sentAttendees.length}, fallidos ${failed}, lotes ${results.length}, solicitado por ${JSON.stringify(requestedBy)}`)
    if (failed > 0) {
      const firstError = results.find((r) => !r.success)?.error || ''
      await notifySlack(`⚠️ Aviso "${CHANGE_TYPES[changeType]}" del evento #${event.id} (${String(event.name || '').slice(0, 80)}): ${failed} de ${uniqueAttendees.length} correos fallaron. ${firstError}`)
    }

    return json({ message: `Notificación enviada a ${sentAttendees.length} asistentes`, count: sentAttendees.length, failed }, 200)
  } catch (error) {
    console.error(`${tag}: error`, error?.message)
    await notifySlack(`⚠️ Falló el envío del aviso "${changeType}" del evento #${eventId}: ${String(error?.message || error).slice(0, 300)}`)
    return json({ message: 'Error interno' }, 500)
  }
}
