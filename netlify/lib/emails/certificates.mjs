// Certificado de asistencia por correo (send_attendance_certificates, src/lib/producer-api/tools/certificates.ts).
// Masivo con recipientVariables: %recipient.name% y %recipient.certificate_url% (link firmado a /certificado/<token>,
// un PDF con el certificado de cada entrada de esa persona). Es un solo correo por envío que pidió el productor,
// sobre un evento al que la persona asistió: no lleva enlace de baja.
import { h, str, EmailLayout, Title, Subtitle, Paragraph, Badge, PrimaryButton, FallbackLink, renderEmail } from './layout.mjs'
import { NAME_PLACEHOLDER } from './attendees.mjs'

export const CERTIFICATE_URL_PLACEHOLDER = '%recipient.certificate_url%'

/** @param {{ eventName?: string, organizerName?: string, note?: string }} opts */
export async function renderCertificateEmail({ eventName, organizerName, note } = {}) {
  const name = str(eventName).trim() || 'el evento'
  const from = str(organizerName).trim()
  const extra = str(note).trim()
  const subject = `Tu certificado de asistencia: ${name}`
  const element = h(
    EmailLayout,
    {
      preview: 'Descarga tu certificado en PDF.',
      footer: { reason: `Recibes este correo porque asististe a ${name}.` },
    },
    h(Badge, null, 'Certificado'),
    h(Title, null, `${NAME_PLACEHOLDER}, gracias por venir`),
    h(Subtitle, null, name),
    h(Paragraph, { align: 'center' }, `${from ? `${from} te envía` : 'Aquí está'} tu certificado de asistencia, con tu nombre, las fechas y las horas.`),
    extra ? h(Paragraph, { align: 'center', muted: true }, extra) : null,
    h(PrimaryButton, { href: CERTIFICATE_URL_PLACEHOLDER }, 'Descargar certificado'),
    h(FallbackLink, { href: CERTIFICATE_URL_PLACEHOLDER }),
    h(Paragraph, { small: true, muted: true, align: 'center', style: { margin: '16px 0 0' } }, 'El link no vence: guárdalo si lo vas a necesitar más adelante.')
  )
  return renderEmail(subject, element)
}
