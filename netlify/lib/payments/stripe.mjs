// Proveedor de pago Stripe Checkout (tarjetas internacionales, Apple Pay, Google Pay).
// - Cobra en CLP, que en Stripe es moneda SIN decimales: los montos van enteros, NUNCA x100.
// - Los fondos quedan en la cuenta de plataforma (Chanium LLC). Sin Connect: los pagos a productores
//   siguen siendo manuales (event_withdrawals).
// - Cliente perezoso: sin STRIPE_SECRET_KEY este módulo no hace nada ni rompe la carga de funciones.
// - La activación (qué claves se aceptan, STRIPE_LIVE_APPROVED) se decide en payments/index.mjs.
import Stripe from 'stripe'
import { SERVICE_FEE_LABEL, SERVICE_FEE_TAX_LABEL } from '../fees.mjs'
import { LEGAL } from '../legal.mjs'

/** Marca de propiedad: la cuenta de Stripe es compartida por Chanium; el webhook ignora lo que no la trae. */
export const STRIPE_APP_TAG = 'aitickets'

/** Versión de la API fijada (la del SDK instalado); se puede sobrescribir con STRIPE_API_VERSION. */
export const STRIPE_DEFAULT_API_VERSION = '2026-08-26.dahlia'
/** Stripe exige expires_at >= 30 minutos desde la creación de la sesión. */
export const STRIPE_MIN_HOLD_MINUTES = 31
/** Mínimo cobrable aproximado (Stripe exige ~0,50 USD). Configurable con STRIPE_MIN_AMOUNT_CLP. */
export const STRIPE_MIN_AMOUNT_CLP = 600

let client = null
let clientKey = null

export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('Falta STRIPE_SECRET_KEY')
  if (client && clientKey === key) return client
  client = new Stripe(key, {
    apiVersion: process.env.STRIPE_API_VERSION || STRIPE_DEFAULT_API_VERSION,
    maxNetworkRetries: 2,
    timeout: 20000,
    appInfo: { name: 'AI Tickets', url: 'https://aitickets.cl' },
  })
  clientKey = key
  return client
}

export function stripeMinAmount() {
  const n = Number.parseInt(process.env.STRIPE_MIN_AMOUNT_CLP || '', 10)
  return Number.isInteger(n) && n > 0 ? n : STRIPE_MIN_AMOUNT_CLP
}

/**
 * Líneas de cargo por servicio para Stripe: [{name, amount}] (montos enteros CLP > 0).
 * Prefiere feeNet/feeIva; si no vienen usa los de la orden; como último recurso, `fee` en una sola línea.
 */
export function stripeFeeItems({ order = {}, fee, feeNet, feeIva } = {}) {
  const net = Math.round(Number(feeNet ?? order.ticket_fee) || 0)
  const iva = Math.round(Number(feeIva ?? order.service_fee_tax) || 0)
  if (net > 0 || iva > 0) {
    const items = []
    if (net > 0) items.push({ name: SERVICE_FEE_LABEL, amount: net })
    if (iva > 0) items.push({ name: SERVICE_FEE_TAX_LABEL, amount: iva })
    return items
  }
  const total = Math.round(Number(fee) || 0)
  return total > 0 ? [{ name: 'Cargo por servicio', amount: total }] : []
}

const clip = (value, max) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)

/**
 * Crea la Checkout Session de una orden pendiente.
 * @param {{
 *   order: {id: string, ticket_fee?: number, service_fee_tax?: number},
 *   eventName: string,
 *   lines: Array<{id:number, name:string, price:number, quantity:number}>,
 *   fee?: number,      cargo total (neto + IVA); solo se usa si no vienen feeNet/feeIva
 *   feeNet?: number,   cargo por servicio neto (10% del subtotal)
 *   feeIva?: number,   IVA (19%) del cargo
 *   buyerEmail: string,
 *   holdMinutes: number,
 *   siteUrl: string,
 * }} args
 * @returns {Promise<{redirectUrl: string, externalId: string, sessionId: string}>}
 */
export async function createStripeCheckout({ order, eventName, lines, fee, feeNet, feeIva, buyerEmail, holdMinutes, siteUrl }) {
  const stripe = getStripe()
  const base = String(siteUrl || process.env.SITE_URL || 'https://aitickets.cl').replace(/\/$/, '')
  const orderId = String(order.id)

  // Stripe no acepta líneas de monto 0 en modo payment: las entradas gratis de una orden mixta se omiten
  // (no cambian el total). CLP es zero-decimal: unit_amount es el precio entero en pesos.
  const lineItems = (lines || [])
    .filter(l => Math.round(Number(l.price) || 0) > 0 && Number(l.quantity) > 0)
    .map(l => ({
      price_data: {
        currency: 'clp',
        unit_amount: Math.round(Number(l.price)),
        product_data: { name: clip(`${l.name || 'Entrada'} · ${eventName}`, 250) },
      },
      quantity: Number(l.quantity),
    }))
  // Cargo por servicio y su IVA en líneas separadas: la suma de line_items es exactamente el total de la orden
  // (amount + ticket_fee + service_fee_tax), que es lo que verifica confirmPaidOrder.
  for (const item of stripeFeeItems({ order, fee, feeNet, feeIva })) {
    lineItems.push({
      price_data: { currency: 'clp', unit_amount: item.amount, product_data: { name: item.name } },
      quantity: 1,
    })
  }
  if (!lineItems.length) throw new Error('La orden no tiene montos cobrables para Stripe')

  const minutes = Math.max(STRIPE_MIN_HOLD_MINUTES, Number(holdMinutes) || 0)
  const q = `order=${encodeURIComponent(orderId)}&provider=stripe`
  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      currency: 'clp',
      line_items: lineItems,
      customer_email: buyerEmail || undefined,
      client_reference_id: orderId,
      metadata: { app: STRIPE_APP_TAG, order_id: orderId },
      payment_intent_data: {
        metadata: { app: STRIPE_APP_TAG, order_id: orderId },
        statement_descriptor_suffix: LEGAL.stripeStatementDescriptorSuffix || undefined,
        description: clip(`AI Tickets · ${eventName} · orden ${orderId}`, 1000),
      },
      locale: 'es-419',
      expires_at: Math.floor(Date.now() / 1000) + minutes * 60,
      success_url: `${base}/pago/retorno?${q}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/pago/retorno?${q}&cancelled=1`,
    },
    { idempotencyKey: `order-${orderId}` },
  )
  if (!session?.url || !session?.id) throw new Error('Stripe no devolvió la URL de Checkout')
  return { redirectUrl: session.url, externalId: session.id, sessionId: session.id }
}

/**
 * Verifica la firma de un webhook (Stripe-Signature) sobre el cuerpo CRUDO de la request.
 * Lanza si la firma no es válida o falta STRIPE_WEBHOOK_SECRET.
 */
export async function verifyStripeWebhook(rawBody, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) throw new Error('Falta STRIPE_WEBHOOK_SECRET')
  if (!signature) throw new Error('Falta la cabecera Stripe-Signature')
  return getStripe().webhooks.constructEventAsync(rawBody, signature, secret)
}

/** Recupera una Checkout Session (con el PaymentIntent expandido). */
export async function retrieveStripeSession(sessionId) {
  return getStripe().checkout.sessions.retrieve(String(sessionId), { expand: ['payment_intent'] })
}

/**
 * Expira una Checkout Session abierta (al liberar la reserva de stock). Nunca lanza.
 * @returns {Promise<'expired'|'not_open'|'error'>}
 */
export async function expireStripeSession(sessionId) {
  if (!sessionId || !process.env.STRIPE_SECRET_KEY) return 'error'
  try {
    await getStripe().checkout.sessions.expire(String(sessionId))
    return 'expired'
  } catch (err) {
    // Ya completada o ya expirada: Stripe responde 400; no es un error para nosotros.
    if (err?.statusCode === 400 || err?.type === 'StripeInvalidRequestError') return 'not_open'
    console.error(`No se pudo expirar la sesión de Stripe ${sessionId}:`, err?.message)
    return 'error'
  }
}

/** order_id de un PaymentIntent (metadata puesta en payment_intent_data). Nunca lanza. */
export async function orderIdFromPaymentIntent(paymentIntentId) {
  if (!paymentIntentId) return null
  try {
    const pi = await getStripe().paymentIntents.retrieve(String(paymentIntentId))
    return pi?.metadata?.order_id || null
  } catch (err) {
    console.error(`No se pudo leer el PaymentIntent ${paymentIntentId}:`, err?.message)
    return null
  }
}
