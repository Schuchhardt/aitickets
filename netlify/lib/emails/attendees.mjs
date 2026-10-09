// Correos masivos a asistentes: recordatorio 24 h antes y aviso de cambios del evento.
// Se envían por lotes con recipientVariables: los marcadores %recipient.name% y %recipient.order_url%
// quedan literales en el HTML/texto y sendEmail los reemplaza por destinatario (los valores ya van escapados).
import { h, str, multiline, EmailLayout, Title, Subtitle, Paragraph, Badge, PrimaryButton, Panel, KeyValueTable, renderEmail } from './layout.mjs'

export const NAME_PLACEHOLDER = '%recipient.name%'
export const ORDER_URL_PLACEHOLDER = '%recipient.order_url%'

/**
 * Recordatorio: el evento es mañana.
 * @param {{ eventName?: string, eventDate?: string, startTime?: string, venue?: string }} opts
 */
export async function renderReminderEmail({ eventName, eventDate, startTime, venue } = {}) {
  const name = str(eventName).trim() || 'Tu evento'
  const subject = `🎪 Recordatorio: ${name} es mañana`
  const element = h(
    EmailLayout,
    {
      preview: `${name} es mañana. Ten a mano tus entradas.`,
      footer: { reason: 'Recibiste este correo porque tienes entradas para este evento. El evento es organizado por su productora.' },
    },
    h(Badge, null, 'Recordatorio'),
    h(Title, null, `¡Hola ${NAME_PLACEHOLDER}, tu evento es mañana!`),
    h(Subtitle, null, name),
    h(
      Panel,
      null,
      h(KeyValueTable, {
        rows: [
          { label: 'Fecha', value: str(eventDate) },
          { label: 'Hora', value: startTime ? `${str(startTime)} hrs` : '' },
          { label: 'Lugar', value: str(venue) },
        ],
      })
    ),
    h(PrimaryButton, { href: ORDER_URL_PLACEHOLDER, hint: 'Muestra el código QR de cada entrada en la puerta.' }, 'Ver mis entradas'),
    h(Paragraph, { small: true, muted: true, align: 'center', style: { margin: 0 } }, 'Tip: llega con tiempo y con la batería del celular cargada.')
  )
  return renderEmail(subject, element)
}

export const CHANGE_TYPES = Object.freeze({
  date_change: 'Cambio de fecha',
  venue_change: 'Cambio de lugar',
  cancellation: 'Cancelación',
  general_update: 'Actualización',
})

/**
 * Aviso de cambios (fecha, lugar, cancelación, actualización) a quienes tienen entradas.
 * @param {{ eventName?: string, changeType?: string, changeDescription?: string, eventUrl?: string }} opts
 */
export async function renderEventNotificationEmail({ eventName, changeType, changeDescription, eventUrl } = {}) {
  const name = str(eventName).trim() || 'Tu evento'
  const label = CHANGE_TYPES[changeType] || 'Actualización'
  const cancelled = changeType === 'cancellation'
  const subject = cancelled ? `⚠️ Aviso importante sobre ${name}` : `📢 Actualización: ${name}`
  const element = h(
    EmailLayout,
    {
      preview: cancelled ? `Aviso importante sobre ${name}.` : `Hay novedades sobre ${name}.`,
      footer: { reason: 'Recibiste este correo porque tienes entradas para este evento.' },
    },
    h(Badge, { tone: cancelled ? 'danger' : 'lime' }, label),
    h(Title, null, name),
    h(Paragraph, { align: 'center', muted: true }, `Hola ${NAME_PLACEHOLDER}, hay novedades sobre tu evento.`),
    h(Panel, { label: 'Qué cambió', tone: cancelled ? 'warn' : 'default' }, h(Paragraph, { style: { margin: 0 } }, multiline(changeDescription))),
    eventUrl ? h(PrimaryButton, { href: eventUrl }, 'Ver evento actualizado') : null
  )
  return renderEmail(subject, element)
}

/**
 * Mensaje del productor a quienes tienen entradas (send_attendee_message / schedule_reminder de la API).
 * El texto del productor es texto plano: React lo escapa y multiline() respeta los saltos de línea.
 * @param {{ eventName?: string, organizerName?: string, subject?: string, message?: string, reminder?: boolean, details?: Array<{label:string, value:string}> }} opts
 */
export async function renderProducerMessageEmail({ eventName, organizerName, subject, message, reminder = false, details = [] } = {}) {
  const name = str(eventName).trim() || 'Tu evento'
  const from = str(organizerName).trim()
  const finalSubject = str(subject).trim() || (reminder ? `🎪 Recordatorio: ${name}` : `📢 ${name}`)
  const rows = (details || []).filter((r) => r && str(r.value).trim())
  const element = h(
    EmailLayout,
    {
      preview: reminder ? `${name}: ten a mano tus entradas.` : `Mensaje de ${from || 'la productora'} sobre ${name}.`,
      footer: { reason: `Recibiste este correo porque tienes entradas para este evento.${from ? ` El mensaje lo escribió ${from}, que organiza el evento.` : ''}` },
    },
    h(Badge, null, reminder ? 'Recordatorio' : 'Mensaje del organizador'),
    h(Title, null, name),
    h(Paragraph, { align: 'center', muted: true }, `Hola ${NAME_PLACEHOLDER}${from ? `, ${from} te escribe sobre tu evento.` : ', hay un mensaje sobre tu evento.'}`),
    h(Panel, null, h(Paragraph, { style: { margin: 0 } }, multiline(message))),
    rows.length ? h(Panel, null, h(KeyValueTable, { rows: rows.map((r) => ({ label: str(r.label), value: str(r.value) })) })) : null,
    h(PrimaryButton, { href: ORDER_URL_PLACEHOLDER, hint: 'Muestra el código QR de cada entrada en la puerta.' }, 'Ver mis entradas')
  )
  return renderEmail(finalSubject, element)
}
