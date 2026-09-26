// Base de conocimiento comercial: lo ÚNICO que el outreach (humano o IA) puede afirmar sobre la oferta.
// compose.mjs y classify.mjs la usan como contexto, y validateOutgoing() rechaza cualquier porcentaje o
// monto que no aparezca aquí. Si cambia la oferta, cambia este archivo (y la landing /organizadores).
//
// TODO(dueño): aprobar cada punto marcado `approved: false` antes de activar OUTREACH_AUTO_REPLY.
// Mientras un punto no esté aprobado, se incluye en los borradores para Slack pero no en respuestas automáticas.

export const SALES_KB = Object.freeze({
  product: 'AI Tickets, plataforma de venta de entradas para productores de eventos (servicio de Chanium LLC).',
  facts: Object.freeze([
    { key: 'producer_fee', approved: true, text: 'El productor paga 0% de comisión.' },
    { key: 'buyer_fee', approved: true, text: 'El comprador paga un cargo por servicio de 10% sobre el valor de la entrada.' },
    { key: 'payouts', approved: true, text: 'Transferimos lo recaudado al productor 48 a 72 horas después de cada función.' },
    { key: 'payments', approved: true, text: 'Los compradores pagan con Webpay y tarjetas.' },
    { key: 'free_site', approved: true, text: 'Cada productor tiene una web de eventos gratis en aitickets.cl/o/<nombre-de-tu-productora>, lista al registrarse.' },
    { key: 'custom_domain', approved: false, text: 'Puedes conectar tu propio dominio a la web (sin costo adicional).' },
    { key: 'templates', approved: true, text: 'La web tiene plantillas, banner principal, formulario de contacto y la cartelera de tus eventos con venta de entradas integrada.' },
    { key: 'free_events', approved: true, text: 'Los eventos gratuitos no tienen costo.' },
    { key: 'checkin', approved: true, text: 'Incluye entradas con QR y check-in desde el celular.' },
    { key: 'no_contract', approved: false, text: 'No hay contrato de permanencia ni costo mensual.' },
  ]),
  // Números permitidos en correos (porcentajes y plazos). Cualquier otro número con % o $ se rechaza.
  allowedPercentages: Object.freeze(['0%', '10%']),
  allowedHourRanges: Object.freeze(['48', '72']),
  signupPath: '/organizadores/registro',
  landingPath: '/web-gratis',
})

/** Texto de la KB para el prompt. `approvedOnly` = solo hechos aprobados (respuestas automáticas). */
export function salesKbText({ approvedOnly = false } = {}) {
  return SALES_KB.facts
    .filter((f) => !approvedOnly || f.approved)
    .map((f) => `- ${f.text}`)
    .join('\n')
}
