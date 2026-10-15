// Enlaces y textos compartidos de las landings de productores (una sola fuente: antes estaban repetidos).
// Las tarifas y plazos vienen de fees.mjs / legal.mjs: no escribir números a mano en los componentes.

export const WHATSAPP_NUMBER = '56982347140'
export const whatsappUrl = (text = 'Hola, quiero vender entradas con AI Tickets') =>
  `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`

export const DEMO_CALL_URL = 'https://calendar.app.google/CMt97vedNjzBaoEX7'

/**
 * Registro que termina en "Crear evento" (el onboarding conserva ?next=, ver src/lib/onboarding.ts).
 * campaign identifica la página/sección en GA4 y queda guardada en la cuenta (ProducerRegisterForm).
 */
export const publishUrl = (campaign = 'landing') =>
  `/organizadores/registro?next=${encodeURIComponent('/dashboard/events/create')}&utm_source=aitickets&utm_medium=landing&utm_campaign=${encodeURIComponent(campaign)}`

export const DEMO_EVENT_URL = '/eventos/evento-demo-aitickets'
