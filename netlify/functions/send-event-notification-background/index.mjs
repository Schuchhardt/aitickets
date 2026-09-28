// Background function (hasta 15 min): envía el aviso de cambio de un evento a todos sus asistentes.
// Solo acepta llamadas internas (x-internal-secret) desde /api/send-event-notification.
// Body: { eventId, changeType, changeDescription, requestedBy }
// Envía en lotes de 50 con recipient-variables (sendEmail manda un correo individual a cada destinatario vía el batch de Resend),
// con el pie legal, registra notification_log y avisa por Slack si algo falla.
import { getSupabaseAdmin, hasValidInternalSecret, json, escapeHtml, fetchAllRows } from '../../lib/supabase.mjs'
import { sendEmail, legalFooterHtml, SITE_URL, formatRecipient, isValidEmail } from '../../lib/mailer.mjs'
import { notifySlack } from '../../lib/slack.mjs'

const CHANGE_TYPES = {
  date_change: 'Cambio de fecha',
  venue_change: 'Cambio de lugar',
  cancellation: 'Cancelación',
  general_update: 'Actualización',
}
const BATCH_SIZE = 50

function buildNotificationHtml(eventName, changeType, changeDescription, eventUrl) {
  const label = CHANGE_TYPES[changeType] || 'Actualización'
  const accentColor = changeType === 'cancellation' ? '#dc2626' : '#2563eb'
  const descriptionHtml = escapeHtml(changeDescription).replace(/\r?\n/g, '<br>')

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;">
  <div style="max-width:600px;margin:0 auto;padding:40px 16px;">
    <div style="background:white;border-radius:12px;padding:32px 24px;border:1px solid #e5e7eb;">
      <div style="text-align:center;margin-bottom:24px;">
        <span style="display:inline-block;padding:4px 12px;background:${accentColor}15;color:${accentColor};border-radius:20px;font-size:13px;font-weight:600;">${escapeHtml(label)}</span>
      </div>
      <h1 style="font-size:22px;color:#111;text-align:center;margin:0 0 8px;">${escapeHtml(eventName)}</h1>
      <p style="color:#6b7280;text-align:center;margin:0 0 24px;font-size:15px;">Hay novedades sobre tu evento</p>
      <div style="background:#f3f4f6;border-radius:8px;padding:16px;margin-bottom:24px;">
        <p style="margin:0;color:#374151;font-size:15px;">${descriptionHtml}</p>
      </div>
      <div style="text-align:center;">
        <a href="${escapeHtml(eventUrl)}" style="display:inline-block;padding:12px 24px;background:#111;color:white;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Ver evento actualizado</a>
      </div>
      ${legalFooterHtml({ reason: 'Recibiste este correo porque tienes entradas para este evento.' })}
    </div>
  </div>
</body>
</html>`
}

async function sendNotificationEmails(attendees, eventName, changeType, changeDescription, eventUrl) {
  const safeName = String(eventName || '').replace(/[\r\n]/g, ' ')
  const subject = changeType === 'cancellation' ? `⚠️ Aviso importante sobre ${safeName}` : `📢 Actualización: ${safeName}`
  const html = buildNotificationHtml(eventName, changeType, changeDescription, eventUrl)
  const results = []

  for (let i = 0; i < attendees.length; i += BATCH_SIZE) {
    const batch = attendees.slice(i, i + BATCH_SIZE)
    const recipientVariables = {}
    const to = batch.map((a) => {
      recipientVariables[a.email] = { name: escapeHtml(a.first_name || 'Asistente') }
      return formatRecipient(`${a.first_name || ''} ${a.last_name || ''}`, a.email)
    })
    try {
      const data = await sendEmail({ to, subject, html, recipientVariables, tags: ['event-notification', changeType] })
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
    const eventAttendees = await fetchAllRows(() => supabase
      .from('event_attendees')
      .select('id, attendee_id, attendees ( id, first_name, last_name, email )')
      .eq('event_id', event.id)
      .or('status.is.null,status.neq.cancelled')
      .order('id', { ascending: true }))

    // Un correo por email
    const uniqueAttendees = []
    const seen = new Set()
    for (const ea of eventAttendees || []) {
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
