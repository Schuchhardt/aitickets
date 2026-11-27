// POST /api/payment-confirmation — webhook (urlConfirmation) de Flow.
// Flow envía `token` (x-www-form-urlencoded); consultamos payment/getStatus firmado y actuamos según el estado.
// El cumplimiento (reclamo atómico, sobreventa -> 'review', entradas, correo, Slack) es común a todos los
// proveedores y vive en netlify/lib/orders.mjs (confirmPaidOrder / markOrderFailed).
// Reintentos: se responde 5xx cuando hay que reintentar (Flow vuelve a notificar; el camino es idempotente).
import { getSupabaseAdmin, json } from '../../lib/supabase.mjs'
import { getFlowPaymentStatus, FLOW_STATUS } from '../../lib/payments/flow.mjs'
import { confirmPaidOrder, markOrderFailed, loadOrder, recordPaymentEvent, UUID_RE } from '../../lib/orders.mjs'

async function readToken(req) {
  const url = new URL(req.url)
  const fromQuery = url.searchParams.get('token')
  if (fromQuery) return fromQuery
  const raw = await req.text()
  if (!raw) return null
  const contentType = req.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try { return JSON.parse(raw)?.token || null } catch { return null }
  }
  return new URLSearchParams(raw).get('token')
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ message: 'Método no permitido' }, 405)

  let token
  try {
    token = await readToken(req)
  } catch {
    token = null
  }
  if (!token || typeof token !== 'string' || token.length > 200) {
    return json({ message: 'Token no recibido' }, 400)
  }

  let payment
  try {
    payment = await getFlowPaymentStatus(token)
  } catch (err) {
    console.error('Error consultando Flow getStatus:', err.message)
    // 5xx para que Flow reintente la notificación
    return json({ message: 'Error al consultar Flow' }, 502)
  }

  const { commerceOrder, status, amount, currency, flowOrder } = payment
  const paymentData = payment.paymentData || {}
  const supabase = getSupabaseAdmin()

  if (!UUID_RE.test(String(commerceOrder || ''))) {
    console.error(`Flow notificó un commerceOrder inválido (${commerceOrder}, flowOrder=${flowOrder})`)
    return json({ message: 'Orden no encontrada' }, 404)
  }

  try {
    const order = await loadOrder(supabase, commerceOrder)
    if (!order) {
      console.error(`Flow notificó una orden inexistente (commerceOrder=${commerceOrder}, flowOrder=${flowOrder})`)
      return json({ message: 'Orden no encontrada' }, 404)
    }

    if (status === FLOW_STATUS.PAID || order.status === 'paid') {
      const fee = (Number.parseInt(paymentData.fee, 10) || 0) + (Number.parseInt(paymentData.taxes, 10) || 0)
      const result = await confirmPaidOrder(supabase, order.id, {
        provider: 'flow',
        amount: Number(amount),
        currency: currency || 'CLP',
        externalId: flowOrder != null ? String(flowOrder) : null,
        fee,
        net: paymentData.balance != null ? Math.round(Number(paymentData.balance)) : null,
        method: paymentData.media || null,
      })
      if (result.status === 'paid' || result.status === 'review') {
        await recordPaymentEvent(supabase, {
          id: `flow:${flowOrder ?? commerceOrder}:${result.status}`,
          provider: 'flow',
          type: `payment.${result.status}`,
          orderId: order.id,
          payload: { commerceOrder, flowOrder, status, amount, currency },
        })
      }
      return json({ message: result.message }, result.httpStatus)
    }

    if (order.status === 'review') {
      return json({ message: 'Orden en revisión manual' }, 200)
    }

    if (status === FLOW_STATUS.REJECTED || status === FLOW_STATUS.CANCELLED) {
      const newStatus = status === FLOW_STATUS.REJECTED ? 'rejected' : 'cancelled'
      await markOrderFailed(supabase, order.id, newStatus)
      console.log(`Orden ${order.id}: pago ${newStatus}`)
      return json({ message: `Pago ${newStatus}` }, 200)
    }

    return json({ message: 'Pago pendiente', status }, 200)
  } catch (error) {
    console.error(`Error procesando confirmación de pago (commerceOrder=${commerceOrder}):`, error?.message)
    return json({ message: 'Error interno' }, 500)
  }
}

export const config = {
  path: ['/api/payment-confirmation'],
}
