// POST /api/send-event-notification (contrato C8) — avisa a los asistentes de un evento sobre un cambio.
// Autorización: header x-internal-secret (llamada servidor→servidor desde /api/events/update)
// o sesión de productor (admin/producer/editor) dueño del evento.
// Body: { eventId, changeType, changeDescription }
import { getSupabaseAdmin, getOwnedEvent, hasValidInternalSecret, json, escapeHtml, fetchAllRows } from '../../lib/supabase.mjs'
import { getSessionContextWithRefresh, jsonWithCookies, EVENT_MANAGER_ROLES } from '../../lib/session.mjs'
import { getMailgun, MAIL_DOMAIN, MAIL_FROM, SITE_URL, formatRecipient, isValidEmail } from '../../lib/mailer.mjs'

const CHANGE_TYPES = {
  date_change: 'Cambio de fecha',
  venue_change: 'Cambio de lugar',
  cancellation: 'Cancelación',
  general_update: 'Actualización',
}

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
      <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:32px;">Recibiste este email porque tienes entradas para este evento.</p>
    </div>
  </div>
</body>
</html>`
}

async function sendNotificationEmails(attendees, eventName, changeType, changeDescription, eventUrl) {
  const mg = getMailgun()
  const safeName = String(eventName || '').replace(/[\r\n]/g, ' ')
  const subject = changeType === 'cancellation' ? `⚠️ Aviso importante sobre ${safeName}` : `📢 Actualización: ${safeName}`
  const html = buildNotificationHtml(eventName, changeType, changeDescription, eventUrl)
  const results = []

  // Lotes de 50 con recipient-variables: Mailgun envía un correo individual a cada destinatario
  for (let i = 0; i < attendees.length; i += 50) {
    const batch = attendees.slice(i, i + 50)
    const recipientVars = {}
    const toList = batch.map(a => {
      recipientVars[a.email] = { name: escapeHtml(a.first_name || 'Asistente') }
      return formatRecipient(`${a.first_name || ''} ${a.last_name || ''}`, a.email)
    })
    try {
      const data = await mg.messages.create(MAIL_DOMAIN, {
        from: MAIL_FROM,
        to: toList,
        subject,
        html,
        'recipient-variables': JSON.stringify(recipientVars),
      })
      results.push({ batch: i, success: true, id: data.id, attendees: batch })
    } catch (error) {
      console.error(`Error enviando lote ${i}:`, error?.message)
      results.push({ batch: i, success: false, attendees: batch })
    }
  }
  return results
}

export default async function handler(req) {
  let setCookies = []
  const respond = (body, status) => jsonWithCookies(body, status, setCookies)

  if (req.method !== 'POST') return json({ message: 'Método no permitido' }, 405)

  let body
  try {
    body = await req.json()
  } catch {
    return json({ message: 'Solicitud inválida' }, 400)
  }

  const eventId = Number(body?.eventId)
  const changeType = String(body?.changeType || '')
  const changeDescription = typeof body?.changeDescription === 'string' ? body.changeDescription.trim().slice(0, 2000) : ''
  if (!Number.isInteger(eventId) || !CHANGE_TYPES[changeType] || !changeDescription) {
    return json({ message: 'eventId, changeType y changeDescription son requeridos' }, 400)
  }

  try {
    let event
    if (hasValidInternalSecret(req)) {
      const { data } = await getSupabaseAdmin().from('events').select('id, name, slug').eq('id', eventId).maybeSingle()
      event = data
    } else {
      const session = await getSessionContextWithRefresh(req)
      setCookies = session.setCookies
      if (!session.ctx) return respond({ message: 'No autorizado' }, 401)
      if (!EVENT_MANAGER_ROLES.includes(session.ctx.dbUser.role || '')) return respond({ message: 'No autorizado' }, 403)
      event = await getOwnedEvent(eventId, session.ctx.dbUser.organization_id, 'id, name, slug')
    }
    if (!event) return respond({ message: 'Evento no encontrado' }, 404)

    const supabase = getSupabaseAdmin()
    let eventAttendees
    try {
      // Paginado: PostgREST devuelve como máximo 1000 filas por consulta
      eventAttendees = await fetchAllRows(() => supabase
        .from('event_attendees')
        .select('id, attendee_id, attendees ( id, first_name, last_name, email )')
        .eq('event_id', event.id)
        .or('status.is.null,status.neq.cancelled')
        .order('id', { ascending: true }))
    } catch (attendeesError) {
      console.error('Error obteniendo asistentes:', attendeesError.message)
      return respond({ message: 'Error obteniendo asistentes' }, 500)
    }

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
    if (!uniqueAttendees.length) return respond({ message: 'No hay asistentes para notificar', count: 0 }, 200)

    const eventUrl = `${SITE_URL}/eventos/${encodeURIComponent(event.slug || '')}`
    const results = await sendNotificationEmails(uniqueAttendees, event.name, changeType, changeDescription, eventUrl)
    const sentAttendees = results.filter(r => r.success).flatMap(r => r.attendees)

    if (sentAttendees.length) {
      const { error: logError } = await supabase.from('notification_log').insert(
        sentAttendees.map(a => ({ event_id: event.id, attendee_id: a.id, type: changeType, channel: 'email', status: 'sent' }))
      )
      if (logError) console.warn('No se pudo registrar notification_log:', logError.message)
    }

    return respond({
      message: `Notificación enviada a ${sentAttendees.length} asistentes`,
      count: sentAttendees.length,
      failed: uniqueAttendees.length - sentAttendees.length,
    }, 200)
  } catch (error) {
    console.error('Error en send-event-notification:', error?.message)
    return respond({ message: 'Error interno' }, 500)
  }
}

export const config = {
  path: ['/api/send-event-notification'],
}
