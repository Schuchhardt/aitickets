// Cálculo de precios que se MUESTRA al comprador antes de pagar (ley del consumidor).
// El servidor (/api/purchase-ticket) recalcula todo desde la BD; esto es solo para la vista y usa la misma
// regla, importada de la fuente única netlify/lib/fees.mjs (cargo 8% del subtotal + IVA 19% del cargo).
import { computeBuyerTotal } from "../../../netlify/lib/fees.mjs";
import { computeDiscountedTotals } from "../../../netlify/lib/discounts.mjs";
export { discountLineLabel, normalizeDiscountCode } from "../../../netlify/lib/discounts.mjs";

export {
  SERVICE_FEE_RATE,
  IVA_RATE,
  SERVICE_FEE_LABEL,
  SERVICE_FEE_TAX_LABEL,
  SERVICE_FEE_NOTE,
  SERVICE_FEE_PERCENT_LABEL,
  IVA_PERCENT_LABEL,
  computeServiceFee,
  computeBuyerTotal,
} from "../../../netlify/lib/fees.mjs";
export const DEFAULT_MAX_PER_PURCHASE = 10;

export const maxPerPurchase = (ticket) => {
  const max = Number(ticket?.max_quantity);
  return Number.isInteger(max) && max > 0 ? max : DEFAULT_MAX_PER_PURCHASE;
};

const SHORT_WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const SHORT_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Etiqueta de una función (contrato R1): "Sáb 12 oct · 20:00 · Recinto". */
export const formatFunctionLabel = (d, { withPlace = true } = {}) => {
  if (!d?.date) return "";
  const [y, m, day] = String(d.date).slice(0, 10).split("-").map(Number);
  if (!y || !m || !day) return "";
  const dt = new Date(Date.UTC(y, m - 1, day, 12));
  const parts = [`${SHORT_WEEKDAYS[dt.getUTCDay()]} ${day} ${SHORT_MONTHS[m - 1]}`];
  if (d.start_time) parts.push(String(d.start_time).slice(0, 5));
  if (withPlace && d.venue?.name) parts.push(d.venue.name);
  return parts.join(" · ");
};

/** Función de una entrada (event_date_id) dentro de event.dates, o null si es válida para cualquier función. */
export const findTicketFunction = (ticket, dates = []) => {
  if (ticket?.event_date_id == null) return null;
  return (dates || []).find((d) => d?.id != null && String(d.id) === String(ticket.event_date_id)) || null;
};

/** Líneas seleccionadas: [{ id, name, quantity, price, total, functionLabel }] */
export const buildSelectedLines = (selectedTickets = {}, tickets = [], dates = []) =>
  Object.keys(selectedTickets || {})
    .filter((id) => Number(selectedTickets[id]) > 0)
    .map((id) => {
      const ticket = (tickets || []).find((t) => String(t.id) === String(id));
      if (!ticket) return null;
      const price = Math.round(Number(ticket.price) || 0);
      const quantity = Number(selectedTickets[id]);
      const fn = findTicketFunction(ticket, dates);
      return {
        id: Number(ticket.id),
        name: ticket.ticket_name,
        quantity,
        price,
        total: price * quantity,
        functionLabel: fn ? formatFunctionLabel(fn, { withPlace: false }) : "",
      };
    })
    .filter(Boolean);

/**
 * Totales de la selección: { subtotal, feeNet, feeIva, fee, total, quantity }.
 * fee = feeNet + feeIva (cargo por servicio con IVA); total = subtotal + fee (lo que se cobra).
 */
export const computeTotals = (lines = []) => {
  const subtotal = lines.reduce((sum, l) => sum + (Number(l.total) || 0), 0);
  const quantity = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
  const { feeNet, feeIva, fee, total } = computeBuyerTotal(subtotal);
  return { subtotal, feeNet, feeIva, fee, total, quantity };
};

/**
 * Totales con un código de descuento aplicado (vista previa; el servidor recalcula y valida el código).
 * discount: { code, kind:'percent'|'fixed', value } o null. El descuento va sobre el subtotal de entradas y el
 * cargo por servicio se calcula sobre el subtotal descontado (netlify/lib/discounts.mjs).
 * @returns {{grossSubtotal:number, discountAmount:number, subtotal:number, feeNet:number, feeIva:number, fee:number, total:number, quantity:number}}
 *   subtotal = grossSubtotal - discountAmount.
 */
export const computeTotalsWithDiscount = (lines = [], discount = null) => {
  const gross = lines.reduce((sum, l) => sum + (Number(l.total) || 0), 0);
  const quantity = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
  return { ...computeDiscountedTotals(gross, discount), quantity };
};

export const formatCLP = (value) => `$${Math.round(Number(value) || 0).toLocaleString("es-CL")}`;

export const EMAIL_RE = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[^\s@<>(),;:"[\]]{2,}$/;
export const isValidEmail = (email) => typeof email === "string" && email.length <= 254 && EMAIL_RE.test(email.trim());

/** Atribución guardada por la página del evento (contrato C10). */
export const readAttribution = () => {
  try {
    const raw = sessionStorage.getItem("aitickets_attribution");
    if (!raw) return {};
    const a = JSON.parse(raw) || {};
    const utm = a.utm && typeof a.utm === "object"
      ? { source: a.utm.source || undefined, medium: a.utm.medium || undefined, campaign: a.utm.campaign || undefined }
      : undefined;
    return { ref: a.ref || undefined, utm };
  } catch {
    return {};
  }
};
