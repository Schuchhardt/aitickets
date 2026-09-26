// POST /api/webhooks/stripe — webhook de Stripe Checkout.
// - Verifica la firma (Stripe-Signature) sobre el cuerpo CRUDO (req.text()) con STRIPE_WEBHOOK_SECRET.
// - Idempotencia: cada event.id se registra en aitickets_payment_events; un duplicado responde 200 sin reprocesar.
//   Si el procesamiento pide reintento (5xx), el registro se borra para que el reintento de Stripe se procese.
//   Excepción: si la invocación anterior murió sin borrar el registro (timeout, OOM), un duplicado de un evento
//   de pago cuya orden todavía no quedó cumplida se vuelve a procesar (confirmPaidOrder es idempotente).
//   Red de seguridad adicional: el barrido de 'processing' de expire-pending-orders.
// - checkout.session.completed (payment_status 'paid') y checkout.session.async_payment_succeeded -> confirmPaidOrder.
// - checkout.session.async_payment_failed -> 'failed'; checkout.session.expired -> 'cancelled' (solo si seguía pendiente).
// - charge.refunded (reembolso total) -> orden 'refunded' + entradas anuladas + Slack. Parcial -> solo Slack.
// - charge.dispute.created -> Slack.
// - Modo prueba (livemode=false): un pago solo emite entradas del evento demo o de eventos marcados de prueba
//   (STRIPE_TEST_EVENT_SLUGS); en cualquier otro evento la orden queda en 'review' + Slack (confirmPaidOrder).
// Sin STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET responde 503 (Stripe no está configurado).
import { getSupabaseAdmin, json } from '../../lib/supabase.mjs'
import { verifyStripeWebhook, orderIdFromPaymentIntent } from '../../lib/payments/stripe.mjs'
import {
  confirmPaidOrder,
  markOrderFailed,
  markOrderRefunded,
  recordPaymentEvent,
  forgetPaymentEvent,
  loadOrder,
  UUID_RE,
} from '../../lib/orders.mjs'
import { notifySlack } from '../../lib/slack.mjs'
import { isStripeTestKey } from '../../lib/payments/mode.mjs'

const MAX_BODY_BYTES = 512 * 1024

const idOf = (v) => (typeof v === 'string' ? v : v?.id || null)

function orderIdFromSession(session) {
  const candidate = session?.client_reference_id || session?.metadata?.order_id || ''
  return UUID_RE.test(String(candidate)) ? String(candidate) : null
}

/** Busca la orden de un cargo: por payment_intent_id guardado, o por la metadata del PaymentIntent. */
async function orderIdFromCharge(supabase, charge) {
  const fromMeta = charge?.metadata?.order_id
  if (UUID_RE.test(String(fromMeta || ''))) return String(fromMeta)
  const pi = idOf(charge?.payment_intent)
  if (!pi) return null
  const { data } = await supabase.from('event_orders').select('id').eq('payment_intent_id', pi).limit(1)
  if (data?.[0]?.id) return data[0].id
  const fromPi = await orderIdFromPaymentIntent(pi)
  return UUID_RE.test(String(fromPi || '')) ? String(fromPi) : null
}

/** Comisión y neto de Stripe si el PaymentIntent viene expandido con su balance_transaction (opcional). */
function feeAndNet(session) {
  const bt = session?.payment_intent?.latest_charge?.balance_transaction
  if (bt && typeof bt === 'object') return { fee: bt.fee ?? null, net: bt.net ?? null }
  return { fee: null, net: null }
}

async function handleSessionPaid(supabase, session, livemode) {
  const orderId = orderIdFromSession(session)
  if (!orderId) {
    console.error(`Stripe: sesión ${session?.id} sin order_id válido`)
    return { httpStatus: 200, message: 'Sesión sin orden' }
  }
  const { fee, net } = feeAndNet(session)
  const result = await confirmPaidOrder(supabase, orderId, {
    provider: 'stripe',
    amount: Number(session.amount_total),
    currency: session.currency || 'clp',
    externalId: session.id,
    fee,
    net,
    method: 'stripe_card',
    paymentIntentId: idOf(session.payment_intent),
    // Pago de prueba (livemode=false): confirmPaidOrder solo lo cumple para el evento demo o los marcados de prueba
    livemode: typeof livemode === 'boolean' ? livemode : (typeof session.livemode === 'boolean' ? session.livemode : null),
  })
  return { httpStatus: result.httpStatus, message: result.message, orderId }
}

/** true si el evento confirma un cobro (lo que procesa handleSessionPaid). */
function isPaymentSuccessEvent(event) {
  const obj = event?.data?.object || {}
  if (event?.type === 'checkout.session.async_payment_succeeded') return true
  return event?.type === 'checkout.session.completed' && (obj.payment_status === 'paid' || obj.payment_status === 'no_payment_required')
}

/**
 * Evento de pago ya registrado: ¿quedó cumplida su orden? Si una invocación anterior murió a mitad del
 * cumplimiento sin borrar el registro, la orden sigue sin pagar (o pagada sin correo) y hay que reprocesarla.
 */
async function needsReprocessing(supabase, orderId) {
  if (!orderId) return false
  let order
  try {
    order = await loadOrder(supabase, orderId, 'id, status, email_sent_at')
  } catch (err) {
    console.error(`Stripe: no se pudo revisar la orden ${orderId} de un evento duplicado:`, err?.message)
    return false
  }
  if (!order) return false
  if (order.status === 'review' || order.status === 'refunded') return false
  // Pagada con correo enviado (o base sin la columna: el camino idempotente es barato igual)
  if (order.status === 'paid' && order.email_sent_at) return false
  return true
}

async function processEvent(supabase, event) {
  const obj = event?.data?.object || {}
  switch (event.type) {
    case 'checkout.session.completed':
      if (obj.payment_status === 'paid' || obj.payment_status === 'no_payment_required') return handleSessionPaid(supabase, obj, event.livemode)
      // Pago asíncrono en curso: se confirmará con async_payment_succeeded
      return { httpStatus: 200, message: 'Pago pendiente', orderId: orderIdFromSession(obj) }

    case 'checkout.session.async_payment_succeeded':
      return handleSessionPaid(supabase, obj, event.livemode)

    case 'checkout.session.async_payment_failed': {
      const orderId = orderIdFromSession(obj)
      if (orderId) await markOrderFailed(supabase, orderId, 'failed', { from: ['pending', 'processing'] })
      return { httpStatus: 200, message: 'Pago fallido', orderId }
    }

    case 'checkout.session.expired': {
      const orderId = orderIdFromSession(obj)
      if (orderId) await markOrderFailed(supabase, orderId, 'cancelled', { from: ['pending'] })
      return { httpStatus: 200, message: 'Sesión expirada', orderId }
    }

    case 'charge.refunded': {
      const orderId = await orderIdFromCharge(supabase, obj)
      const amount = Number(obj.amount_refunded) || 0
      if (!orderId) {
        await notifySlack(`💸 Stripe: reembolso de $${amount.toLocaleString('es-CL')} CLP (cargo ${obj.id}) sin orden asociada. Revisar.`)
        return { httpStatus: 200, message: 'Reembolso sin orden' }
      }
      if (obj.refunded === true) {
        const { voided } = await markOrderRefunded(supabase, orderId)
        await notifySlack(`💸 Stripe: orden ${orderId} reembolsada por completo ($${amount.toLocaleString('es-CL')} CLP). ${voided} entrada(s) anulada(s).`)
      } else {
        await notifySlack(`💸 Stripe: reembolso PARCIAL de $${amount.toLocaleString('es-CL')} CLP en la orden ${orderId} (cargo ${obj.id}). Las entradas siguen vigentes: anular manualmente si corresponde.`)
      }
      return { httpStatus: 200, message: 'Reembolso registrado', orderId }
    }

    case 'charge.dispute.created': {
      const chargeId = idOf(obj.charge)
      let orderId = null
      if (obj.payment_intent) {
        orderId = await orderIdFromCharge(supabase, { payment_intent: obj.payment_intent, metadata: {} })
      }
      await notifySlack(`🚨 Stripe: contracargo abierto por $${(Number(obj.amount) || 0).toLocaleString('es-CL')} CLP (motivo: ${obj.reason || '?'}, cargo ${chargeId || '?'}, orden ${orderId || '?'}). Responder en el dashboard de Stripe antes del plazo.`)
      return { httpStatus: 200, message: 'Disputa notificada', orderId }
    }

    default:
      return { httpStatus: 200, message: 'Evento ignorado' }
  }
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ message: 'Método no permitido' }, 405)
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('Webhook de Stripe recibido pero Stripe no está configurado')
    return json({ message: 'Stripe no configurado' }, 503)
  }

  const raw = await req.text()
  if (raw.length > MAX_BODY_BYTES) return json({ message: 'Cuerpo demasiado grande' }, 413)

  let event
  try {
    event = await verifyStripeWebhook(raw, req.headers.get('stripe-signature'))
  } catch (err) {
    console.error('Firma de webhook de Stripe inválida:', err?.message)
    return json({ message: 'Firma inválida' }, 400)
  }

  // Claves de prueba y live nunca se mezclan: un evento live con clave de prueba (o al revés) se ignora.
  const testKey = isStripeTestKey()
  if (typeof event.livemode === 'boolean' && event.livemode === testKey) {
    console.warn(`Stripe: evento ${event.id} con livemode=${event.livemode} no coincide con la clave; ignorado`)
    return json({ message: 'Modo no coincide' }, 200)
  }

  const supabase = getSupabaseAdmin()
  const obj = event?.data?.object || {}
  const hintedOrder = obj.object === 'checkout.session' ? orderIdFromSession(obj) : null
  const fresh = await recordPaymentEvent(supabase, {
    id: event.id,
    provider: 'stripe',
    type: event.type,
    orderId: hintedOrder,
    payload: { id: event.id, type: event.type, created: event.created, livemode: event.livemode, object_id: obj.id || null },
  })
  if (!fresh) {
    if (!isPaymentSuccessEvent(event) || !(await needsReprocessing(supabase, hintedOrder))) {
      return json({ message: 'Evento ya procesado' }, 200)
    }
    console.warn(`Stripe: evento ${event.id} duplicado con la orden ${hintedOrder} sin cumplir; se reprocesa`)
  }

  try {
    const result = await processEvent(supabase, event)
    if (result.httpStatus >= 500) await forgetPaymentEvent(supabase, event.id)
    return json({ message: result.message }, result.httpStatus)
  } catch (error) {
    console.error(`Error procesando evento de Stripe ${event.id} (${event.type}):`, error?.message)
    await forgetPaymentEvent(supabase, event.id)
    return json({ message: 'Error interno' }, 500)
  }
}

export const config = {
  path: ['/api/webhooks/stripe'],
}
