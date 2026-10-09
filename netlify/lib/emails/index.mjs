// Plantillas de correo transaccional (React Email, renderizadas en el servidor).
// Cada render* es async y devuelve { subject, html, text } listo para sendEmail() de ../mailer.mjs.
// Se importan tanto desde funciones de Netlify como desde rutas de Astro. Solo servidor.
export { renderVerifyEmail, renderMagicLinkEmail } from './auth.mjs'
export { renderTicketsEmail } from './tickets.mjs'
export { renderReminderEmail, renderEventNotificationEmail, renderProducerMessageEmail, CHANGE_TYPES, NAME_PLACEHOLDER, ORDER_URL_PLACEHOLDER } from './attendees.mjs'
export {
  renderSiteContactMessageEmail,
  renderContactEmailConfirmEmail,
  renderDomainActiveEmail,
  renderDomainFailedEmail,
  renderInboundLeadConfirmEmail,
} from './producer.mjs'
export { logoUrl, siteUrl } from './layout.mjs'
