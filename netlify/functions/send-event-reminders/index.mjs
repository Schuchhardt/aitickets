// Función programada (config.schedule abajo): recordatorio a los asistentes de las funciones de MAÑANA.
// - R1: por cada función D de mañana se recuerda a quienes tienen entradas de esa función
//   (event_tickets.event_date_id = D) y, SOLO si D es la primera función próxima del evento, también a
//   quienes tienen entradas válidas para cualquier función (event_date_id NULL) — así no reciben un
//   correo por cada fecha.
// - Dedupe por asistente + evento: notification_log no tiene columna de fecha, así que se considera ya
//   recordado quien tenga un 'reminder_24h' de ese evento en las últimas 20 horas.
// - CTA a /order/<order_id> de cada asistente cuando existe (vía recipientVariables de sendEmail).
import { getSupabaseAdmin, escapeHtml, fetchAllRows } from '../../lib/supabase.mjs'
import { sendEmail, SITE_URL, formatRecipient, isValidEmail } from '../../lib/mailer.mjs'
import { renderReminderEmail } from '../../lib/emails/index.mjs'
import { LEGAL } from '../../lib/legal.mjs'
import { EVENT_DATE_COLUMNS, todayInTimeZone, addDays, formatDateOnlyLong, formatTimeShort, formatEventLocation } from '../../lib/dates.mjs'

const REMINDER_TYPE = 'reminder_24h'
const DEDUPE_WINDOW_HOURS = 20

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
        const { subject, html, text } = await renderReminderEmail({
          eventName: event.name,
          eventDate: formatDateOnlyLong(ed.date),
          startTime: formatTimeShort(ed.start_time),
          venue,
        })

        const sent = []
        for (let i = 0; i < recipients.length; i += 50) {
          const batch = recipients.slice(i, i + 50)
          const recipientVars = {}
          const toList = batch.map(r => {
            // En el HTML van escapadas; en el texto plano y el asunto, tal cual (sin "O&#39;Brien")
            const name = r.first_name || 'Asistente'
            recipientVars[r.email] = {
              name: { html: escapeHtml(name), text: name },
              order_url: { html: escapeHtml(r.order_url), text: r.order_url },
            }
            return formatRecipient(`${r.first_name || ''} ${r.last_name || ''}`, r.email)
          })
          try {
            await sendEmail({
              to: toList,
              subject,
              html,
              text,
              replyTo: LEGAL.supportEmail,
              recipientVariables: recipientVars,
              tags: ['reminder'],
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
