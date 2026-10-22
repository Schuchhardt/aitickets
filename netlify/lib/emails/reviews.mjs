// Correos de reseñas e invitaciones (migración 202610220100, netlify/lib/reviews.mjs).
// - renderReviewRequestEmail: "¿Cómo estuvo?" 24 h después de la función (masivo, con recipientVariables).
// - renderReviewLinkEmail: link para calificar pedido desde la página del evento (un destinatario).
// - renderReviewThanksEmail: gracias + código de descuento de premio (un destinatario).
// - renderNextEventInvitationEmail: invitación de la productora a su próximo evento (masivo, con enlace de baja).
// Los masivos dejan marcadores %recipient.x% literales y sendEmail los reemplaza por destinatario.
import { Link, Img } from '@react-email/components'
import { h, str, multiline, safeHref, COLORS, FONT_FAMILY, EmailLayout, TABLE_PROPS, Title, Subtitle, Paragraph, Badge, PrimaryButton, Panel, KeyValueTable, FallbackLink, renderEmail } from './layout.mjs'
import { NAME_PLACEHOLDER } from './attendees.mjs'

export const REVIEW_URL_PLACEHOLDER = '%recipient.review_url%'
export const UNSUBSCRIBE_PLACEHOLDER = '%recipient.unsubscribe_url%'
/** Un marcador por estrella: cada estrella del correo abre el formulario con esa nota ya marcada. */
export const STAR_PLACEHOLDERS = Object.freeze([1, 2, 3, 4, 5].map((n) => `%recipient.star${n}%`))

/** Fila de 5 estrellas (cada una es un link). Se omite en el texto plano: ahí va el botón. */
function StarRow({ hrefs }) {
  const cellStyle = { padding: '0 4px', textAlign: 'center' }
  return h(
    'table',
    { ...TABLE_PROPS, 'data-text-format': undefined, 'data-skip-in-text': 'true', width: undefined, align: 'center', style: { borderCollapse: 'collapse', margin: '0 auto 8px' } },
    h(
      'tbody',
      null,
      h(
        'tr',
        null,
        hrefs.map((href, i) =>
          h(
            'td',
            { key: `s-${i}`, style: cellStyle },
            h(
              Link,
              { href: safeHref(href), style: { textDecoration: 'none', display: 'inline-block' }, title: `${i + 1} de 5` },
              h('span', { style: { display: 'block', fontSize: '36px', lineHeight: '40px', color: '#f5b301', fontFamily: 'Arial, sans-serif' } }, '★'),
              h('span', { style: { display: 'block', fontSize: '12px', lineHeight: '16px', color: COLORS.muted, fontFamily: FONT_FAMILY } }, String(i + 1))
            )
          )
        )
      )
    )
  )
}

/**
 * "¿Cómo estuvo?" a quienes asistieron. Marcadores: %recipient.name%, %recipient.review_url% y %recipient.star1..5%.
 * @param {{ eventName?: string, organizerName?: string, rewardLabel?: string }} opts
 */
export async function renderReviewRequestEmail({ eventName, organizerName, rewardLabel } = {}) {
  const name = str(eventName).trim() || 'el evento'
  const from = str(organizerName).trim()
  const reward = str(rewardLabel).trim()
  const subject = `⭐ ¿Cómo estuvo ${name}?`
  const element = h(
    EmailLayout,
    {
      preview: reward ? `Califícalo en 10 segundos y recibe ${reward} para tu próximo evento.` : `Cuéntanos cómo lo pasaste: califícalo en 10 segundos.`,
      footer: { reason: 'Recibiste este correo porque tenías entradas para este evento.' },
    },
    h(Badge, null, 'Tu opinión'),
    h(Title, null, `${NAME_PLACEHOLDER}, ¿cómo estuvo?`),
    h(Subtitle, null, name),
    h(Paragraph, { align: 'center', muted: true }, `Toca las estrellas para calificarlo de 1 a 5. ${from ? `${from} lee cada opinión` : 'La productora lee cada opinión'} y puedes dejar un comentario público o uno privado solo para ellos.`),
    h(StarRow, { hrefs: STAR_PLACEHOLDERS }),
    reward
      ? h(Panel, { tone: 'lime', label: 'Premio por calificar' }, h(Paragraph, { style: { margin: 0 } }, `Al calificar recibes un código de ${reward} para tu próximo evento${from ? ` de ${from}` : ''}.`))
      : null,
    h(PrimaryButton, { href: REVIEW_URL_PLACEHOLDER, hint: 'También puedes subir tus fotos a la galería del evento.' }, 'Calificar y subir fotos')
  )
  return renderEmail(subject, element)
}

/**
 * Link para calificar, pedido desde la página del evento ("Validar con mi correo").
 * @param {{ eventName?: string, reviewUrl: string }} opts
 */
export async function renderReviewLinkEmail({ eventName, reviewUrl } = {}) {
  const name = str(eventName).trim() || 'el evento'
  const subject = `Tu link para calificar ${name}`
  const element = h(
    EmailLayout,
    { preview: `Abre el link para calificar ${name} y subir tus fotos.`, footer: { reason: 'Pediste este link en la página del evento.' } },
    h(Title, null, 'Califica el evento'),
    h(Subtitle, null, name),
    h(Paragraph, { align: 'center', muted: true }, 'Con este link puedes calificar, dejar un comentario y subir tus fotos a la galería. Es personal: no lo compartas.'),
    h(PrimaryButton, { href: reviewUrl }, 'Calificar el evento'),
    h(FallbackLink, { href: reviewUrl }),
    h(Paragraph, { small: true, muted: true, align: 'center', style: { margin: '16px 0 0' } }, 'Si no lo pediste tú, ignora este correo.')
  )
  return renderEmail(subject, element)
}

/**
 * Gracias por calificar + código de descuento de premio.
 * @param {{ eventName?: string, organizerName?: string, rewardCode: string, rewardLabel?: string, validUntil?: string, eventsUrl?: string }} opts
 */
export async function renderReviewThanksEmail({ eventName, organizerName, rewardCode, rewardLabel, validUntil, eventsUrl } = {}) {
  const name = str(eventName).trim() || 'el evento'
  const from = str(organizerName).trim()
  const subject = `🎁 Tu código de descuento${from ? ` para ${from}` : ''}`
  const element = h(
    EmailLayout,
    {
      preview: `Gracias por calificar ${name}. Aquí está tu código de ${str(rewardLabel) || 'descuento'}.`,
      footer: { reason: 'Recibiste este correo porque calificaste este evento.' },
    },
    h(Badge, null, '¡Gracias por calificar!'),
    h(Title, null, `Tu opinión sobre ${name} ya llegó`),
    h(Paragraph, { align: 'center', muted: true }, `Como agradecimiento, ${from || 'la productora'} te regala ${str(rewardLabel) || 'un descuento'} para su próximo evento.`),
    h(
      Panel,
      { tone: 'lime', label: 'Tu código' },
      h(CodeLine, null, h('span', { style: { fontFamily: 'Menlo, Consolas, monospace', fontSize: '24px', lineHeight: '32px', fontWeight: 700, letterSpacing: '2px', color: COLORS.text } }, str(rewardCode))),
      h(KeyValueTable, {
        rows: [
          { label: 'Descuento', value: str(rewardLabel) },
          { label: 'Válido hasta', value: str(validUntil) },
          { label: 'Usos', value: '1 compra' },
        ],
      })
    ),
    h(Paragraph, { small: true, muted: true, align: 'center' }, 'Ingrésalo en "¿Tienes un código de descuento?" al comprar. Aplica a las entradas de cualquier evento de la misma productora.'),
    eventsUrl ? h(PrimaryButton, { href: eventsUrl }, from ? `Ver eventos de ${from}` : 'Ver eventos') : null
  )
  return renderEmail(subject, element)
}

/** Texto centrado sin margen (para el código). */
function CodeLine({ children }) {
  return h('p', { style: { margin: '0 0 12px', textAlign: 'center', fontFamily: FONT_FAMILY } }, children)
}

/**
 * Invitación de la productora a su próximo evento. Marcadores: %recipient.name% y %recipient.unsubscribe_url%.
 * El mensaje de la productora es texto plano (React lo escapa).
 * @param {{ organizerName?: string, sourceEventName?: string, eventName?: string, dateLabel?: string, venue?: string, imageUrl?: string, eventUrl: string, message?: string, subject?: string }} opts
 */
export async function renderNextEventInvitationEmail({ organizerName, sourceEventName, eventName, dateLabel, venue, imageUrl, eventUrl, message, subject } = {}) {
  const from = str(organizerName).trim() || 'La productora'
  const name = str(eventName).trim() || 'nuestro próximo evento'
  const finalSubject = str(subject).trim() || `${from} te invita a ${name}`
  const image = safeHref(imageUrl)
  const element = h(
    EmailLayout,
    {
      preview: `${from} te invita a ${name}${dateLabel ? ` · ${str(dateLabel)}` : ''}.`,
      footer: { unsubscribeUrl: UNSUBSCRIBE_PLACEHOLDER },
    },
    h(Badge, null, 'Invitación'),
    h(Title, null, name),
    h(
      Paragraph,
      { align: 'center', muted: true },
      `Hola ${NAME_PLACEHOLDER}, ${sourceEventName ? `como estuviste en ${str(sourceEventName)}, ` : ''}${from} te invita a su próximo evento.`
    ),
    image
      ? h(Img, { src: image, alt: name, width: 536, style: { display: 'block', width: '100%', maxWidth: '536px', height: 'auto', borderRadius: '12px', margin: '0 auto 16px', border: 0 } })
      : null,
    str(message).trim() ? h(Panel, null, h(Paragraph, { style: { margin: 0 } }, multiline(message))) : null,
    dateLabel || venue
      ? h(Panel, { tone: 'outline' }, h(KeyValueTable, { rows: [{ label: 'Cuándo', value: str(dateLabel) }, { label: 'Dónde', value: str(venue) }] }))
      : null,
    h(PrimaryButton, { href: eventUrl }, 'Ver el evento y entradas'),
    h(
      Paragraph,
      { small: true, muted: true, align: 'center', style: { margin: 0 } },
      `Te escribimos porque asististe a un evento de ${from}. Si no quieres más invitaciones suyas, usa "Darme de baja" al final de este correo.`
    )
  )
  return renderEmail(finalSubject, element)
}
