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
  'producer-message': () => emails.renderProducerMessageEmail({ eventName: 'Festival de Jazz de Valparaíso', organizerName: 'Jazz Prod', subject: 'Cambio de hora', message: 'La puerta abre a las 20:00 (una hora antes).\nTrae tu QR listo.' }),
  'site-contact-message': () => emails.renderSiteContactMessageEmail({ siteName: 'Productora Sur', contactUrl: `${SITE}/o/productora-sur/contacto`, name: 'Pedro Soto', email: 'pedro@example.com', phone: '+56 9 1234 5678', message: 'Hola, ¿tienen descuentos para grupos?\nSomos 15 personas.' }),
  'contact-email-confirm': () => emails.renderContactEmailConfirmEmail({ orgName: 'Productora Sur', url: `${SITE}/api/sites/contact-email-confirm?t=ejemplo` }),
  'domain-active': () => emails.renderDomainActiveEmail({ host: 'entradas.productorasur.cl', orgName: 'Productora Sur', dashboardUrl: `${SITE}/dashboard/sitio` }),
  'domain-failed': () => emails.renderDomainFailedEmail({ host: 'entradas.productorasur.cl', orgName: 'Productora Sur', error: 'El registro CNAME no apunta a AI Tickets.', siteUrl: `${SITE}/o/productora-sur`, dashboardUrl: `${SITE}/dashboard/sitio` }),
  'inbound-lead-confirm': () => emails.renderInboundLeadConfirmEmail({ orgName: 'Productora Sur', url: `${SITE}/api/outreach/inbound-confirm?t=ejemplo` }),
  'review-request': () => emails.renderReviewRequestEmail({ eventName: 'Festival de Jazz de Valparaíso', organizerName: 'Jazz Prod', rewardLabel: '10% de descuento' }),
  'review-link': () => emails.renderReviewLinkEmail({ eventName: 'Festival de Jazz de Valparaíso', reviewUrl: `${SITE}/eventos/festival-jazz#resena=ejemplo` }),
  'review-thanks': () => emails.renderReviewThanksEmail({ eventName: 'Festival de Jazz de Valparaíso', organizerName: 'Jazz Prod', rewardCode: 'GRACIAS-7KQ2MX', rewardLabel: '10% de descuento', validUntil: 'domingo, 20 de diciembre de 2026', eventsUrl: `${SITE}/eventos` }),
  'next-event-invitation': () => emails.renderNextEventInvitationEmail({ organizerName: 'Jazz Prod', sourceEventName: 'Festival de Jazz de Valparaíso', eventName: 'Jazz bajo las estrellas', dateLabel: 'sábado, 12 de diciembre de 2026 · 21:00 hrs', venue: 'Teatro Municipal, Valparaíso', imageUrl: `${SITE}/logo-dark.png`, eventUrl: `${SITE}/eventos/jazz-estrellas?utm_source=aitickets&utm_medium=email&utm_campaign=invitacion-1`, message: '¡Gracias por venir! Te guardamos un lugar en la próxima.' }),
  'weekly-report': () => emails.renderWeeklyReportEmail({
    recipientName: 'Camila',
    orgName: 'Jazz Prod',
    weekLabel: 'del 18 al 24 de octubre',
    summary: 'Buena semana: vendiste 42 entradas, 50% más que la anterior, y Instagram explica más de la mitad de las ventas con seguimiento.',
    totals: { tickets: 42, revenue_clp: 630000, tickets_change_pct: 50, visits: 1840, best_channel: { label: 'Instagram', basis: 'sales' } },
    events: [{
      event_id: 10,
      name: 'Festival de Jazz de Valparaíso',
      dateLabel: 'sábado, 7 de noviembre de 2026, 20:00',
      daysUntil: 13,
      publicUrl: `${SITE}/eventos/festival-jazz`,
      analyticsUrl: `${SITE}/dashboard/events/10/analytics`,
      createPostUrl: `${SITE}/dashboard/promote/create?event=10`,
      week: { tickets: 42, revenue_clp: 630000 },
      tickets_change_pct: 50,
      total_tickets: 310,
      capacity: 500,
      sell_through_pct: 62,
      visits: 1840,
      conversion_pct: 2.1,
      channels: [
        { label: 'Instagram', visits: 920, tickets: 24, revenue_clp: 360000 },
        { label: 'Promotor dj-sol', visits: 0, tickets: 8, revenue_clp: 120000 },
        { label: 'Directo / sin seguimiento', visits: 780, tickets: 10, revenue_clp: 150000 },
        { label: 'Google', visits: 140, tickets: 0, revenue_clp: 0 },
      ],
      bestChannel: { label: 'Instagram', basis: 'sales', tickets: 24, visits: 920 },
      insight: 'Instagram vendió 24 de tus 42 entradas: tu público compra desde las historias.',
      suggestions: [
        { type: 'channel', title: 'Cuenta regresiva en historias', body: 'Publica una historia diaria hasta el festival con el sticker de cuenta regresiva y el link con seguimiento.', trackingUrl: `${SITE}/eventos/festival-jazz?utm_source=instagram&utm_medium=social&utm_campaign=reporte-semanal`, trackingLabel: 'Link con seguimiento para Instagram' },
        { type: 'content', title: 'Reel con el line-up', body: 'Un reel de 15 segundos con un fragmento de cada banda y el texto "Quedan 190 entradas".', action: { href: `${SITE}/dashboard/promote/create?event=10`, label: 'Crear el post con IA' }, trackingUrl: `${SITE}/eventos/festival-jazz?utm_source=instagram&utm_medium=social&utm_campaign=reporte-semanal`, trackingLabel: 'Link con seguimiento para Instagram' },
        { type: 'ads', title: 'Anuncio de $5.000 diarios', body: 'Prueba 5 días en Instagram y Facebook, a 25 km de Valparaíso y con intereses en jazz y música en vivo.', trackingUrl: `${SITE}/eventos/festival-jazz?utm_source=instagram&utm_medium=paid&utm_campaign=reporte-semanal`, trackingLabel: 'Link para tus anuncios' },
      ],
    }],
    moreEvents: 1,
    dashboardUrl: `${SITE}/dashboard`,
    unsubscribeUrl: `${SITE}/reporte-semanal/baja?t=ejemplo`,
  }),
  'weekly-report-no-sales': () => emails.renderWeeklyReportEmail({
    recipientName: '',
    orgName: 'Jazz Prod',
    weekLabel: 'del 18 al 24 de octubre',
    totals: { tickets: 0, revenue_clp: 0, tickets_change_pct: null, visits: 35, best_channel: null },
    events: [{
      event_id: 11,
      name: 'Jazz bajo las estrellas',
      dateLabel: 'sábado, 12 de diciembre de 2026, 21:00',
      daysUntil: 48,
      publicUrl: `${SITE}/eventos/jazz-estrellas`,
      analyticsUrl: `${SITE}/dashboard/events/11/analytics`,
      createPostUrl: `${SITE}/dashboard/promote/create?event=11`,
      week: { tickets: 0, revenue_clp: 0 },
      tickets_change_pct: null,
      total_tickets: 0,
      capacity: null,
      sell_through_pct: null,
      visits: 35,
      conversion_pct: 0,
      channels: [{ label: 'Directo / sin seguimiento', visits: 35, tickets: 0, revenue_clp: 0 }],
      bestChannel: null,
      insight: '',
      suggestions: [
        { type: 'offer', title: 'Activa la venta con una oferta', body: 'Crea un código con fecha límite y anúncialo en tus redes.', action: { href: `${SITE}/dashboard/descuentos`, label: 'Crear un código de descuento' } },
        { type: 'content', title: 'Crea un post para Instagram', body: 'Genera con IA un post con imagen y un llamado claro a comprar.', action: { href: `${SITE}/dashboard/promote/create?event=11`, label: 'Crear el post con IA' }, trackingUrl: `${SITE}/eventos/jazz-estrellas?utm_source=instagram&utm_medium=social&utm_campaign=reporte-semanal`, trackingLabel: 'Link con seguimiento para Instagram' },
        { type: 'ads', title: 'Prueba un anuncio chico', body: 'Invierte un monto bajo durante 3 a 5 días, segmentado cerca del lugar del evento.', trackingUrl: `${SITE}/eventos/jazz-estrellas?utm_source=instagram&utm_medium=paid&utm_campaign=reporte-semanal`, trackingLabel: 'Link para tus anuncios' },
      ],
    }],
    dashboardUrl: `${SITE}/dashboard`,
    unsubscribeUrl: `${SITE}/reporte-semanal/baja?t=ejemplo`,
  }),
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
