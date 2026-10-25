// Correos a productoras: mensaje del formulario de contacto de su sitio, mensaje de un asistente desde su
// orden, confirmación del correo de contacto, estado del dominio propio y doble opt-in del formulario /web-gratis.
import { Link } from '@react-email/components'
import { h, str, safeHref, multiline, COLORS, EmailLayout, Title, Paragraph, Badge, PrimaryButton, Panel, KeyValueTable, FallbackLink, renderEmail } from './layout.mjs'

const oneLine = (v) => str(v).replace(/[\r\n]+/g, ' ').trim()
const linkStyle = { color: COLORS.text, fontWeight: 600, textDecoration: 'underline' }

/**
 * Mensaje recibido en el formulario de contacto del sitio del productor (Reply-To = visitante).
 * @param {{ siteName?: string, contactUrl?: string, name: string, email: string, phone?: string | null, message: string }} opts
 */
export async function renderSiteContactMessageEmail({ siteName, contactUrl, name, email, phone, message } = {}) {
  const visitor = oneLine(name) || 'Un visitante'
  const site = oneLine(siteName) || 'tu sitio'
  const contactHref = safeHref(contactUrl)
  const mail = oneLine(email)
  const subject = `Nuevo mensaje de ${visitor.slice(0, 80)} desde tu sitio`
  const element = h(
    EmailLayout,
    {
      preview: `${visitor} te escribió desde ${site}.`,
      footer: { reason: 'Recibes este correo porque alguien usó el formulario de contacto de tu sitio en AI Tickets.' },
    },
    h(Badge, null, 'Nuevo mensaje'),
    h(Title, null, 'Te escribieron desde tu sitio'),
    h(
      Paragraph,
      { align: 'center', muted: true },
      site,
      contactHref ? ' · ' : '',
      contactHref ? h(Link, { href: contactHref, style: { color: COLORS.muted, textDecoration: 'underline' } }, contactHref) : null
    ),
    h(
      Panel,
      { tone: 'outline' },
      h(KeyValueTable, {
        rows: [
          { label: 'Nombre', value: visitor, align: 'left' },
          { label: 'Correo', value: mail ? h(Link, { href: `mailto:${mail}`, style: linkStyle }, mail) : '', align: 'left' },
          { label: 'Teléfono', value: oneLine(phone), align: 'left' },
        ],
      })
    ),
    h(Panel, { label: 'Mensaje' }, h(Paragraph, { style: { margin: 0 } }, multiline(message))),
    h(Paragraph, { small: true, muted: true, align: 'center', style: { margin: 0 } }, `Responde este correo para contestarle directamente a ${visitor}.`)
  )
  return renderEmail(subject, element)
}

/**
 * Mensaje de un asistente (con entrada vigente) desde la página de su orden (Reply-To = asistente).
 * @param {{ eventName?: string, name?: string, email: string, ticketsLabel?: string, message: string, dashboardUrl?: string }} opts
 */
export async function renderAttendeeMessageEmail({ eventName, name, email, ticketsLabel, message, dashboardUrl } = {}) {
  const who = oneLine(name) || 'Un asistente'
  const event = oneLine(eventName) || 'tu evento'
  const mail = oneLine(email)
  const subject = `💬 ${who.slice(0, 60)} te escribió sobre ${event.slice(0, 80)}`
  const element = h(
    EmailLayout,
    {
      preview: `${who} tiene una pregunta sobre ${event}.`,
      footer: { reason: 'Recibes este correo porque alguien con entrada para tu evento te escribió desde AI Tickets.' },
    },
    h(Badge, null, 'Mensaje de un asistente'),
    h(Title, null, event),
    h(
      Panel,
      { tone: 'outline' },
      h(KeyValueTable, {
        rows: [
          { label: 'Nombre', value: who, align: 'left' },
          { label: 'Correo', value: mail ? h(Link, { href: `mailto:${mail}`, style: linkStyle }, mail) : '', align: 'left' },
          { label: 'Entradas', value: oneLine(ticketsLabel), align: 'left' },
        ],
      })
    ),
    h(Panel, { label: 'Mensaje' }, h(Paragraph, { style: { margin: 0 } }, multiline(message))),
    h(Paragraph, { small: true, muted: true, align: 'center' }, `Responde este correo para contestarle directamente a ${who}.`),
    safeHref(dashboardUrl) ? h(PrimaryButton, { href: dashboardUrl }, 'Ver mensajes en el panel') : null
  )
  return renderEmail(subject, element)
}

/**
 * Confirmación del correo que recibirá los mensajes del formulario de contacto del sitio (48 h).
 * @param {{ orgName?: string, url: string }} opts
 */
export async function renderContactEmailConfirmEmail({ orgName, url } = {}) {
  const org = oneLine(orgName) || 'Una productora'
  const subject = 'Confirma el correo de contacto de tu sitio en AI Tickets'
  const element = h(
    EmailLayout,
    {
      preview: 'Confirma esta dirección para recibir los mensajes de tu sitio web.',
      footer: { reason: 'Recibes este correo porque alguien escribió esta dirección como correo de contacto de un sitio en AI Tickets.' },
    },
    h(Title, null, 'Confirma el correo de contacto de tu sitio'),
    h(
      Paragraph,
      { align: 'center', muted: true },
      `${org} quiere recibir en esta dirección los mensajes del formulario de contacto de su sitio web en AI Tickets. Si fuiste tú, confírmalo:`
    ),
    h(PrimaryButton, { href: url }, 'Confirmar este correo'),
    h(Paragraph, { small: true, muted: true }, 'El enlace vence en 48 horas. Si no lo pediste, ignora este correo: no recibirás mensajes.'),
    h(FallbackLink, { href: url })
  )
  return renderEmail(subject, element)
}

const DOMAIN_REASON = 'Recibes este correo porque conectaste un dominio a tu sitio web en AI Tickets.'

/**
 * @param {{ host: string, orgName?: string, dashboardUrl: string }} opts
 */
export async function renderDomainActiveEmail({ host, orgName, dashboardUrl } = {}) {
  const domain = oneLine(host)
  const url = `https://${domain}`
  const subject = `Tu dominio ${domain} ya está activo`
  const element = h(
    EmailLayout,
    { preview: `Tu sitio ya se ve en ${url}, con HTTPS.`, footer: { reason: DOMAIN_REASON } },
    h(Badge, null, 'Dominio activo'),
    h(Title, null, `Tu dominio ${domain} ya está activo`),
    h(Paragraph, null, `Hola ${oneLine(orgName) || 'equipo'}:`),
    h(
      Paragraph,
      null,
      'Tu sitio web ya se ve en ',
      h(Link, { href: safeHref(url), style: linkStyle }, url),
      ', con certificado de seguridad (HTTPS).'
    ),
    h(
      Panel,
      { tone: 'warn', label: 'Importante' },
      h(Paragraph, { small: true, style: { margin: 0 } }, 'No borres ni cambies el registro DNS que configuraste: si deja de apuntar a AI Tickets por más de 72 horas, desconectaremos el dominio.')
    ),
    h(PrimaryButton, { href: dashboardUrl }, 'Ir a mi sitio web')
  )
  return renderEmail(subject, element)
}

/**
 * @param {{ host: string, orgName?: string, error?: string, siteUrl: string, dashboardUrl: string }} opts
 */
export async function renderDomainFailedEmail({ host, orgName, error, siteUrl, dashboardUrl } = {}) {
  const domain = oneLine(host)
  const fallback = safeHref(siteUrl)
  const subject = `No pudimos conectar ${domain}`
  const element = h(
    EmailLayout,
    { preview: `Revisa la configuración DNS de ${domain}.`, footer: { reason: DOMAIN_REASON } },
    h(Badge, { tone: 'danger' }, 'Dominio sin conectar'),
    h(Title, null, `No pudimos conectar ${domain}`),
    h(Paragraph, null, `Hola ${oneLine(orgName) || 'equipo'}:`),
    h(Panel, { label: 'Qué pasó' }, h(Paragraph, { style: { margin: 0 } }, oneLine(error) || 'No pudimos verificar tu dominio.')),
    h(
      Paragraph,
      null,
      'Tu sitio sigue disponible en ',
      fallback ? h(Link, { href: fallback, style: linkStyle }, fallback) : 'AI Tickets',
      '. Puedes volver a intentarlo desde el dashboard cuando el DNS esté listo.'
    ),
    h(PrimaryButton, { href: dashboardUrl }, 'Revisar mi dominio')
  )
  return renderEmail(subject, element)
}

/**
 * Doble opt-in del formulario /web-gratis (72 h).
 * @param {{ orgName?: string, url: string }} opts
 */
export async function renderInboundLeadConfirmEmail({ orgName, url } = {}) {
  const org = oneLine(orgName) || 'tu productora'
  const subject = 'Confirma tu correo para tu web de eventos gratis'
  const element = h(
    EmailLayout,
    {
      preview: `Confirma tu correo para seguir con la web de eventos de ${org}.`,
      footer: {
        reason: 'Recibes este correo porque alguien ingresó esta dirección en el formulario de aitickets.cl/web-gratis. Si no fuiste tú, ignóralo: no guardaremos tu correo para contactarte.',
      },
    },
    h(Badge, null, 'Web de eventos gratis'),
    h(Title, null, 'Confirma tu correo'),
    h(
      Paragraph,
      { align: 'center', muted: true },
      'Recibimos una solicitud para crear la web de eventos gratis de ',
      h('strong', { style: { color: COLORS.text } }, org),
      ' en AI Tickets. Para continuar, confirma que este correo es tuyo:'
    ),
    h(PrimaryButton, { href: url }, 'Confirmar mi correo'),
    h(Paragraph, { small: true, muted: true }, 'El enlace vence en 72 horas.'),
    h(FallbackLink, { href: url })
  )
  return renderEmail(subject, element)
}

const PAYOUT_REASON = 'Recibes este correo porque tu productora pidió un retiro de su saldo en AI Tickets.'
const clpText = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CL')} CLP`
const longDate = (iso) => {
  const d = iso ? new Date(iso) : new Date()
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * Aviso al productor: AI Tickets transfirió su retiro. Nunca lleva el número de cuenta completo.
 * @param {{ orgName?: string | null, amount: number, bank?: string | null, last4?: string | null, reference: string, paidAt?: string | null, dashboardUrl: string }} opts
 */
export async function renderPayoutPaidEmail({ orgName, amount, bank, last4, reference, paidAt, dashboardUrl } = {}) {
  const amountText = clpText(amount)
  const subject = `Transferimos tu retiro de ${amountText}`
  const account = [oneLine(bank), last4 ? `terminada en ${oneLine(last4)}` : ''].filter(Boolean).join(' ')
  const element = h(
    EmailLayout,
    { preview: `AI Tickets transfirió ${amountText} a tu cuenta.`, footer: { reason: PAYOUT_REASON } },
    h(Badge, null, 'Retiro transferido'),
    h(Title, null, `Transferimos ${amountText}`),
    h(Paragraph, null, `Hola ${oneLine(orgName) || 'equipo'}:`),
    h(Paragraph, null, 'Ya hicimos la transferencia de tu retiro. Según tu banco, puede tardar hasta un día hábil en verse en tu cuenta.'),
    h(
      Panel,
      { tone: 'outline' },
      h(KeyValueTable, {
        rows: [
          { label: 'Monto', value: amountText },
          { label: 'Cuenta', value: account },
          { label: 'Fecha', value: longDate(paidAt) },
          { label: 'N° de comprobante', value: oneLine(reference) },
        ],
      })
    ),
    h(PrimaryButton, { href: dashboardUrl }, 'Ver mis ingresos'),
    h(Paragraph, { small: true, muted: true }, 'Si no ves la transferencia en 2 días hábiles, responde este correo con el n° de comprobante.')
  )
  return renderEmail(subject, element)
}

/**
 * Aviso al productor: un retiro no se pudo transferir; el monto vuelve a su saldo disponible.
 * @param {{ orgName?: string | null, amount: number, reason: string, dashboardUrl: string }} opts
 */
export async function renderPayoutFailedEmail({ orgName, amount, reason, dashboardUrl } = {}) {
  const amountText = clpText(amount)
  const subject = `No pudimos transferir tu retiro de ${amountText}`
  const element = h(
    EmailLayout,
    { preview: 'El monto volvió a tu saldo disponible.', footer: { reason: PAYOUT_REASON } },
    h(Badge, { tone: 'danger' }, 'Retiro sin transferir'),
    h(Title, null, `No pudimos transferir ${amountText}`),
    h(Paragraph, null, `Hola ${oneLine(orgName) || 'equipo'}:`),
    h(Panel, { label: 'Qué pasó' }, h(Paragraph, { style: { margin: 0 } }, oneLine(reason) || 'La transferencia no se pudo completar.')),
    h(Paragraph, null, 'El monto volvió a tu saldo disponible. Revisa tus datos bancarios y vuelve a pedir el retiro cuando estén listos.'),
    h(PrimaryButton, { href: dashboardUrl }, 'Revisar mis datos bancarios')
  )
  return renderEmail(subject, element)
}
