// Llamadas y memoria local compartidas por el registro gratis (RsvpForm) y el checkout pagado (CheckoutSheet).
// localStorage siempre envuelto en try/catch: en navegadores in-app (Instagram, WhatsApp) puede fallar.
import { trackEvent } from "../../composables/useGoogleAnalytics.js";
import { readAttribution } from "../Reservation/pricing.js";
import { LEGAL } from "../../lib/legal";

const BUYER_KEY = "aitickets_buyer";
const REQUEST_TIMEOUT_MS = 15000;

const safeGet = (key) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
const safeSet = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage no disponible */
  }
};

/** Comprador recordado en este navegador: { name, email } o null. */
export function rememberedBuyer() {
  const b = safeGet(BUYER_KEY);
  return b && typeof b.email === "string" && typeof b.name === "string" ? { name: b.name, email: b.email } : null;
}
export const rememberBuyer = (name, email) => safeSet(BUYER_KEY, { name, email });
export function forgetBuyer() {
  try {
    localStorage.removeItem(BUYER_KEY);
  } catch {
    /* storage no disponible */
  }
}

/** Órdenes guardadas de un evento (las usa "Mis entradas" y el estado "ya confirmaste"). */
export const storedOrders = (eventId) => {
  const orders = safeGet(`purchase_event_${eventId}`);
  return Array.isArray(orders) ? orders : orders ? [orders] : [];
};

// functionId: función de la entrada (si está amarrada a una), para "Te esperamos el sábado 8, 20:00."
export function rememberOrder(event, { orderId, quantity, amount = 0, email = "", name = "", functionId = null }) {
  const key = `purchase_event_${event.id}`;
  const orders = storedOrders(event.id);
  if (!orders.some((o) => o.orderId === orderId)) {
    orders.push({
      orderId,
      eventId: event.id,
      eventSlug: event.slug,
      eventName: event.name,
      purchaseDate: new Date().toISOString(),
      amount,
      ticketsCount: quantity,
      tickets: [],
      email,
      name,
      functionId,
    });
    safeSet(key, orders);
  }
}

/** Evento de embudo (§14) con event_id y la atribución guardada por la página. */
export function trackFunnel(name, event, params = {}) {
  const { ref, utm } = readAttribution();
  trackEvent(name, {
    event_id: event?.id,
    ...(ref ? { ref } : {}),
    ...(utm?.source ? { utm_source: utm.source } : {}),
    ...(utm?.medium ? { utm_medium: utm.medium } : {}),
    ...(utm?.campaign ? { utm_campaign: utm.campaign } : {}),
    ...params,
  });
}

/**
 * Evento de embudo (§14) al volver de Webpay, según el estado que muestra payment-confirmation (no el de la orden):
 *   order_paid    pagada, o ya cobrada y emitiéndose ('processing')
 *   hold_expired  anulada porque la reserva de la orden venció antes del pago (expire-pending-orders la deja en
 *                 "expired"); si Flow igual la rechazó o sigue pendiente, manda lo que se ve en pantalla
 *   order_failed  rechazada o anulada
 * Pendiente, en revisión, reembolsada o error: ninguno (null).
 */
export function checkoutReturnFunnel(state, order, { total = 0, qty = 0 } = {}) {
  if (!order) return null;
  if (state === "paid" || state === "processing") return { name: "order_paid", params: { order_id: order.id, total, qty } };
  if (state === "cancelled" && order.status === "expired") return { name: "hold_expired", params: { order_id: order.id } };
  if (state === "rejected" || state === "cancelled") return { name: "order_failed", params: { order_id: order.id, status: state } };
  return null;
}

/**
 * Manda el evento de checkoutReturnFunnel una vez por orden y resultado (recargar la página no lo repite).
 * @returns {boolean} true si lo mandó
 */
export function trackCheckoutReturn(funnel, eventId, storage) {
  if (!funnel?.name) return false;
  const key = `ga_${funnel.name}_${funnel.params?.order_id}`;
  let seen = false;
  try {
    const store = storage ?? sessionStorage;
    seen = store.getItem(key) === "1";
    store.setItem(key, "1");
  } catch {
    /* sin storage: se manda igual */
  }
  if (seen) return false;
  trackFunnel(funnel.name, { id: eventId }, funnel.params);
  return true;
}

async function postJson(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* sin cuerpo */
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    // Sin conexión o timeout (15 s)
    return { ok: false, status: 0, data: {}, network: true, timeout: err?.name === "AbortError" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Crea la orden (gratis o pagada) en /api/purchase-ticket. El servidor calcula precios y cargo.
 * @returns {Promise<{ok:boolean,status:number,data:any,network?:boolean}>}
 */
// holders / answers / company: datos extra que pide el evento (CheckoutExtras.vue, src/lib/checkoutFields.mjs).
export function createOrder({ event, fullName, email, phone, tickets, discountCode, cfToken, termsAccepted = true, holders, answers, company }) {
  const { ref, utm } = readAttribution();
  return postJson("/api/purchase-ticket", {
    eventId: event.id,
    buyer: { fullName: fullName.trim(), email: email.trim(), phone: phone?.trim() || undefined },
    tickets,
    ref,
    utm,
    cfToken: cfToken || undefined,
    termsAccepted,
    termsVersion: LEGAL.termsVersion,
    discountCode: discountCode || undefined,
    holders: holders || undefined,
    answers: answers || undefined,
    company: company || undefined,
  });
}

export const resendTickets = (event, email) => postJson("/api/rsvp/resend", { eventId: event.id, email: email.trim() });

export function joinWaitlist(event, { email, kind, functionId }) {
  const { utm } = readAttribution();
  return postJson("/api/events/waitlist", { eventId: event.id, email: email.trim(), kind, functionId: functionId || undefined, utm });
}

export const previewDiscount = (event, code, tickets) => postJson("/api/discount-code", { eventId: event.id, code, tickets });
