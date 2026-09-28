// Envío del correo con las entradas de una orden (contrato C6).
// Lo usan: send-tickets-email (llamadas internas), payment-confirmation (webhook de Flow)
// y purchase-tickets (órdenes gratis). Idempotente vía event_orders.email_sent_at.
import { getSupabaseAdmin } from './supabase.mjs'
import { sendEmail, SITE_URL, formatRecipient, isValidEmail } from './mailer.mjs'
import { renderTicketsEmail } from './emails/index.mjs'
import { LEGAL } from './legal.mjs'
import {
  EVENT_DATE_COLUMNS,
  zonedDateTimeToUtc,
  todayInTimeZone,
  formatDateOnlyLong,
  formatTimeShort,
  formatInstantLong,
  formatInstantTime,
  formatEventLocation,
  formatFunctionLabel,
} from './dates.mjs'

// Un claim de envío sin éxito más antiguo que esto se considera abandonado (la función murió a mitad de camino).
const EMAIL_CLAIM_STALE_MINUTES = 10

const stripHtml = (html) => String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim()

function escapeIcsText(text) {
  return String(text || '')
    .normalize('NFC')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

// Folding de líneas ICS por octetos (RFC 5545), sin cortar caracteres UTF-8.
function foldIcsLine(line) {
  const MAX = 75
  const bytes = new TextEncoder().encode(line)
  let out = ''
  let i = 0
  while (i < bytes.length) {
    let end = Math.min(i + MAX, bytes.length)
    while (end > i && end < bytes.length && (bytes[end] & 0b11000000) === 0b10000000) end--
    out += new TextDecoder().decode(bytes.slice(i, end))
    i = end
    if (i < bytes.length) out += '\r\n '
  }
  return out
}

const icsDate = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'

function buildIcs({ orderId, eventName, description, start, end, location, orderUrl }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Chanium LLC//AI Tickets//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${orderId}@aitickets.cl`,
    `DTSTAMP:${icsDate(new Date())}`,
    `SUMMARY;LANGUAGE=es:${escapeIcsText(eventName)}`,
    `DESCRIPTION;LANGUAGE=es:${escapeIcsText(`Tus entradas: ${orderUrl}\n\n${description.slice(0, 1500)}`)}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `LOCATION:${escapeIcsText(location)}`,
    `URL:${orderUrl}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Recordatorio',
    'TRIGGER:-PT2H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(foldIcsLine).join('\r\n') + '\r\n'
}

function googleCalendarUrl({ eventName, start, end, location, details }) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: eventName,
    dates: `${icsDate(start)}/${icsDate(end)}`,
    details: details.slice(0, 800),
    location,
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

/**
 * Envía el correo de entradas de una orden pagada.
 * @param {string} orderId uuid de event_orders
 * @param {{force?: boolean}} options force=true reenvía aunque ya se haya enviado
 * @returns {Promise<{ok:boolean, status:'sent'|'already_sent'|'not_found'|'not_paid'|'error', message?:string}>}
 */
export async function sendOrderTicketsEmail(orderId, { force = false } = {}) {
  const supabase = getSupabaseAdmin()

  const { data: order, error: orderError } = await supabase
    .from('event_orders')
    .select(`
      id, created_at, status, event_id, attendee_id, amount, ticket_fee, total_payment, ticket_details, email_sent_at,
      buyer_first_name, buyer_last_name, buyer_email,
      attendees ( first_name, last_name, email ),
      events ( id, name, slug, description, location, secret_location, start_date, end_date, organization_id )
    `)
    .eq('id', orderId)
    .maybeSingle()

  if (orderError) return { ok: false, status: 'error', message: orderError.message }
  if (!order) return { ok: false, status: 'not_found', message: 'Orden no encontrada' }
  if (order.status !== 'paid') return { ok: false, status: 'not_paid', message: 'La orden no está pagada' }
  if (!force && order.email_sent_at) return { ok: true, status: 'already_sent' }

  // R2: datos del comprador de ESTA orden; el registro attendees es compartido por email (fallback para órdenes antiguas)
  const buyer = order.buyer_email
    ? { first_name: order.buyer_first_name, last_name: order.buyer_last_name, email: order.buyer_email }
    : order.attendees
  const event = order.events
  if (!buyer?.email || !isValidEmail(buyer.email) || !event) {
    return { ok: false, status: 'error', message: 'Orden sin comprador o evento válido' }
  }

  // Reclamar el envío de forma atómica para que el webhook y un reintento no manden dos correos.
  // email_sent_at solo se escribe tras un envío exitoso; email_claimed_at marca un envío en curso
  // y caduca a los 10 minutos (si la función murió, otro intento puede reclamarlo).
  if (!force) {
    const staleBefore = new Date(Date.now() - EMAIL_CLAIM_STALE_MINUTES * 60 * 1000).toISOString()
    // PostgREST 12.2 falla (42703) si un UPDATE con filtro or()/and() pide la fila de vuelta
    // (return=representation): se usa count exacto y, si hace falta, una lectura aparte.
    const { count: claimed, error: claimError } = await supabase
      .from('event_orders')
      .update({ email_claimed_at: new Date().toISOString() }, { count: 'exact' })
      .eq('id', order.id)
      .is('email_sent_at', null)
      .or(`email_claimed_at.is.null,email_claimed_at.lt.${staleBefore}`)
    if (claimError) return { ok: false, status: 'error', message: claimError.message }
    if (!claimed) {
      // Otro proceso lo envió o lo está enviando ahora mismo
      return { ok: true, status: 'already_sent' }
    }
  }
  const releaseClaim = async () => {
    if (force) return
    await supabase.from('event_orders').update({ email_claimed_at: null }).eq('id', order.id).is('email_sent_at', null)
  }

  try {
    // Entradas reales de la orden (sirve también para cortesías sin ticket_details)
    const { data: attendeeRows, error: attendeesError } = await supabase
      .from('event_attendees')
      .select('id, event_ticket_id, event_tickets ( ticket_name, price, event_date_id )')
      .eq('event_order_id', order.id)
      .or('status.is.null,status.neq.cancelled')
    if (attendeesError) throw new Error(attendeesError.message)
    if (!attendeeRows?.length) throw new Error('La orden no tiene entradas emitidas')

    const detailPrice = new Map(
      (Array.isArray(order.ticket_details) ? order.ticket_details : []).map(l => [Number(l?.id), Number(l?.price)])
    )
    const grouped = new Map()
    for (const row of attendeeRows) {
      const key = Number(row.event_ticket_id)
      const current = grouped.get(key) || {
        functionId: row.event_tickets?.event_date_id ?? null,
        name: row.event_tickets?.ticket_name || 'Entrada',
        unitPrice: detailPrice.has(key) && Number.isFinite(detailPrice.get(key)) ? detailPrice.get(key) : Number(row.event_tickets?.price) || 0,
        quantity: 0,
      }
      current.quantity += 1
      grouped.set(key, current)
    }
    const ticketLines = [...grouped.values()]

    const subtotal = Number(order.amount) || 0
    const fee = Number(order.ticket_fee) || 0
    const total = order.total_payment != null ? Number(order.total_payment) : subtotal + fee

    // Fechas y lugar desde event_dates / venues (fallback: columnas denormalizadas de events)
    const { data: eventDates } = await supabase
      .from('event_dates')
      .select(EVENT_DATE_COLUMNS)
      .eq('event_id', event.id)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true })

    const today = todayInTimeZone()
    const allDates = eventDates || []
    const datesById = new Map(allDates.map(d => [Number(d.id), d]))
    // R1: entradas de una función específica -> mostrar esa función en la línea y en "Cuándo y dónde"
    for (const line of ticketLines) {
      const fn = line.functionId != null ? datesById.get(Number(line.functionId)) : null
      if (fn) line.name = `${line.name} (${formatFunctionLabel(fn, { withPlace: false })})`
    }
    const specificIds = new Set(ticketLines.map(l => l.functionId).filter(id => id != null).map(Number))
    const allSpecific = ticketLines.length > 0 && ticketLines.every(l => l.functionId != null && datesById.has(Number(l.functionId)))
    const upcoming = allDates.filter(d => d.date >= today)
    const shownDates = allSpecific
      ? allDates.filter(d => specificIds.has(Number(d.id)))
      : (upcoming.length ? upcoming : allDates).slice(0, 5)

    const dateLines = shownDates.length
      ? shownDates.map(d => ({
          date: formatDateOnlyLong(d.date),
          time: formatTimeShort(d.start_time),
          place: formatEventLocation(d.event_locations) || event.location || '',
        }))
      : (event.start_date ? [{ date: formatInstantLong(event.start_date, false), time: formatInstantTime(event.start_date), place: event.location || '' }] : [])

    let start = null
    let end = null
    let calendarLocation = event.location || ''
    if (shownDates.length) {
      const first = shownDates[0]
      start = zonedDateTimeToUtc(first.date, first.start_time)
      end = first.end_time ? zonedDateTimeToUtc(first.date, first.end_time) : null
      if (end && end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000) // termina después de medianoche
      calendarLocation = formatEventLocation(first.event_locations) || calendarLocation
    } else if (event.start_date) {
      start = new Date(event.start_date)
      end = event.end_date ? new Date(event.end_date) : null
    }
    if (start && !end) end = new Date(start.getTime() + 3 * 60 * 60 * 1000)
    if (event.secret_location) calendarLocation = event.secret_location

    const orderUrl = `${SITE_URL}/order/${order.id}`
    const description = stripHtml(event.description)
    const calendarUrl = start
      ? googleCalendarUrl({ eventName: event.name || 'Evento', start, end, location: calendarLocation, details: `Tus entradas: ${orderUrl}` })
      : null

    const email = await renderTicketsEmail({
      customerName: buyer.first_name || 'asistente',
      eventName: event.name || 'Tu evento',
      dateLines,
      secretLocation: event.secret_location || '',
      ticketLines,
      subtotal,
      fee,
      total,
      orderId: order.id,
      orderDate: formatInstantLong(order.created_at),
      orderUrl,
      calendarUrl,
    })

    // Copia oculta al administrador de la productora (y al equipo solo si TICKETS_BCC está definido)
    const bcc = String(process.env.TICKETS_BCC || '').split(',').map(s => s.trim()).filter(isValidEmail)
    if (event.organization_id) {
      const { data: admins } = await supabase
        .from('users')
        .select('email')
        .eq('organization_id', event.organization_id)
        .in('role', ['admin', 'producer'])
        .limit(1)
      if (admins?.[0]?.email && isValidEmail(admins[0].email)) bcc.push(admins[0].email)
    }

    const attachments = start
      ? [{
          filename: 'evento.ics',
          content: Buffer.from(buildIcs({ orderId: order.id, eventName: event.name || 'Evento', description, start, end, location: calendarLocation, orderUrl }), 'utf-8'),
          contentType: 'text/calendar',
        }]
      : []

    await sendEmail({
      to: formatRecipient(`${buyer.first_name || ''} ${buyer.last_name || ''}`, buyer.email),
      subject: email.subject,
      html: email.html,
      text: email.text,
      replyTo: LEGAL.supportEmail,
      bcc,
      attachments,
      tags: ['tickets'],
    })

    const { error: markError } = await supabase
      .from('event_orders')
      .update({ email_sent_at: new Date().toISOString(), email_claimed_at: null })
      .eq('id', order.id)
    if (markError) console.error(`Orden ${order.id}: correo enviado pero no se pudo marcar email_sent_at:`, markError.message)
    console.log(`✉️ Entradas enviadas para la orden ${order.id} (${attendeeRows.length} entradas)`)
    return { ok: true, status: 'sent' }
  } catch (error) {
    console.error(`❌ Error enviando entradas de la orden ${order.id}:`, error?.message)
    await releaseClaim()
    return { ok: false, status: 'error', message: error?.message || 'Error enviando correo' }
  }
}
