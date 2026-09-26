// Función programada (config.schedule abajo): recordatorio a los asistentes de las funciones de MAÑANA.
// - R1: por cada función D de mañana se recuerda a quienes tienen entradas de esa función
//   (event_tickets.event_date_id = D) y, SOLO si D es la primera función próxima del evento, también a
//   quienes tienen entradas válidas para cualquier función (event_date_id NULL) — así no reciben un
//   correo por cada fecha.
// - Dedupe por asistente + evento: notification_log no tiene columna de fecha, así que se considera ya
//   recordado quien tenga un 'reminder_24h' de ese evento en las últimas 20 horas.
// - CTA a /order/<order_id> de cada asistente cuando existe (vía recipient-variables de Mailgun).
import { getSupabaseAdmin, escapeHtml, fetchAllRows } from '../../lib/supabase.mjs'
import { getMailgun, MAIL_DOMAIN, MAIL_FROM, SITE_URL, formatRecipient, isValidEmail } from '../../lib/mailer.mjs'
import { EVENT_DATE_COLUMNS, todayInTimeZone, addDays, formatDateOnlyLong, formatTimeShort, formatEventLocation } from '../../lib/dates.mjs'

const REMINDER_TYPE = 'reminder_24h'
const DEDUPE_WINDOW_HOURS = 20

function buildReminderHtml(eventName, eventDate, startTime, venue) {
  const e = escapeHtml
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;">
  <div style="max-width:600px;margin:0 auto;padding:40px 16px;">
    <div style="background:white;border-radius:12px;padding:32px 24px;border:1px solid #e5e7eb;">
      <div style="text-align:center;margin-bottom:24px;">
        <span style="display:inline-block;padding:4px 12px;background:#f0fdf4;color:#16a34a;border-radius:20px;font-size:13px;font-weight:600;">Recordatorio</span>
      </div>
      <h1 style="font-size:22px;color:#111;text-align:center;margin:0 0 8px;">¡Hola %recipient.name%, tu evento es mañana!</h1>
      <h2 style="font-size:18px;color:#374151;text-align:center;margin:0 0 24px;font-weight:500;">${e(eventName)}</h2>
      <div style="background:#f3f4f6;border-radius:8px;padding:16px;margin-bottom:24px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:8px 0;color:#6b7280;font-size:14px;">Fecha</td>
            <td style="padding:8px 0;color:#111;font-size:14px;text-align:right;font-weight:500;">${e(eventDate)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6b7280;font-size:14px;">Hora</td>
            <td style="padding:8px 0;color:#111;font-size:14px;text-align:right;font-weight:500;">${e(startTime)} hrs</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6b7280;font-size:14px;">Lugar</td>
            <td style="padding:8px 0;color:#111;font-size:14px;text-align:right;font-weight:500;">${e(venue)}</td>
          </tr>
        </table>
      </div>
      <div style="text-align:center;">
        <a href="%recipient.order_url%" style="display:inline-block;padding:12px 24px;background:#111;color:white;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Ver mis entradas</a>
      </div>
      <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:32px;">Recibiste este email porque tienes entradas para este evento.</p>
    </div>
  </div>
</body>
</html>`
}

export default async function handler() {
  console.log('🔔 Revisando recordatorios de eventos...')
  const supabase = getSupabaseAdmin()

  try {
    const tomorrow = addDays(todayInTimeZone(), 1)

    const { data: eventDates, error: datesError } = await supabase
      .from('event_dates')
      .select(EVENT_DATE_COLUMNS + ', event_id')
      .eq('date', tomorrow)
      .order('start_time', { ascending: true })
    if (datesError) {
      console.error('Error obteniendo event_dates:', datesError.message)
      return new Response(JSON.stringify({ error: 'Error obteniendo fechas' }), { status: 500 })
    }
    if (!eventDates?.length) {
      console.log(`✅ No hay funciones el ${tomorrow}`)
      return new Response(JSON.stringify({ message: 'No events tomorrow', count: 0 }), { status: 200 })
    }

    const byEvent = new Map()
    for (const ed of eventDates) {
      if (!byEvent.has(ed.event_id)) byEvent.set(ed.event_id, [])
      byEvent.get(ed.event_id).push(ed)
    }

    const mg = getMailgun()
    const since = new Date(Date.now() - DEDUPE_WINDOW_HOURS * 60 * 60 * 1000).toISOString()
    const today = todayInTimeZone()
    let totalSent = 0

    for (const [eventId, datesTomorrow] of byEvent) {
      const { data: event } = await supabase
        .from('events')
        .select('id, name, slug, location')
        .eq('id', eventId)
        .eq('status', 'published')
        .maybeSingle()
      if (!event) continue

      // Primera función próxima del evento (desde hoy): solo ella recuerda a las entradas "cualquier función"
      const { data: firstUpcoming } = await supabase
        .from('event_dates')
        .select('id')
        .eq('event_id', eventId)
        .gte('date', today)
        .order('date', { ascending: true })
        .order('start_time', { ascending: true, nullsFirst: true })
        .limit(1)
      const firstUpcomingId = firstUpcoming?.[0]?.id ?? null

      const { data: alreadyLogged } = await supabase
        .from('notification_log')
        .select('attendee_id')
        .eq('event_id', eventId)
        .eq('type', REMINDER_TYPE)
        .gte('created_at', since)
      const alreadyReminded = new Set((alreadyLogged || []).map(r => r.attendee_id))

      let eventAttendees
      try {
        eventAttendees = await fetchAllRows(() => supabase
          .from('event_attendees')
          .select('id, attendee_id, event_order_id, attendees ( id, first_name, last_name, email ), event_tickets ( event_date_id )')
          .eq('event_id', eventId)
          .or('status.is.null,status.neq.cancelled')
          .order('id', { ascending: true }))
      } catch (err) {
        console.error(`Error obteniendo asistentes del evento ${eventId}:`, err?.message)
        continue
      }
      if (!eventAttendees.length) continue

      for (const ed of datesTomorrow) {
        const includeAnyFunction = String(ed.id) === String(firstUpcomingId)
        const forThisDate = eventAttendees.filter(ea => {
          const fnId = ea.event_tickets?.event_date_id ?? null
          return fnId == null ? includeAnyFunction : String(fnId) === String(ed.id)
        })
        if (!forThisDate.length) continue

        // Un correo por email, con el link a su orden
        const recipients = []
        const seen = new Set()
        for (const ea of forThisDate) {
          const a = ea.attendees
          const email = a?.email?.toLowerCase()
          if (!email || !isValidEmail(email) || seen.has(email) || alreadyReminded.has(a.id)) continue
          seen.add(email)
          alreadyReminded.add(a.id) // no repetir en otra función del mismo día
          recipients.push({
            id: a.id,
            email,
            first_name: a.first_name,
            last_name: a.last_name,
            order_url: ea.event_order_id ? `${SITE_URL}/order/${ea.event_order_id}` : `${SITE_URL}/eventos/${encodeURIComponent(event.slug || '')}`,
          })
        }
        if (!recipients.length) continue

        const venue = formatEventLocation(ed.event_locations) || event.location || 'Revisa los detalles del evento'
        const html = buildReminderHtml(event.name, formatDateOnlyLong(ed.date), formatTimeShort(ed.start_time), venue)
        const subject = `🎪 Recordatorio: ${String(event.name || '').replace(/[\r\n]/g, ' ')} es mañana`

        const sent = []
        for (let i = 0; i < recipients.length; i += 50) {
          const batch = recipients.slice(i, i + 50)
          const recipientVars = {}
          const toList = batch.map(r => {
            // Las variables se insertan tal cual en el HTML: escapar el nombre
            recipientVars[r.email] = { name: escapeHtml(r.first_name || 'Asistente'), order_url: escapeHtml(r.order_url) }
            return formatRecipient(`${r.first_name || ''} ${r.last_name || ''}`, r.email)
          })
          try {
            await mg.messages.create(MAIL_DOMAIN, {
              from: MAIL_FROM,
              to: toList,
              subject,
              html,
              'recipient-variables': JSON.stringify(recipientVars),
            })
            sent.push(...batch)
          } catch (error) {
            console.error(`Error enviando lote de recordatorios (evento ${eventId}):`, error?.message)
          }
        }

        if (sent.length) {
          const { error: logError } = await supabase.from('notification_log').insert(
            sent.map(r => ({ event_id: eventId, attendee_id: r.id, type: REMINDER_TYPE, channel: 'email', status: 'sent' }))
          )
          if (logError) console.warn('No se pudo registrar notification_log:', logError.message)
        }
        totalSent += sent.length
        console.log(`✅ ${sent.length} recordatorio(s) para el evento ${eventId}, función ${ed.id}`)
      }
    }

    console.log(`🔔 Total recordatorios enviados: ${totalSent}`)
    return new Response(JSON.stringify({ message: 'Reminders sent', count: totalSent }), { status: 200 })
  } catch (error) {
    console.error('Error en send-event-reminders:', error?.message)
    return new Response(JSON.stringify({ error: 'Error interno' }), { status: 500 })
  }
}

export const config = {
  schedule: '0 13 * * *', // 13:00 UTC = 09:00 (invierno, UTC-4) / 10:00 (verano, UTC-3) hora de Chile
}
