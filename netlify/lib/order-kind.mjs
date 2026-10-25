// Tipo de una orden para el lenguaje que ve el asistente (correo de entradas, /order, /ticket, Mis entradas).
// Lo comparten las Netlify Functions y las páginas de Astro. Lógica pura.
//
// - 'rsvp':     evento gratis, solo confirma asistencia (todas las líneas a $0, sin descuento). No es una compra:
//               no se habla de pago, total ni comprobante.
// - 'courtesy': invitación de la productora (payment_provider 'courtesy' o línea complimentary).
// - 'transfer': entrada que otro titular le transfirió (todas sus líneas traen transferred_from_order).
// - 'purchase': compra (incluye las que quedaron en $0 por un código de 100%: sí hubo precio de lista).

const lines = (order) => (Array.isArray(order?.ticket_details) ? order.ticket_details : [])

/** @returns {'rsvp' | 'courtesy' | 'transfer' | 'purchase'} */
export function orderKind(order) {
  if (!order) return 'purchase'
  const ls = lines(order)
  if (ls.length > 0 && ls.every((l) => l?.transferred_from_order)) return 'transfer'
  if (order.payment_provider === 'courtesy' || ls.some((l) => l?.complimentary)) return 'courtesy'
  const discounted = (Number(order.discount_amount) || 0) > 0
  const paid = Number(order.total_payment ?? order.amount) || 0
  if (discounted || paid > 0) return 'purchase'
  // Precio de lista: si alguna línea tenía precio, fue una compra (aunque terminara en $0)
  if (ls.length > 0) return ls.every((l) => !(Number(l?.price) > 0)) ? 'rsvp' : 'purchase'
  return order.payment_provider === 'free' ? 'rsvp' : 'purchase'
}

/** ¿El asistente pagó algo? (las gratis, cortesías y transferencias no muestran comprobante) */
export const isPaidKind = (kind) => kind === 'purchase'

/**
 * Textos por tipo de orden. `count` = entradas vigentes de la orden.
 * @param {'rsvp' | 'courtesy' | 'transfer' | 'purchase'} kind
 */
export function orderCopy(kind, count = 1) {
  const many = Number(count) > 1
  const entradas = many ? 'tus entradas' : 'tu entrada'
  switch (kind) {
    case 'rsvp':
      return {
        badge: 'Asistencia confirmada',
        headline: many ? `Confirmaste ${count} lugares` : 'Tu asistencia está confirmada',
        ticketsTitle: many ? `Tus ${count} entradas` : 'Tu entrada',
        dateLabel: 'Confirmaste el',
        cta: many ? 'Ver mis entradas (QR)' : 'Ver mi entrada (QR)',
        entradas,
      }
    case 'courtesy':
      return {
        badge: 'Invitación',
        headline: many ? `Tienes ${count} invitaciones` : 'Tienes una invitación',
        ticketsTitle: many ? `Tus ${count} entradas` : 'Tu entrada',
        dateLabel: 'Emitida el',
        cta: many ? 'Ver mis entradas (QR)' : 'Ver mi entrada (QR)',
        entradas,
      }
    case 'transfer':
      return {
        badge: 'Entrada transferida',
        headline: many ? `Te transfirieron ${count} entradas` : 'Te transfirieron una entrada',
        ticketsTitle: many ? `Tus ${count} entradas` : 'Tu entrada',
        dateLabel: 'Recibida el',
        cta: many ? 'Ver mis entradas (QR)' : 'Ver mi entrada (QR)',
        entradas,
      }
    default:
      return {
        badge: 'Compra confirmada',
        headline: many ? `Tus ${count} entradas están listas` : 'Tu entrada está lista',
        ticketsTitle: many ? `Tus ${count} entradas` : 'Tu entrada',
        dateLabel: 'Comprada el',
        cta: 'Ver mis entradas (QR)',
        entradas,
      }
  }
}

/** Referencia corta de una orden para mostrar ("8F2C1E4A"); el uuid completo va en el link. */
export const shortOrderRef = (id) => String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase()
