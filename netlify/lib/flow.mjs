// Cliente mínimo de la API de Flow (https://www.flow.cl/docs/api.html).
// Todas las llamadas se firman con HMAC-SHA256 (FLOW_SECRET_KEY) sobre los parámetros ordenados.
import crypto from 'node:crypto'

export const FLOW_STATUS = { PENDING: 1, PAID: 2, REJECTED: 3, CANCELLED: 4 }

function flowConfig() {
  const apiKey = process.env.FLOW_API_KEY
  const secretKey = process.env.FLOW_SECRET_KEY
  const baseUrl = (process.env.FLOW_BASE_URL || '').replace(/\/$/, '')
  if (!apiKey || !secretKey || !baseUrl) throw new Error('Faltan FLOW_API_KEY / FLOW_SECRET_KEY / FLOW_BASE_URL')
  return { apiKey, secretKey, baseUrl }
}

export function signFlowParams(params, secretKey) {
  const stringToSign = Object.keys(params)
    .filter(k => k !== 's')
    .sort()
    .map(k => k + params[k])
    .join('')
  return crypto.createHmac('sha256', secretKey).update(stringToSign).digest('hex')
}

/**
 * Crea una orden de pago. Devuelve { url, token, flowOrder }.
 * paymentMethod: FLOW_PAYMENT_METHOD (1 = Webpay por defecto; 9 = todos los medios activos en la cuenta).
 * timeoutSeconds: la orden de pago expira en Flow tras este tiempo (va dentro de los parámetros firmados),
 * alineado con la reserva de stock de las órdenes pendientes para evitar pagos tardíos sobre stock liberado.
 */
export async function createFlowPayment({ commerceOrder, subject, amount, email, urlConfirmation, urlReturn, timeoutSeconds }) {
  const { apiKey, secretKey, baseUrl } = flowConfig()
  const paymentMethod = Number.parseInt(process.env.FLOW_PAYMENT_METHOD || '1', 10) || 1
  const params = {
    apiKey,
    commerceOrder: String(commerceOrder),
    subject: String(subject).slice(0, 250),
    currency: 'CLP',
    amount: String(amount),
    email,
    paymentMethod: String(paymentMethod),
    urlConfirmation,
    urlReturn,
  }
  if (Number.isInteger(timeoutSeconds) && timeoutSeconds > 0) params.timeout = String(timeoutSeconds)
  const body = new URLSearchParams({ ...params, s: signFlowParams(params, secretKey) })
  const res = await fetch(`${baseUrl}/payment/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  let data = null
  try { data = await res.json() } catch { /* respuesta no JSON */ }
  if (!res.ok || !data?.url || !data?.token) {
    const err = new Error(`Flow payment/create falló (${res.status}): ${data?.message || 'sin detalle'}`)
    err.flow = data
    throw err
  }
  return { url: data.url, token: data.token, flowOrder: data.flowOrder }
}

/** Consulta el estado de un pago por token (payment/getStatus). */
export async function getFlowPaymentStatus(token) {
  const { apiKey, secretKey, baseUrl } = flowConfig()
  const params = { apiKey, token: String(token) }
  const qs = new URLSearchParams({ ...params, s: signFlowParams(params, secretKey) })
  const res = await fetch(`${baseUrl}/payment/getStatus?${qs.toString()}`, { method: 'GET' })
  let data = null
  try { data = await res.json() } catch { /* respuesta no JSON */ }
  if (!res.ok || !data) {
    const err = new Error(`Flow payment/getStatus falló (${res.status}): ${data?.message || 'sin detalle'}`)
    err.flow = data
    throw err
  }
  return data
}
