// Lógica de presentación de la página del evento y del checkout (rediseño). Funciones puras, sin Vue:
// las comparten los componentes de src/components/event/ y los tests (tests/unit/event-view.test.mjs).
// Los precios finales vienen calculados del servidor (ticket.final_price, src/lib/eventPage.ts) y los
// totales se calculan con Reservation/pricing.js (misma regla que /api/purchase-ticket).

import { greetingName } from "../../../netlify/lib/buyer-name.mjs";

const WEEKDAYS_LONG = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const WEEKDAYS_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MONTHS_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// Guion largo con espacios finos (U+2009) para rangos de hora
const RANGE_DASH = " – ";

/** "YYYY-MM-DD" => { y, m (1-12), d, weekday (0-6) } o null. */
export function dateParts(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ""));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const weekday = new Date(Date.UTC(y, mo - 1, d, 12)).getUTCDay();
  return { y, m: mo, d, weekday };
}

/** "HH:MM[:SS]" => "HH:MM" */
export const hhmm = (time) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time || ""));
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
};

/** "Domingo 8 de noviembre" (+ " de 2027" si no es el año en curso). */
export function formatLongDate(date, { now = new Date() } = {}) {
  const p = dateParts(date);
  if (!p) return "";
  const year = p.y !== now.getFullYear() ? ` de ${p.y}` : "";
  return `${WEEKDAYS_LONG[p.weekday]} ${p.d} de ${MONTHS_LONG[p.m - 1]}${year}`;
}

/** "Sáb 25 oct" */
export function formatShortDate(date) {
  const p = dateParts(date);
  return p ? `${WEEKDAYS_SHORT[p.weekday]} ${p.d} ${MONTHS_SHORT[p.m - 1]}` : "";
}

/** "12:00 – 15:00" o "Desde las 20:00". */
export function formatTimeRange(fn) {
  const start = hhmm(fn?.start_time);
  const end = hhmm(fn?.end_time);
  if (start && end) return `${start}${RANGE_DASH}${end}`;
  if (start) return `Desde las ${start}`;
  return "";
}

/** Mini-calendario: { month: "NOV", day: "8", weekday: "DOM" } */
export function miniCalendar(date) {
  const p = dateParts(date);
  if (!p) return null;
  return { month: MONTHS_SHORT[p.m - 1].toUpperCase(), day: String(p.d), weekday: WEEKDAYS_SHORT[p.weekday].toUpperCase() };
}

/** "Sáb 25 oct · 21:00" */
export const formatFunctionShort = (fn) => [formatShortDate(fn?.date), hhmm(fn?.start_time)].filter(Boolean).join(" · ");

/** "Vie 24 · 21:00" (chips de próximas funciones de la card de acción). */
export function formatChipDate(fn) {
  const p = dateParts(fn?.date);
  if (!p) return "";
  return [`${WEEKDAYS_SHORT[p.weekday]} ${p.d}`, hhmm(fn?.start_time)].filter(Boolean).join(" · ");
}

/** "el sábado 8, 20:00" ("el sábado 8 de noviembre, 20:00" si no es este mes). Para "Te esperamos…". */
export function formatWaitingDate(fn, { now = new Date() } = {}) {
  const p = dateParts(fn?.date);
  if (!p) return "";
  const sameMonth = p.y === now.getFullYear() && p.m === now.getMonth() + 1;
  const day = `el ${WEEKDAYS_LONG[p.weekday].toLocaleLowerCase("es-CL")} ${p.d}${sameMonth ? "" : ` de ${MONTHS_LONG[p.m - 1]}`}`;
  const time = hhmm(fn?.start_time);
  return time ? `${day}, ${time}` : day;
}

export const formatCLP = (value) => `$${Math.round(Number(value) || 0).toLocaleString("es-CL")}`;

/** "20 oct, 10:00" a partir de un ISO (hora de Chile). */
export function formatSaleStart(iso, timeZone = "America/Santiago") {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${Number(parts.day)} ${MONTHS_SHORT[Number(parts.month) - 1]}, ${parts.hour}:${parts.minute}`;
}

// ---------------------------------------------------------------------------------------------------------
// Funciones, lugares y estado de la card de acción
// ---------------------------------------------------------------------------------------------------------

const fnEnd = (fn) => (fn?.end_iso ? new Date(fn.end_iso) : null);

/** Funciones que no han terminado, en orden. */
export function upcomingFunctions(event, now = new Date()) {
  const dates = Array.isArray(event?.dates) ? event.dates : [];
  return dates.filter((d) => {
    const end = fnEnd(d);
    return !end || end >= now;
  });
}

/** Nombre corto de un lugar para chips y resúmenes. */
export const placeKey = (venue) => (venue?.name || venue?.address || "").trim();

/** Lugares distintos de una lista de funciones: [{ key, name, address, city }] */
export function placesOf(functions) {
  const seen = new Map();
  for (const fn of functions || []) {
    const key = placeKey(fn?.venue);
    if (!key || seen.has(key)) continue;
    seen.set(key, { key, name: fn.venue.name || key, address: [fn.venue.address, fn.venue.city].filter(Boolean).join(", "), city: fn.venue.city || "" });
  }
  return [...seen.values()];
}

/** "2 lugares · Providencia y Ñuñoa" */
export function multiplePlacesLabel(places) {
  if (!places || places.length < 2) return "";
  const names = places.map((p) => p.city || p.name);
  const unique = [...new Set(names)];
  const list = unique.length === 2 ? `${unique[0]} y ${unique[1]}` : unique.length > 2 ? `${unique.slice(0, -1).join(", ")} y ${unique.at(-1)}` : unique[0];
  return `${places.length} lugares · ${list}`;
}

/** Todas las entradas (a la venta + no disponibles) son gratis. */
export function isFreeEventView(event) {
  const all = [...(event?.tickets || []), ...(event?.unavailable_tickets || [])];
  return all.length > 0 && all.every((t) => !(Number(t?.price) > 0));
}

/** El evento ya terminó (end_date o la última función pasaron). */
export function isEventEnded(event, now = new Date()) {
  if (event?.is_demo) return false;
  if (Array.isArray(event?.dates) && event.dates.some((d) => d?.end_iso)) return upcomingFunctions(event, now).length === 0;
  return Boolean(event?.end_date) && new Date(event.end_date) < now;
}

/**
 * Cupos/entradas restantes si todas las entradas a la venta tienen stock limitado:
 * { remaining, total, few } (few = ≤ 10 o ≤ 15 % del total). null si alguna es ilimitada.
 */
export function stockSummary(event) {
  const tickets = event?.tickets || [];
  if (!tickets.length || tickets.some((t) => t.remaining === null || t.remaining === undefined)) return null;
  const remaining = tickets.reduce((s, t) => s + Math.max(0, Number(t.remaining) || 0), 0);
  const totals = tickets.map((t) => Number(t.total_quantity));
  const total = totals.every((n) => Number.isFinite(n) && n > 0) ? totals.reduce((a, b) => a + b, 0) : null;
  const few = remaining > 0 && (remaining <= 10 || (total !== null && remaining <= total * 0.15));
  return { remaining, total, few };
}

/** Precio final más bajo entre las entradas a la venta. */
export function minFinalPrice(event) {
  const prices = (event?.tickets || []).map((t) => Number(t.final_price ?? t.price) || 0);
  return prices.length ? Math.min(...prices) : null;
}

/**
 * Estado de la card de acción (§4.4):
 *  'ended' | 'preview' | 'free' | 'free_full' | 'paid_simple' | 'paid_multi' | 'upcoming' | 'sold_out' | 'closed'
 */
export function cardState(event, now = new Date()) {
  if (!event) return "closed";
  if (isEventEnded(event, now)) return "ended";
  if (event.is_preview && event.status !== "published") return "preview";
  const tickets = event.tickets || [];
  const free = isFreeEventView(event);
  if (event.sale_state === "on_sale" && tickets.length) {
    if (free) return "free";
    return tickets.length === 1 ? "paid_simple" : "paid_multi";
  }
  if (event.sale_state === "sold_out") return free ? "free_full" : "sold_out";
  if (event.sale_state === "upcoming") return "upcoming";
  return "closed";
}

/**
 * Rótulo de estado de la card de acción v2 (§4.4b a): la línea en mayúsculas que abre cada estado.
 * El texto va en minúsculas normales (lo lee bien un lector de pantalla); la card lo pasa a mayúsculas con CSS.
 * @param {string} state cardState(event)
 * @param {{ rsvpStatus?: string, now?: Date }} opts rsvpStatus: estado de RsvpForm en los eventos gratis
 * @returns {{ text: string, tone: 'neutral' | 'positive' | 'warning' } | null} null = el estado abre con el precio
 */
export function cardLabel(event, state, { rsvpStatus = "idle", now = new Date() } = {}) {
  const neutral = (text) => ({ text, tone: "neutral" });
  const stock = stockSummary(event);

  if (state === "free" || state === "free_full") {
    if (rsvpStatus === "success" || rsvpStatus === "confirmed") return { text: "Asistencia confirmada", tone: "positive" };
    if (rsvpStatus === "already") return neutral("Ya estás inscrito");
    if (state === "free_full" || rsvpStatus === "full" || rsvpStatus === "waitlist_ok") return neutral("Gratis · Cupos llenos");
    if (stock?.few) return { text: `Gratis · ${stock.remaining === 1 ? "Queda 1 cupo" : `Quedan ${stock.remaining} cupos`}`, tone: "warning" };
    return neutral("Gratis");
  }
  if (state === "paid_simple" || state === "paid_multi") {
    if (stock?.few) return { text: "Últimas entradas", tone: "warning" };
    if (state === "paid_simple") return null;
    const functions = upcomingFunctions(event, now);
    if (functions.length < 2) return null;
    const places = placesOf(functions);
    return neutral([`${functions.length} funciones`, places.length > 1 ? `${places.length} lugares` : ""].filter(Boolean).join(" · "));
  }
  if (state === "upcoming") return neutral(event?.sale_starts_at ? `Venta abre el ${formatSaleStart(event.sale_starts_at, event.timezone)}` : "Venta próximamente");
  if (state === "sold_out") return neutral("Agotado");
  if (state === "ended") return neutral("Evento finalizado");
  if (state === "preview") return neutral("Vista previa");
  return neutral("Venta cerrada");
}

/**
 * Chips de próximas funciones de la card (§4.4b c): hasta `limit` funciones con entradas a la venta, en orden.
 * Solo si hay que elegir función en el checkout (entradas amarradas a una función, ver checkoutFunctions): si las
 * entradas sirven para cualquier función, preseleccionar una no tendría efecto.
 * @returns {{ chips: Array<{ id: string, label: string, place: string, few: boolean }>, more: number }}
 */
export function cardFunctionChips(event, { limit = 3, now = new Date() } = {}) {
  const model = checkoutFunctions(event, now);
  if (!model.needsFunction || upcomingFunctions(event, now).length < 2) return { chips: [], more: 0 };
  const available = model.functions.filter((f) => f.status !== "sold_out");
  const manyPlaces = model.places.length > 1;
  // La comuna basta para distinguir los lugares ("Providencia", "Ñuñoa"); si dos comparten comuna, el nombre
  const byCity = new Set(model.places.map((p) => p.city || p.name)).size === model.places.length;
  const placeOf = (venue) => (byCity ? venue?.city || venue?.name : venue?.name || venue?.city) || "";
  const chips = available.slice(0, limit).map((f) => ({
    id: String(f.id),
    label: formatChipDate(f),
    place: manyPlaces ? placeOf(f.venue) : "",
    few: f.status === "few",
  }));
  return { chips, more: available.length - chips.length };
}

/**
 * "Ver quiénes van →" (§4.4b d): el muro de asistentes (AttendeeFeed) vive en la página de la orden; el link lleva a
 * la orden más reciente guardada en este navegador (storedOrders). "" si no hay ninguna con id.
 */
export function attendeeFeedUrl(orders) {
  const last = [...(orders || [])].reverse().find((o) => o?.orderId);
  return last ? `/order/${last.orderId}#quienes-van` : "";
}

// ---------------------------------------------------------------------------------------------------------
// Modelo del checkout pagado (paso 1: lugar → función → entradas)
// ---------------------------------------------------------------------------------------------------------

/**
 * Funciones elegibles en el checkout. Solo hay que elegir función si alguna entrada está amarrada a una
 * función (event_date_id); las entradas sin función sirven para cualquiera y se compran sin elegirla.
 * @returns {{ needsFunction: boolean, functions: Array<{id, date, start_time, end_time, venue, place, status}>, places: Array }}
 *   status: 'available' | 'few' | 'sold_out'
 */
export function checkoutFunctions(event, now = new Date()) {
  const onSale = event?.tickets || [];
  const unavailable = event?.unavailable_tickets || [];
  const tiedIds = new Set([...onSale, ...unavailable].filter((t) => t.event_date_id != null).map((t) => String(t.event_date_id)));
  if (!tiedIds.size) return { needsFunction: false, functions: [], places: [] };
  const untiedOnSale = onSale.filter((t) => t.event_date_id == null);
  const functions = upcomingFunctions(event, now)
    .filter((d) => d.id != null && tiedIds.has(String(d.id)))
    .map((d) => {
      const tied = onSale.filter((t) => String(t.event_date_id) === String(d.id));
      const pool = [...tied, ...untiedOnSale];
      let status = "available";
      if (!pool.length) status = "sold_out";
      else if (pool.every((t) => t.remaining !== null && t.remaining !== undefined)) {
        const left = pool.reduce((s, t) => s + (Number(t.remaining) || 0), 0);
        if (left <= 10) status = "few";
      }
      return { ...d, place: placeKey(d.venue), status };
    });
  return { needsFunction: functions.length > 0, functions, places: placesOf(functions) };
}

/** Filas de entradas para una función (o todas si no hace falta elegir función). */
export function ticketRowsFor(event, functionId) {
  const matches = (t) => functionId == null || t.event_date_id == null || String(t.event_date_id) === String(functionId);
  const onSale = (event?.tickets || []).filter(matches).map((t) => ({ ...t, status: "available" }));
  const unavailable = (event?.unavailable_tickets || [])
    .filter(matches)
    .filter((t) => !onSale.some((o) => String(o.id) === String(t.id)))
    .map((t) => ({ ...t, status: t.reason === "upcoming" ? "upcoming" : "sold_out" }));
  return [...onSale, ...unavailable];
}

/** Máximo por compra de una entrada (max_quantity ya viene limitado por el stock). */
export function ticketMax(ticket) {
  const max = Number(ticket?.max_quantity);
  const base = Number.isInteger(max) && max > 0 ? max : 10;
  return ticket?.remaining == null ? base : Math.max(0, Math.min(base, Number(ticket.remaining)));
}

// ---------------------------------------------------------------------------------------------------------
// Estado del checkout en la URL: ?checkout=1&paso=2&funcion=679&entradas=82:2,83:1&code=XYZ
// ---------------------------------------------------------------------------------------------------------

export function parseEntradas(raw) {
  const out = {};
  for (const part of String(raw || "").split(",")) {
    const m = /^(\d+):(\d+)$/.exec(part.trim());
    if (m && Number(m[2]) > 0) out[m[1]] = Math.min(Number(m[2]), 50);
  }
  return out;
}

export function serializeEntradas(selection) {
  return Object.entries(selection || {})
    .filter(([, q]) => Number(q) > 0)
    .map(([id, q]) => `${id}:${q}`)
    .join(",");
}

/** Lee el estado del checkout de una URLSearchParams. */
export function readCheckoutParams(params) {
  return {
    open: params.get("checkout") === "1",
    step: params.get("paso") === "2" ? 2 : 1,
    functionId: /^\d+$/.test(params.get("funcion") || "") ? params.get("funcion") : null,
    ticketId: /^\d+$/.test(params.get("entrada") || "") ? params.get("entrada") : null,
    selection: parseEntradas(params.get("entradas")),
    code: (params.get("code") || "").trim().slice(0, 30) || null,
  };
}

/** Escribe el estado del checkout en una URLSearchParams (y quita las claves al cerrar). */
export function writeCheckoutParams(params, state) {
  const keys = ["checkout", "paso", "funcion", "entradas", "entrada"];
  keys.forEach((k) => params.delete(k));
  if (!state?.open) return params;
  params.set("checkout", "1");
  if (state.step === 2) params.set("paso", "2");
  if (state.functionId) params.set("funcion", String(state.functionId));
  const entradas = serializeEntradas(state.selection);
  if (entradas) params.set("entradas", entradas);
  return params;
}

// ---------------------------------------------------------------------------------------------------------
// Varios
// ---------------------------------------------------------------------------------------------------------

/** Nombre de pila normalizado, respetando compuestos ("seba" => "Seba", "maria jose perez" => "Maria Jose"). */
export function firstNameOf(fullName) {
  return greetingName(String(fullName || ""), "", "");
}

/** Iniciales para el avatar del organizador ("Club Surco" => "CS"). */
export function initialsOf(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w.charAt(0).toLocaleUpperCase("es-CL")).join("");
}

/** URL para "Cómo llegar": Apple Maps en iOS, Google Maps en el resto. */
export function directionsUrl(query, { ios = false } = {}) {
  const q = encodeURIComponent(query || "");
  return ios ? `https://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

// ---------------------------------------------------------------------------------------------------------
// Reseñas (EventReviews.vue)
// ---------------------------------------------------------------------------------------------------------

/**
 * Token de reseña del correo: viene en el fragmento (#resena=<token>&nota=4) para que no llegue a servidores
 * ni a analytics. null si no hay. rating: nota tocada en el correo (1-5) o null.
 */
export function readReviewHash(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  if (!/(^|&)resena=/.test(raw)) return null;
  const params = new URLSearchParams(raw);
  const token = (params.get("resena") || "").trim();
  if (!token || token.length > 1024) return null;
  const nota = Number(params.get("nota"));
  return { token, rating: Number.isInteger(nota) && nota >= 1 && nota <= 5 ? nota : null };
}

/** "4,6" */
export const formatRating = (value) => (Number.isFinite(Number(value)) ? (Math.round(Number(value) * 10) / 10).toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "");

/** "1 reseña" / "23 reseñas" */
export const reviewsCountLabel = (n) => `${Number(n) || 0} ${Number(n) === 1 ? "reseña" : "reseñas"}`;

/** "octubre de 2026" para la fecha de una reseña. */
export function formatReviewDate(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return `${MONTHS_LONG[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}
