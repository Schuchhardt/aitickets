// Genera una vista previa de cada plantilla de correo (React Email) con datos de ejemplo.
// Uso: node scripts/preview-emails.mjs  -> escribe /tmp/aitickets-email-previews/*.html (y .txt)
// No envía nada ni toca la base de datos.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as emails from '../netlify/lib/emails/index.mjs'

const OUT_DIR = process.env.EMAIL_PREVIEW_DIR || '/tmp/aitickets-email-previews'
const SITE = 'https://aitickets.cl'

export const SAMPLES = {
  'verify': () => emails.renderVerifyEmail({ name: 'Camila Rojas', orgName: 'Productora Sur', url: `${SITE}/organizadores/verificar?t=ejemplo` }),
  'magic-link-recovery': () => emails.renderMagicLinkEmail({ name: 'Camila Rojas', url: `${SITE}/auth/link?t=ejemplo`, purpose: 'recovery' }),
  'magic-link-change-password': () => emails.renderMagicLinkEmail({ name: 'Camila Rojas', url: `${SITE}/auth/link?t=ejemplo`, purpose: 'change-password' }),
  'magic-link-login': () => emails.renderMagicLinkEmail({ name: 'Camila Rojas', url: `${SITE}/auth/link?t=ejemplo`, purpose: 'login' }),
  'tickets': () => emails.renderTicketsEmail({
    customerName: 'Camila',
    eventName: 'Festival de Jazz de Valparaíso',
    dateLines: [
      { date: 'sábado 12 de octubre de 2026', time: '20:00', place: 'Teatro Municipal, Av. Pedro Montt 1234, Valparaíso' },
      { date: 'domingo 13 de octubre de 2026', time: '19:00', place: 'Teatro Municipal, Av. Pedro Montt 1234, Valparaíso' },
    ],
    secretLocation: 'Bodega 7, Calle Blanco 55 (entrada por el costado)',
    ticketLines: [
      { name: 'General (sáb 12 oct · 20:00)', quantity: 2, unitPrice: 15000 },
      { name: 'VIP', quantity: 1, unitPrice: 30000 },
    ],
    subtotal: 60000,
    feeNet: 4800,
    feeIva: 912,
    fee: 5712,
    total: 65712,
    orderId: '8f2c1e4a-1234-4c1a-9e1f-0a1b2c3d4e5f',
    orderDate: '28 de septiembre de 2026, 14:32',
    orderUrl: `${SITE}/order/8f2c1e4a-1234-4c1a-9e1f-0a1b2c3d4e5f`,
    calendarUrl: 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Festival',
  }),
  'tickets-free': () => emails.renderTicketsEmail({
    customerName: 'Camila',
    eventName: 'Charla abierta',
    dateLines: [],
    ticketLines: [{ name: 'Entrada liberada', quantity: 1, unitPrice: 0 }],
    subtotal: 0,
    fee: 0,
    total: 0,
    orderId: 'a1b2c3',
    orderDate: '28 de septiembre de 2026',
    orderUrl: `${SITE}/order/a1b2c3`,
    calendarUrl: null,
  }),
  'reminder': () => emails.renderReminderEmail({ eventName: 'Festival de Jazz de Valparaíso', eventDate: 'sábado 12 de octubre de 2026', startTime: '20:00', venue: 'Teatro Municipal, Valparaíso' }),
  'event-notification': () => emails.renderEventNotificationEmail({ eventName: 'Festival de Jazz de Valparaíso', changeType: 'date_change', changeDescription: 'La función del sábado se mueve al domingo 13 a las 19:00.\nTus entradas siguen siendo válidas.', eventUrl: `${SITE}/eventos/festival-jazz` }),
  'event-cancellation': () => emails.renderEventNotificationEmail({ eventName: 'Festival de Jazz de Valparaíso', changeType: 'cancellation', changeDescription: 'El evento se cancela por razones de fuerza mayor. El organizador te reembolsará el valor de la entrada.', eventUrl: `${SITE}/eventos/festival-jazz` }),
  'site-contact-message': () => emails.renderSiteContactMessageEmail({ siteName: 'Productora Sur', contactUrl: `${SITE}/o/productora-sur/contacto`, name: 'Pedro Soto', email: 'pedro@example.com', phone: '+56 9 1234 5678', message: 'Hola, ¿tienen descuentos para grupos?\nSomos 15 personas.' }),
  'contact-email-confirm': () => emails.renderContactEmailConfirmEmail({ orgName: 'Productora Sur', url: `${SITE}/api/sites/contact-email-confirm?t=ejemplo` }),
  'domain-active': () => emails.renderDomainActiveEmail({ host: 'entradas.productorasur.cl', orgName: 'Productora Sur', dashboardUrl: `${SITE}/dashboard/sitio` }),
  'domain-failed': () => emails.renderDomainFailedEmail({ host: 'entradas.productorasur.cl', orgName: 'Productora Sur', error: 'El registro CNAME no apunta a AI Tickets.', siteUrl: `${SITE}/o/productora-sur`, dashboardUrl: `${SITE}/dashboard/sitio` }),
  'inbound-lead-confirm': () => emails.renderInboundLeadConfirmEmail({ orgName: 'Productora Sur', url: `${SITE}/api/outreach/inbound-confirm?t=ejemplo` }),
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  for (const [name, build] of Object.entries(SAMPLES)) {
    const { subject, html, text } = await build()
    await writeFile(join(OUT_DIR, `${name}.html`), html, 'utf8')
    await writeFile(join(OUT_DIR, `${name}.txt`), `Asunto: ${subject}\n\n${text}\n`, 'utf8')
    console.log(`✓ ${name.padEnd(28)} ${subject}`)
  }
  console.log(`\nVistas previas en ${OUT_DIR}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
