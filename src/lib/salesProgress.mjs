// Cuánto se ha vendido de un evento, para la página pública: "60% de entradas vendidas" desde el 50 % y
// "Últimas entradas" desde el 80 % (o con 10 o menos). Lo calcula el servidor (src/lib/eventPage.ts) sobre TODAS las
// entradas del evento, no solo las que están a la venta: una preventa que se agota no es "últimas entradas" si después
// viene la general. Los rótulos los arma src/components/event/eventView.js (stockSummary, cardLabel).

/** Desde este % vendido la página muestra "N% de entradas vendidas". */
export const SOLD_PERCENT_VISIBLE = 50;
/** Desde este % vendido la página muestra "Últimas entradas" (o "Quedan N cupos" en los gratis). */
export const SOLD_PERCENT_LAST = 80;
/** Con esta cantidad o menos por vender también son "Últimas entradas" (eventos chicos: un taller de 10 cupos). */
export const FEW_REMAINING = 10;

/**
 * Avance de la venta de un evento.
 *
 * `tickets`: las entradas públicas (no regalo) de las funciones que no han terminado, con total_quantity, init_date y
 * end_date: a la venta, agotadas, por abrir y tandas que esperan a la anterior. `sold` y `pending`: ticketId (string)
 * → vendidas y reservadas en checkout (aitickets_ticket_availability).
 *
 * - Una entrada cuya venta ya cerró (end_date pasado) suma solo lo que vendió: lo que no se vendió ya no está a la venta.
 * - Si alguna entrada que se vende o se venderá es ilimitada no hay porcentaje: devuelve null.
 *
 * @param {Array<{ id: any, total_quantity?: number | string | null, end_date?: string | null }>} tickets
 * @param {{ sold?: Map<string, number>, pending?: Map<string, number>, now?: Date }} [counts]
 * @returns {{ sold_percent: number | null, remaining: number } | null} sold_percent: % vendido (hacia abajo, nunca
 *   exagera) o null si es menor que SOLD_PERCENT_VISIBLE (la página no lo muestra y el HTML no lo expone).
 *   remaining: lo que queda por vender en todo el evento (descontando las reservas en checkout).
 */
export function computeSalesProgress(tickets, { sold, pending, now = new Date() } = {}) {
  let soldTotal = 0;
  let capacity = 0;
  let remaining = 0;
  let sellable = 0;
  for (const t of tickets || []) {
    const key = String(t?.id);
    const s = Math.max(0, Number(sold?.get(key)) || 0);
    const p = Math.max(0, Number(pending?.get(key)) || 0);
    if (t?.end_date && new Date(t.end_date) < now) {
      soldTotal += s;
      capacity += s;
      continue;
    }
    if (t?.total_quantity === null || t?.total_quantity === undefined) return null;
    const total = Math.max(0, Number(t.total_quantity) || 0);
    soldTotal += s;
    // Sobreventa (cupo bajado después de vender): el cupo efectivo es lo ya tomado
    capacity += Math.max(total, s + p);
    remaining += Math.max(0, total - s - p);
    sellable += 1;
  }
  if (!sellable || capacity <= 0) return null;
  const percent = Math.min(100, Math.floor((soldTotal * 100) / capacity));
  return { sold_percent: percent >= SOLD_PERCENT_VISIBLE ? percent : null, remaining };
}
