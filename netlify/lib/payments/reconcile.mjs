// Conciliación con Flow: consulta el estado real del cobro y, si está pagado, cumple la orden con
// confirmPaidOrder (idempotente, el mismo camino del webhook). Lo usa expire-pending-orders para retomar
// órdenes 'processing' abandonadas (la invocación murió por timeout/OOM a mitad del cumplimiento) y para
// rescatar pendientes/expiradas que Flow cobró pero cuyo webhook no llegó.
// Nunca lanza: los errores se devuelven como { outcome: 'error' }.
import { confirmPaidOrder } from '../orders.mjs'
import { getFlowPaymentStatusByCommerceId, isFlowConfigured, FLOW_STATUS } from './flow.mjs'

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
 * Concilia una orden de Flow consultando payment/getStatusByCommerceId.
 * timeoutMs: tope de la consulta a Flow (no del cumplimiento).
 * @returns {Promise<{outcome:'confirmed'|'retry'|'not_paid'|'unverifiable'|'error', result?:object, payment?:object, message?:string, status?:number}>}
 *   payment: datos del cobro (flowStatusPayment) cuando Flow lo informa pagado.
 */
export async function reconcileFlowOrder(supabase, order, { timeoutMs } = {}) {
  if (!isFlowConfigured() || !order?.id) return { outcome: 'unverifiable' }
  let payment
  try {
    payment = await getFlowPaymentStatusByCommerceId(order.id, { timeoutMs })
  } catch (err) {
    return { outcome: 'error', message: err?.message }
  }
  if (Number(payment?.status) !== FLOW_STATUS.PAID) return { outcome: 'not_paid', status: Number(payment?.status) }
  const paid = flowStatusPayment(payment)
  try {
    const result = await confirmPaidOrder(supabase, order.id, paid)
    return { outcome: result.httpStatus >= 500 ? 'retry' : 'confirmed', result, payment: paid }
  } catch (err) {
    return { outcome: 'error', message: err?.message, payment: paid }
  }
}

/** Concilia según el proveedor de la orden (órdenes sin proveedor = Flow). */
export async function reconcileOrder(supabase, order, options = {}) {
  const provider = order?.payment_provider || 'flow'
  if (provider === 'flow') return reconcileFlowOrder(supabase, order, options)
  return { outcome: 'unverifiable' }
}
