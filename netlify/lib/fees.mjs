// Fuente única del cargo por servicio al comprador. Decisión del dueño (Chanium LLC, sep 2026:
// baja de 10% a 8%):
//   cargo neto = 8% del subtotal de entradas, redondeado a pesos,
//   IVA del cargo = 19% del cargo neto, redondeado a pesos,
//   total comprador = subtotal + cargo neto + IVA del cargo (≈ +9,52%).
// El precio de la entrada es del productor y no cambia; el productor recibe el subtotal.
// Entradas gratis (subtotal 0): sin cargo.
//
// Lo usan el servidor (purchase-tickets, orders.mjs, correo, dashboard) y el navegador
// (src/components/Reservation/pricing.js, FeeCalculator): NO debe importar nada de Node.

export const SERVICE_FEE_RATE = 0.08
export const IVA_RATE = 0.19

export const SERVICE_FEE_PERCENT_LABEL = `${Math.round(SERVICE_FEE_RATE * 100)}%`
export const IVA_PERCENT_LABEL = `${Math.round(IVA_RATE * 100)}%`

/** Etiquetas de las líneas del desglose en el checkout (tarifa vigente). En comprobantes usar serviceFeeLabelFor. */
export const SERVICE_FEE_LABEL = `Cargo por servicio (${SERVICE_FEE_PERCENT_LABEL})`
export const SERVICE_FEE_TAX_LABEL = `IVA del cargo (${IVA_PERCENT_LABEL})`
/** Nota corta junto a un precio: "+ cargo por servicio 8% + IVA". */
export const SERVICE_FEE_NOTE = `+ cargo por servicio ${SERVICE_FEE_PERCENT_LABEL} + IVA`

const toInt = (value) => {
  const n = Math.round(Number(value) || 0)
  return n > 0 ? n : 0
}

/** IVA (19%) de un cargo neto ya calculado, entero CLP. */
export function computeServiceFeeTax(feeNet) {
  return Math.round(toInt(feeNet) * IVA_RATE)
}

/**
 * Cargo por servicio de un subtotal (CLP enteros).
 * @param {number} subtotal
 * @returns {{net:number, iva:number, total:number}} total = net + iva (lo que se suma al subtotal)
 */
export function computeServiceFee(subtotal) {
  const base = toInt(subtotal)
  const net = base > 0 ? Math.round(base * SERVICE_FEE_RATE) : 0
  const iva = computeServiceFeeTax(net)
  return { net, iva, total: net + iva }
}

/**
 * Desglose completo de una compra.
 * @param {number} subtotal
 * @returns {{subtotal:number, feeNet:number, feeIva:number, fee:number, total:number}}
 *   fee = feeNet + feeIva; total = subtotal + fee (monto que cobra Flow).
 */
export function computeBuyerTotal(subtotal) {
  const base = toInt(subtotal)
  const { net, iva, total: fee } = computeServiceFee(base)
  return { subtotal: base, feeNet: net, feeIva: iva, fee, total: base + fee }
}

/**
 * Etiqueta del cargo para un comprobante (orden, correo, reenvío): el porcentaje sale de los montos de
 * ESA orden, no de la tarifa vigente. Las órdenes anteriores al cambio se cobraron al 10% y deben seguir
 * diciendo 10%. Si el cargo no corresponde exactamente a un porcentaje entero del subtotal, se omite.
 * @param {number} subtotal subtotal ya descontado (event_orders.amount)
 * @param {number} feeNet cargo neto (event_orders.ticket_fee)
 */
export function serviceFeeLabelFor(subtotal, feeNet) {
  const base = toInt(subtotal)
  const net = toInt(feeNet)
  if (base > 0 && net > 0) {
    const pct = Math.round((net / base) * 100)
    if (pct > 0 && Math.round(base * (pct / 100)) === net) return `Cargo por servicio (${pct}%)`
  }
  return 'Cargo por servicio'
}

/**
 * Desglose guardado en una orden (event_orders): amount = subtotal, ticket_fee = cargo neto,
 * service_fee_tax = IVA del cargo (NULL/ausente en órdenes previas a la columna: 0).
 */
export function orderFeeBreakdown(order) {
  const subtotal = Math.round(Number(order?.amount) || 0)
  const feeNet = Math.round(Number(order?.ticket_fee) || 0)
  let feeIva = Math.round(Number(order?.service_fee_tax) || 0)
  // Sin la columna (base sin migrar): si lo pagado incluye el IVA del cargo, se deduce de ticket_fee.
  if (order?.service_fee_tax == null && order?.total_payment != null) {
    const tax = computeServiceFeeTax(feeNet)
    if (tax > 0 && Math.round(Number(order.total_payment)) === subtotal + feeNet + tax) feeIva = tax
  }
  return { subtotal, feeNet, feeIva, fee: feeNet + feeIva, total: subtotal + feeNet + feeIva }
}
