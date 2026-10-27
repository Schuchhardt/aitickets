// Aviso a la lista de espera (netlify/lib/waitlist.mjs): se abrió la venta o se liberaron entradas. Es un solo
// correo por persona y evento, así que no lleva enlace de baja: quien se anotó pidió exactamente este aviso.
import { h, str, EmailLayout, Title, Subtitle, Paragraph, Badge, PrimaryButton, FallbackLink, renderEmail } from './layout.mjs'

/**
 * @param {{ eventName?: string, organizerName?: string, opened?: boolean, whenLabel?: string, eventUrl: string }} opts
 *   opened: true si esperaban que abriera la venta; false si estaba agotado o lleno y se liberaron cupos.
 */
export async function renderWaitlistOpenEmail({ eventName, organizerName, opened = false, whenLabel, eventUrl } = {}) {
  const name = str(eventName).trim() || 'el evento'
  const from = str(organizerName).trim()
  const when = str(whenLabel).trim()
  const subject = opened ? `Abrió la venta: ${name}` : `Hay entradas de nuevo: ${name}`
  const element = h(
    EmailLayout,
    {
      preview: opened ? 'Ya puedes comprar tus entradas.' : 'Se liberaron entradas. Si lo quieres, no esperes mucho.',
      footer: { reason: 'Pediste que te avisáramos en la página del evento.' },
    },
    h(Badge, null, 'Lista de espera'),
    h(Title, null, opened ? 'Abrió la venta' : 'Hay entradas de nuevo'),
    h(Subtitle, null, name),
    when ? h(Paragraph, { align: 'center', muted: true }, when) : null,
    h(
      Paragraph,
      { align: 'center' },
      opened
        ? `Te anotaste para que te avisáramos${from ? ` cuando ${from} abriera la venta` : ' cuando abriera la venta'}. Ya puedes comprar.`
        : 'Te anotaste porque estaba agotado. Se liberaron entradas y se venden por orden de compra.'
    ),
    h(PrimaryButton, { href: eventUrl }, 'Comprar entradas'),
    h(FallbackLink, { href: eventUrl }),
    h(Paragraph, { small: true, muted: true, align: 'center', style: { margin: '16px 0 0' } }, 'Es el único aviso que te enviaremos por este evento.')
  )
  return renderEmail(subject, element)
}
