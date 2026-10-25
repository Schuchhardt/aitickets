// Clasificación de órdenes para métricas (ventas, ritmo, canales, liquidación). La regla vive en
// netlify/lib/order-kinds.mjs (la usan también las funciones de Netlify, p. ej. el reporte semanal a productores).
export { orderLines, isTransferOrder, isCourtesyOrder, lineSoldQty, orderSoldQty } from "../../netlify/lib/order-kinds.mjs";
