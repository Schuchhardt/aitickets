// Clasificación de órdenes para métricas (ventas, ritmo, canales, liquidación, reporte semanal). Fuente única: la
// re-exporta src/lib/orderKinds.ts para el panel y la API de productores. Sin dependencias: también corre en el navegador.
//
// - Cortesía: payment_provider 'courtesy' o alguna línea con complimentary (src/lib/courtesy.ts). No es venta.
// - Transferencia: orden de monto 0 que crea transfer_ticket para el nuevo titular; todas sus líneas traen
//   transferred_from_order. No es venta: la entrada ya se contó en la orden de origen.
// - Orden de origen de una transferencia: su línea baja `quantity` (lo que la orden aún tiene) y suma
//   `transferred_out`; `total` y `amount` no cambian (es lo que se pagó). Lo vendido = quantity + transferred_out.

/** @typedef {{ payment_provider?: string | null, ticket_details?: unknown, ticket_qty?: number | null }} OrderLike */

/**
 * @param {OrderLike} o
 * @returns {any[]}
 */
export const orderLines = (o) => (Array.isArray(o.ticket_details) ? o.ticket_details : [])

/** @param {OrderLike} o */
export const isTransferOrder = (o) => {
  const lines = orderLines(o)
  return lines.length > 0 && lines.every((l) => l?.transferred_from_order)
}

/** @param {OrderLike} o */
export const isCourtesyOrder = (o) => o.payment_provider === 'courtesy' || orderLines(o).some((l) => l?.complimentary)

/**
 * Entradas que la línea tuvo al venderse (las transferidas siguen contando como vendidas en el origen).
 * @param {any} l
 * @returns {number}
 */
export const lineSoldQty = (l) => (Number(l?.quantity) || 0) + (Number(l?.transferred_out) || 0)

/**
 * Entradas emitidas por la orden en su origen (incluye las que luego se transfirieron).
 * @param {OrderLike} o
 * @returns {number}
 */
export function orderSoldQty(o) {
  const lines = orderLines(o)
  const transferredOut = lines.reduce((n, l) => n + (Number(l?.transferred_out) || 0), 0)
  const held = o.ticket_qty != null ? Number(o.ticket_qty) || 0 : lines.reduce((n, l) => n + (Number(l?.quantity) || 0), 0)
  return held + transferredOut || (lines.length ? 0 : 1)
}
