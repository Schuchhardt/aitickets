// Conciliación con el proveedor de pago: consulta el estado real del cobro y, si está pagado, cumple la
// orden con confirmPaidOrder (idempotente). Lo usa expire-pending-orders para:
//   - no expirar una orden de Stripe cuya sesión ya se cobró (el webhook se atrasó o falló), y
//   - retomar órdenes 'processing' abandonadas (la invocación murió por timeout/OOM a mitad del cumplimiento).
// Nunca lanza: los errores se devuelven como { outcome: 'error' }.
import { confirmPaidOrder } from '../orders.mjs'
import { retrieveStripeSession } from './stripe.mjs'
import { getFlowPaymentStatusByCommerceId, isFlowConfigured, FLOW_STATUS } from './flow.mjs'

const idOf = (v) => (typeof v === 'string' ? v : v?.id || null)

/** Datos de pago de una Checkout Session de Stripe para confirmPaidOrder. */
export function stripeSessionPayment(session) {
  const bt = session?.payment_intent?.latest_charge?.balance_transaction
  const hasBt = bt && typeof bt === 'object'
  return {
    provider: 'stripe',
    amount: Number(session?.amount_total),
    currency: session?.currency || 'clp',
    externalId: session?.id || null,
    fee: hasBt ? bt.fee ?? null : null,
    net: hasBt ? bt.net ?? null : null,
    method: 'stripe_card',
    paymentIntentId: idOf(session?.payment_intent),
    livemode: typeof session?.livemode === 'boolean' ? session.livemode : null,
  }
}

/** Datos de pago de una respuesta de Flow (getStatus*) para confirmPaidOrder. */
export function flowStatusPayment(payment) {
  const paymentData = payment?.paymentData || {}
  return {
    provider: 'flow',
    amount: Number(payment?.amount),
    currency: payment?.currency || 'CLP',
    externalId: payment?.flowOrder != null ? String(payment.flowOrder) : null,
    fee: (Number.parseInt(paymentData.fee, 10) || 0) + (Number.parseInt(paymentData.taxes, 10) || 0),
    net: paymentData.balance != null ? Math.round(Number(paymentData.balance)) : null,
    method: paymentData.media || null,
  }
}

/**
 * Concilia una orden de Stripe con su Checkout Session.
 * @returns {Promise<{outcome:'confirmed'|'retry'|'payment_pending'|'session_expired'|'open'|'unverifiable'|'error', result?:object, message?:string}>}
 *   confirmed: estaba cobrada y confirmPaidOrder la dejó pagada/en revisión.
 *   retry: estaba cobrada pero confirmPaidOrder pidió reintento (otra invocación la procesa o falló el correo).
 *   payment_pending: sesión completada con pago asíncrono en curso (llegará async_payment_succeeded/failed).
 *   session_expired: la sesión expiró sin cobro (se puede liberar la reserva).
 *   open: la sesión sigue abierta (aún se podría pagar).
 */
export async function reconcileStripeOrder(supabase, order) {
  if (!process.env.STRIPE_SECRET_KEY || !order?.provider_session_id) return { outcome: 'unverifiable' }
  let session
  try {
    session = await retrieveStripeSession(order.provider_session_id)
  } catch (err) {
    return { outcome: 'error', message: err?.message }
  }
  const paid = session?.payment_status === 'paid' || session?.payment_status === 'no_payment_required'
  if (paid) {
    try {
      const result = await confirmPaidOrder(supabase, order.id, stripeSessionPayment(session))
      return { outcome: result.httpStatus >= 500 ? 'retry' : 'confirmed', result }
    } catch (err) {
      return { outcome: 'error', message: err?.message }
    }
  }
  if (session?.status === 'complete') return { outcome: 'payment_pending' }
  if (session?.status === 'expired') return { outcome: 'session_expired' }
  return { outcome: 'open' }
}

/**
 * Concilia una orden de Flow consultando payment/getStatusByCommerceId.
 * @returns {Promise<{outcome:'confirmed'|'retry'|'not_paid'|'unverifiable'|'error', result?:object, message?:string, status?:number}>}
 */
export async function reconcileFlowOrder(supabase, order) {
  if (!isFlowConfigured() || !order?.id) return { outcome: 'unverifiable' }
  let payment
  try {
    payment = await getFlowPaymentStatusByCommerceId(order.id)
  } catch (err) {
    return { outcome: 'error', message: err?.message }
  }
  if (Number(payment?.status) !== FLOW_STATUS.PAID) return { outcome: 'not_paid', status: Number(payment?.status) }
  try {
    const result = await confirmPaidOrder(supabase, order.id, flowStatusPayment(payment))
    return { outcome: result.httpStatus >= 500 ? 'retry' : 'confirmed', result }
  } catch (err) {
    return { outcome: 'error', message: err?.message }
  }
}

/** Concilia según el proveedor de la orden (órdenes sin proveedor = Flow, el único anterior a Stripe). */
export async function reconcileOrder(supabase, order) {
  const provider = order?.payment_provider || 'flow'
  if (provider === 'stripe') return reconcileStripeOrder(supabase, order)
  if (provider === 'flow') return reconcileFlowOrder(supabase, order)
  return { outcome: 'unverifiable' }
}
