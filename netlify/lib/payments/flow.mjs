// Proveedor de pago Flow (Webpay) — cliente mínimo de la API (https://www.flow.cl/docs/api.html).
// Todas las llamadas se firman con HMAC-SHA256 (FLOW_SECRET_KEY) sobre los parámetros ordenados.
// netlify/lib/flow.mjs re-exporta este módulo por compatibilidad.
import crypto from 'node:crypto'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

async function flowGet(path, extra) {
  const { apiKey, secretKey, baseUrl } = flowConfig()
  const params = { apiKey, ...extra }
  const qs = new URLSearchParams({ ...params, s: signFlowParams(params, secretKey) })
  const res = await fetch(`${baseUrl}${path}?${qs.toString()}`, { method: 'GET' })
  let data = null
  try { data = await res.json() } catch { /* respuesta no JSON */ }
  if (!res.ok || !data) {
    const err = new Error(`Flow ${path.replace(/^\//, '')} falló (${res.status}): ${data?.message || 'sin detalle'}`)
    err.flow = data
    throw err
  }
  return data
}

/** Consulta el estado de un pago por token (payment/getStatus). */
export async function getFlowPaymentStatus(token) {
  return flowGet('/payment/getStatus', { token: String(token) })
}

/**
 * Consulta el estado de un pago por commerceOrder (payment/getStatusByCommerceId). Lo usa el barrido de
 * órdenes 'processing' abandonadas, que no guarda el token de Flow.
 */
export async function getFlowPaymentStatusByCommerceId(commerceId) {
  return flowGet('/payment/getStatusByCommerceId', { commerceId: String(commerceId) })
}

/** true si las credenciales de Flow están configuradas. */
export function isFlowConfigured() {
  return Boolean(process.env.FLOW_API_KEY && process.env.FLOW_SECRET_KEY && process.env.FLOW_BASE_URL)
}

/**
 * Verifica el token con el que Flow devuelve al comprador (urlReturn, POST) consultando
 * payment/getStatus firmado. Nunca lanza.
 * @returns {Promise<{ok: true, payment: object, orderId: string|null} | {ok: false, error: 'invalid_token'|'flow_error'}>}
 *   orderId es el commerceOrder si es un uuid válido (id de event_orders), o null.
 */
export async function verifyFlowReturnToken(token) {
  if (typeof token !== 'string' || !token || token.length > 200) return { ok: false, error: 'invalid_token' }
  try {
    const payment = await getFlowPaymentStatus(token)
    const commerceOrder = String(payment?.commerceOrder || '')
    return { ok: true, payment, orderId: UUID_RE.test(commerceOrder) ? commerceOrder : null }
  } catch (err) {
    console.error('Flow getStatus (retorno) falló:', err?.message)
    return { ok: false, error: 'flow_error' }
  }
}

/**
 * Checkout de Flow para una orden pendiente (interfaz común de netlify/lib/payments/index.mjs).
 * @param {{order:{id:string}, eventName:string, ticketQty:number, total:number, buyerEmail:string, siteUrl:string, holdMinutes:number}} args
 * @returns {Promise<{redirectUrl:string, externalId:string|null}>}
 */
export async function createFlowCheckout({ order, eventName, ticketQty, total, buyerEmail, siteUrl, holdMinutes }) {
  const payment = await createFlowPayment({
    commerceOrder: order.id,
    subject: `${ticketQty === 1 ? '1 entrada' : `${ticketQty} entradas`} - ${eventName}`,
    amount: total,
    email: buyerEmail,
    urlConfirmation: `${siteUrl}/api/payment-confirmation`,
    urlReturn: `${siteUrl}/payment-confirmation`,
    // El pago expira cuando se libera la reserva de stock de la orden pendiente
    timeoutSeconds: Math.max(1, Number(holdMinutes) || 15) * 60,
  })
  return {
    redirectUrl: `${payment.url}?token=${payment.token}`,
    externalId: payment.flowOrder != null ? String(payment.flowOrder) : null,
  }
}
