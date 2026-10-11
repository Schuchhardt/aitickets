// Clasificación de órdenes para métricas (ventas, ritmo, canales, liquidación).
//
// - Cortesía: payment_provider 'courtesy' o alguna línea con complimentary (src/lib/courtesy.ts). No es venta.
// - Transferencia: orden de monto 0 que crea transfer_ticket para el nuevo titular; todas sus líneas traen
//   transferred_from_order. No es venta: la entrada ya se contó en la orden de origen.
// - Orden de origen de una transferencia: su línea baja `quantity` (lo que la orden aún tiene) y suma
//   `transferred_out`; `total` y `amount` no cambian (es lo que se pagó). Lo vendido = quantity + transferred_out.
type OrderLike = { payment_provider?: string | null; ticket_details?: unknown; ticket_qty?: number | null };

export const orderLines = (o: OrderLike): any[] => (Array.isArray(o.ticket_details) ? (o.ticket_details as any[]) : []);

export const isTransferOrder = (o: OrderLike) => {
    const lines = orderLines(o);
    return lines.length > 0 && lines.every((l) => l?.transferred_from_order);
};

export const isCourtesyOrder = (o: OrderLike) => o.payment_provider === "courtesy" || orderLines(o).some((l) => l?.complimentary);

/** Entradas que la línea tuvo al venderse (las transferidas siguen contando como vendidas en el origen). */
export const lineSoldQty = (l: any) => (Number(l?.quantity) || 0) + (Number(l?.transferred_out) || 0);

/** Entradas emitidas por la orden en su origen (incluye las que luego se transfirieron). */
export function orderSoldQty(o: OrderLike): number {
    const lines = orderLines(o);
    const transferredOut = lines.reduce((n, l) => n + (Number(l?.transferred_out) || 0), 0);
    const held = o.ticket_qty != null ? Number(o.ticket_qty) || 0 : lines.reduce((n, l) => n + (Number(l?.quantity) || 0), 0);
    return held + transferredOut || (lines.length ? 0 : 1);
}
