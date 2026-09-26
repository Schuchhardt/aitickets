// Abstracción de proveedores de pago. Flow (Webpay) es el medio por defecto; Stripe Checkout es un
// segundo medio opcional para tarjetas internacionales / Apple Pay / Google Pay.
//
// Stripe se habilita SOLO si se cumplen las tres condiciones (si no, el checkout es idéntico al de hoy):
//   1. STRIPE_SECRET_KEY está configurada,
//   2. 'stripe' aparece en PAYMENT_PROVIDERS (lista separada por comas; por defecto 'flow'),
//   3. clave live (sk_live_/rk_live_) con STRIPE_LIVE_APPROVED=true, o clave de prueba (sk_test_/rk_test_)
//      fuera del contexto Production de Netlify (CONTEXT !== 'production') o con STRIPE_TEST_MODE_ALLOWED=true.
// Motivo del punto 3: cobrar con Stripe fondos que pertenecen a terceros (productores) sin Connect
// requiere que el dueño lo confirme con Stripe (términos de servicio). Hasta entonces, solo modo prueba.
// Configura las claves live solo en el contexto Production de Netlify (los deploy previews no son confiables).
//
// Modo prueba: los deploy previews comparten la base de producción, así que un pago de prueba NUNCA puede
// emitir entradas de un evento real. Con clave de prueba, Stripe solo se ofrece/acepta para el evento demo
// (src/lib/demoEvent.mjs) o los eventos marcados de prueba (slugs en STRIPE_TEST_EVENT_SLUGS); el webhook y
// confirmPaidOrder mandan a 'review' cualquier pago livemode=false de otro evento.
import { createFlowCheckout } from './flow.mjs'
import { createStripeCheckout, STRIPE_MIN_HOLD_MINUTES } from './stripe.mjs'
import { isStripeTestKey, isStripeTestModeAllowed, isStripeTestEligibleEvent, stripeTestEventSlugs } from './mode.mjs'

export { isStripeTestKey, isStripeTestModeAllowed, isStripeTestEligibleEvent, stripeTestEventSlugs }

export const PROVIDERS = Object.freeze(['flow', 'stripe'])
export const FLOW_HOLD_MINUTES = 15

function listedProviders() {
  const raw = process.env.PAYMENT_PROVIDERS || 'flow'
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}

/** Stripe habilitado según las tres condiciones del encabezado. */
export function isStripeEnabled() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return false
  if (!listedProviders().includes('stripe')) return false
  if (isStripeTestKey(key)) return isStripeTestModeAllowed()
  return process.env.STRIPE_LIVE_APPROVED === 'true'
}

/**
 * true si Stripe puede cobrar la compra de este evento. Con clave de prueba solo el evento demo o los
 * marcados de prueba (un pago de prueba no puede emitir entradas reales).
 */
export function isStripeAllowedForEvent(slug) {
  if (!isStripeEnabled()) return false
  return !isStripeTestKey() || isStripeTestEligibleEvent(slug)
}

/**
 * Proveedores disponibles para el comprador, en orden de preferencia. Flow siempre va primero
 * (medio por defecto) salvo que PAYMENT_PROVIDERS lo excluya explícitamente y Stripe esté habilitado.
 * Con `eventSlug`, Stripe en modo prueba solo aparece si el evento lo admite (isStripeAllowedForEvent).
 * @param {{eventSlug?: string|null}} [opts]
 * @returns {string[]}
 */
export function enabledProviders({ eventSlug } = {}) {
  const listed = listedProviders()
  const stripe = eventSlug === undefined ? isStripeEnabled() : isStripeAllowedForEvent(eventSlug)
  const out = []
  if (listed.includes('flow') || !stripe) out.push('flow')
  if (stripe) out.push('stripe')
  return out
}

export function defaultProvider(opts) {
  return enabledProviders(opts)[0] || 'flow'
}

/** Minutos de reserva de stock por proveedor (Stripe: sesión mínima de 30 min + margen). */
export function holdMinutesFor(provider) {
  if (provider === 'stripe') {
    const n = Number.parseInt(process.env.STRIPE_HOLD_MINUTES || '', 10)
    return Number.isInteger(n) && n >= STRIPE_MIN_HOLD_MINUTES ? Math.min(n, 24 * 60) : STRIPE_MIN_HOLD_MINUTES
  }
  return FLOW_HOLD_MINUTES
}

/**
 * Crea el checkout del proveedor para una orden pendiente ya reservada.
 * @param {'flow'|'stripe'} provider
 * @param {{order:{id:string}, eventName:string, lines:Array<{id:number,name:string,price:number,quantity:number}>,
 *          ticketQty:number, subtotal:number, fee:number, total:number, buyerEmail:string, siteUrl:string, holdMinutes:number}} args
 * @returns {Promise<{redirectUrl:string, externalId:string|null, sessionId?:string|null}>}
 */
export async function createCheckout(provider, args) {
  if (provider === 'stripe') {
    if (!isStripeEnabled()) throw new Error('Stripe no está habilitado')
    return createStripeCheckout(args)
  }
  if (provider === 'flow') return createFlowCheckout(args)
  throw new Error(`Proveedor de pago desconocido: ${provider}`)
}
