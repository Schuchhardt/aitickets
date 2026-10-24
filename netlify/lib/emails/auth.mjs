// Correos de acceso: confirmación de correo del registro y enlaces directos (magic link) para
// recuperar contraseña, cambiarla o ingresar. Los enlaces inician sesión al abrirlos (lo resuelve AUTH).
import { h, str, EmailLayout, Title, Paragraph, PrimaryButton, FallbackLink, Panel, renderEmail } from './layout.mjs'

const firstName = (name) => str(name).trim().split(/\s+/)[0] || ''

/**
 * Confirmación del correo del productor. El botón confirma y deja la sesión iniciada.
 * @param {{ name?: string, orgName?: string, url: string, expiresIn?: string }} opts
 */
export async function renderVerifyEmail({ name, orgName, url, expiresIn = '48 horas' } = {}) {
  const first = firstName(name)
  const org = str(orgName).trim()
  const subject = 'Confirma tu correo para activar tu cuenta de AI Tickets'
  const element = h(
    EmailLayout,
    {
      preview: 'Un clic y entras directo a tu panel de productor.',
      footer: { reason: 'Recibes este correo porque se creó una cuenta de productor en AI Tickets con esta dirección.' },
    },
    h(Title, null, first ? `¡Bienvenido a AI Tickets, ${first}!` : '¡Bienvenido a AI Tickets!'),
    h(
      Paragraph,
      { align: 'center', muted: true },
      org
        ? `Gracias por crear la cuenta de ${org}. Confirma que este correo es tuyo para activarla y publicar tu web de eventos.`
        : 'Gracias por crear tu cuenta de productor. Confirma que este correo es tuyo para activarla y publicar tu web de eventos.'
    ),
    h(PrimaryButton, { href: url, hint: 'Al confirmar entrarás directo a tu panel, sin volver a escribir tu contraseña.' }, 'Confirmar mi correo'),
    h(
      Panel,
      { label: 'Lo que viene' },
      h(Paragraph, { small: true, style: { margin: '0 0 4px' } }, '1. Crea tu primer evento y sus entradas.'),
      h(Paragraph, { small: true, style: { margin: '0 0 4px' } }, '2. Personaliza tu web de eventos.'),
      h(Paragraph, { small: true, style: { margin: 0 } }, '3. Comparte el link y empieza a vender.')
    ),
    h(Paragraph, { small: true, muted: true }, `El enlace vence en ${str(expiresIn)}. Si no creaste esta cuenta, ignora este correo.`),
    h(FallbackLink, { href: url })
  )
  return renderEmail(subject, element)
}

const MAGIC = {
  recovery: {
    subject: 'Ingresa a AI Tickets y crea una nueva contraseña',
    preview: 'Tu enlace para entrar y elegir una contraseña nueva.',
    title: 'Recupera tu acceso',
    body: 'Recibimos una solicitud para recuperar el acceso a tu cuenta. Con este botón entras directo y podrás crear una nueva contraseña.',
    button: 'Ingresa y crea una nueva contraseña',
    ignore: 'Si no lo pediste, ignora este correo: tu contraseña actual sigue funcionando.',
    reason: 'Recibes este correo porque se pidió recuperar el acceso a una cuenta de AI Tickets con esta dirección.',
  },
  'change-password': {
    subject: 'Cambia tu contraseña de AI Tickets',
    preview: 'Tu enlace para cambiar la contraseña sin escribir la actual.',
    title: 'Cambia tu contraseña',
    body: 'Pediste cambiar la contraseña de tu cuenta. Abre este enlace y podrás elegir una nueva, sin escribir la actual.',
    button: 'Cambia tu contraseña',
    ignore: 'Si no lo pediste, ignora este correo y avísanos: tu contraseña actual sigue funcionando.',
    reason: 'Recibes este correo porque se pidió cambiar la contraseña de una cuenta de AI Tickets con esta dirección.',
  },
  login: {
    subject: 'Tu enlace para ingresar a AI Tickets',
    preview: 'Entra a tu cuenta con un clic, sin contraseña.',
    title: 'Ingresa a AI Tickets',
    body: 'Usa este botón para entrar a tu cuenta de un clic, sin contraseña.',
    button: 'Ingresar a AI Tickets',
    ignore: 'Si no lo pediste, ignora este correo: nadie puede entrar sin este enlace.',
    reason: 'Recibes este correo porque se pidió un enlace de acceso a una cuenta de AI Tickets con esta dirección.',
  },
}

/**
 * Enlace directo de acceso (vence en 30 minutos).
 * @param {{ name?: string, url: string, purpose?: 'recovery' | 'change-password' | 'login' }} opts
 */
export async function renderMagicLinkEmail({ name, url, purpose = 'login' } = {}) {
  const copy = MAGIC[purpose] || MAGIC.login
  const first = firstName(name)
  const element = h(
    EmailLayout,
    { preview: copy.preview, footer: { reason: copy.reason } },
    h(Title, null, copy.title),
    h(Paragraph, { align: 'center', muted: true }, first ? `Hola ${first}, ${copy.body.charAt(0).toLowerCase()}${copy.body.slice(1)}` : copy.body),
    h(PrimaryButton, { href: url }, copy.button),
    h(
      Panel,
      { tone: 'lime' },
      h(Paragraph, { small: true, style: { margin: 0, color: '#3f6212' } }, 'Por seguridad, el enlace vence en 30 minutos. No lo reenvíes.')
    ),
    h(Paragraph, { small: true, muted: true }, copy.ignore),
    h(FallbackLink, { href: url })
  )
  return renderEmail(copy.subject, element)
}

/**
 * Link de acceso de un asistente a "Mis entradas" (sin cuenta ni contraseña). Vence en `minutes` minutos.
 * @param {{ name?: string, url: string, minutes?: number }} opts
 */
export async function renderBuyerAccessEmail({ name, url, minutes = 60 } = {}) {
  const first = firstName(name)
  const element = h(
    EmailLayout,
    {
      preview: 'Entra a tus entradas de un clic, sin contraseña.',
      footer: { reason: 'Recibes este correo porque se pidió un link para ver las entradas de esta dirección en AI Tickets.' },
    },
    h(Title, null, 'Tus entradas en AI Tickets'),
    h(
      Paragraph,
      { align: 'center', muted: true },
      `${first ? `Hola ${first}, con` : 'Con'} este botón entras a todas tus entradas y eventos confirmados. Este dispositivo quedará con la sesión iniciada.`
    ),
    h(PrimaryButton, { href: url }, 'Ver mis entradas'),
    h(
      Panel,
      { tone: 'lime' },
      h(Paragraph, { small: true, style: { margin: 0, color: '#3f6212' } }, `Por seguridad, el link vence en ${minutes} minutos. No lo reenvíes: quien lo abra verá tus entradas.`)
    ),
    h(Paragraph, { small: true, muted: true }, 'Si no lo pediste, ignora este correo: nadie puede ver tus entradas sin este link.'),
    h(FallbackLink, { href: url })
  )
  return renderEmail('Tu link para ver tus entradas', element)
}
