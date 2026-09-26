// Modo de Stripe (prueba vs live) y eventos que admiten pagos de prueba. Módulo liviano, sin dependencias
// de SDK, para que lo usen payments/index.mjs, orders.mjs (confirmPaidOrder) y el webhook de Stripe.
import { isDemoEventSlug } from '../../../src/lib/demoEvent.mjs'

/** true si la clave de Stripe es de modo prueba. */
export function isStripeTestKey(key = process.env.STRIPE_SECRET_KEY) {
  return typeof key === 'string' && /^(sk|rk)_test_/.test(key)
}

/**
 * true si se permite usar una clave de prueba: fuera del contexto Production de Netlify, o con
 * STRIPE_TEST_MODE_ALLOWED=true. Sin CONTEXT (entorno desconocido) se asume producción.
 */
export function isStripeTestModeAllowed() {
  if (process.env.STRIPE_TEST_MODE_ALLOWED === 'true') return true
  const context = process.env.CONTEXT
  return Boolean(context) && context !== 'production'
}

/** Slugs de eventos marcados de prueba (STRIPE_TEST_EVENT_SLUGS, separados por coma). */
export function stripeTestEventSlugs() {
  return (process.env.STRIPE_TEST_EVENT_SLUGS || '').split(',').map(s => s.trim()).filter(Boolean)
}

/** true si el evento admite pagos de Stripe en modo prueba: el evento demo o uno marcado de prueba. */
export function isStripeTestEligibleEvent(slug) {
  if (!slug) return false
  return isDemoEventSlug(slug) || stripeTestEventSlugs().includes(String(slug))
}
