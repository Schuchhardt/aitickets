// ¿Es de AI Tickets este evento de Stripe?
// La cuenta de Stripe es COMPARTIDA con otros negocios de Chanium, LLC: el mismo endpoint puede recibir
// sesiones, cargos y disputas que no son nuestros. Solo se procesan los objetos marcados con
// metadata.app === 'aitickets' (Checkout Session: metadata + payment_intent_data.metadata, que
// crea payments/stripe.mjs). Todo lo demás se ignora con 200 y sin tocar la base.
//
// Órdenes anteriores a la etiqueta: las sesiones creadas antes de este cambio solo traen
// metadata {order_id}. Para que sus reembolsos y contracargos sigan anulando entradas y avisando,
// un objeto SIN metadata.app (ni la suya ni la de su PaymentIntent) se acepta si event_orders tiene
// una orden payment_provider='stripe' con ese provider_session_id / payment_intent_id
// (findLegacyOrder). Un objeto marcado con otra app nunca pasa por este respaldo.

export const STRIPE_APP_TAG = 'aitickets'

/** Tipos de evento que procesa el webhook; el resto se ignora antes de registrar nada. */
export const HANDLED_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'charge.refunded',
  'charge.dispute.created',
])

const idOf = (v) => (typeof v === 'string' ? v : v?.id || null)
const isOurs = (metadata) => metadata?.app === STRIPE_APP_TAG
const isUntagged = (metadata) => metadata == null || metadata.app == null || metadata.app === ''

/**
 * Decide si el evento es de AI Tickets.
 * - checkout.session.* y payment_intent.*: metadata.app del propio objeto.
 * - charge.* y charge.dispute.*: metadata.app del cargo o, si no la trae (Checkout no copia la metadata
 *   al cargo), la del PaymentIntent (expandido en el evento o leído con loadPaymentIntentMetadata).
 * @param {object} event evento de Stripe ya verificado
 * @param {(paymentIntentId: string) => Promise<object|null>} loadPaymentIntentMetadata
 *   devuelve la metadata del PaymentIntent, null si no existe; lanza si Stripe no responde (reintento).
 * @param {(ref: {sessionId?: string|null, paymentIntentId?: string|null}) => Promise<boolean>} [findLegacyOrder]
 *   respaldo para objetos sin etiqueta: true si event_orders tiene una orden de Stripe con ese
 *   provider_session_id o payment_intent_id; lanza si la base no responde (reintento).
 * @returns {Promise<{ours: boolean, reason: string}>}
 */
export async function isAiTicketsEvent(event, loadPaymentIntentMetadata, findLegacyOrder = null) {
  const obj = event?.data?.object || {}
  const kind = obj.object

  const legacy = async (ref, notOurs) => {
    if (typeof findLegacyOrder !== 'function') return notOurs
    return (await findLegacyOrder(ref)) ? { ours: true, reason: 'orden de Stripe anterior a la etiqueta' } : notOurs
  }

  if (kind === 'checkout.session' || kind === 'payment_intent') {
    if (isOurs(obj.metadata)) return { ours: true, reason: 'metadata' }
    const notOurs = { ours: false, reason: `${kind} sin metadata.app=${STRIPE_APP_TAG}` }
    if (!isUntagged(obj.metadata) || !obj.id) return notOurs
    return legacy(kind === 'checkout.session' ? { sessionId: obj.id } : { paymentIntentId: obj.id }, notOurs)
  }

  if (kind === 'charge' || kind === 'dispute') {
    if (isOurs(obj.metadata)) return { ours: true, reason: 'metadata' }
    const chargeUntagged = isUntagged(obj.metadata)
    const pi = obj.payment_intent
    const piId = idOf(pi)
    let piMetadata
    if (pi && typeof pi === 'object' && pi.metadata) {
      piMetadata = pi.metadata
    } else {
      if (!piId) return { ours: false, reason: `${kind} sin PaymentIntent` }
      piMetadata = await loadPaymentIntentMetadata(piId)
    }
    if (isOurs(piMetadata)) return { ours: true, reason: 'payment_intent' }
    const notOurs = { ours: false, reason: 'PaymentIntent de otra app' }
    // Solo sin etiqueta en ningún lado (PaymentIntent inexistente incluido: no hay nada que ofrezca otra app).
    if (!piId || !chargeUntagged || !isUntagged(piMetadata)) return notOurs
    return legacy({ paymentIntentId: piId }, notOurs)
  }

  return { ours: false, reason: `objeto ${kind || '?'} no soportado` }
}
