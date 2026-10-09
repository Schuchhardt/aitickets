// POST /api/discount-code — vista previa PÚBLICA de un código de descuento en el checkout (no reserva nada).
// Request: { eventId, code, tickets:[{id, quantity}] }
// Respuesta 200: { valid:true, code, kind, value, label, discountAmount, grossSubtotal, subtotal, feeNet, feeIva, fee, total }
// Error: { valid:false, message, reason } con 400/404/409/429/503.
// El subtotal se calcula en el servidor desde event_tickets (se ignoran precios del cliente). La compra
// (/api/purchase-ticket, con captcha) vuelve a validar todo, incluido el límite por comprador, y la reserva
// atómica aplica el límite de usos definitivo.
// Antiabuso (adivinar códigos):
//  - límite durable por IP y por IP+evento (netlify/lib/rate-limit.mjs);
//  - tope GLOBAL de intentos fallidos por evento y por organización (sin importar la IP): al alcanzarlo,
//    la vista previa de ese evento/organización responde 429 hasta que termine la ventana;
//  - un código que no sirve responde SIEMPRE lo mismo (404 not_found), exista o no, esté inactivo, fuera de
//    vigencia o agotado: la respuesta no confirma que se acertó a un código real. No se revisa el límite por
//    comprador (no se recibe email) para no revelar si un email ya usó un código.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../lib/auth-helpers";
import { jsonResponse } from "../../lib/supabaseServer";
import { clientIpFrom } from "../../lib/sites";
import { isDemoEventSlug } from "../../lib/demoEvent.mjs";
import { hashRateLimitKey, rateLimit } from "../../../netlify/lib/rate-limit.mjs";
import { TICKET_COLUMNS, isTicketOnSale } from "../../../netlify/lib/tickets.mjs";
import { resolveDiscount, computeDiscountedTotals, normalizeDiscountCode, DISCOUNT_MESSAGES } from "../../../netlify/lib/discounts.mjs";

export const prerender = false;

const MAX_TICKET_LINES = 20;
const LIMIT_IP = { bucket: "discount:ip", windowSeconds: 10 * 60, max: 30 };
const LIMIT_IP_EVENT = { bucket: "discount:ip-event", windowSeconds: 10 * 60, max: 15 };
// Intentos FALLIDOS de todas las IPs juntas (ventana fija de 1 hora)
const FAIL_EVENT = { bucket: "discount:event-fail", windowSeconds: 60 * 60, max: 300 };
const FAIL_ORG = { bucket: "discount:org-fail", windowSeconds: 60 * 60, max: 1000 };
const TOO_MANY = "Demasiados intentos con códigos de descuento. Espera unos minutos e intenta nuevamente.";
const INVALID_CODE = "El código de descuento no es válido para este evento, no está vigente o ya no tiene cupos.";
// Motivos que se informan tal cual: no dependen de que el código exista
const PASS_THROUGH_REASONS = new Set(["invalid_format", "unavailable"]);

// Respaldo en memoria de los contadores de fallos (si la tabla de rate limits no se puede leer)
const failMemory = new Map<string, { windowStart: number; count: number }>();

function windowStartMs(windowSeconds: number, now = Date.now()) {
  const ms = windowSeconds * 1000;
  return Math.floor(now / ms) * ms;
}

/** Fallos ya registrados en la ventana actual (lee aitickets_rate_limits sin sumar un intento). */
async function failCount(supabase: any, limit: typeof FAIL_EVENT, key: string): Promise<number> {
  const start = windowStartMs(limit.windowSeconds);
  const local = failMemory.get(`${limit.bucket}|${key}`);
  const localCount = local && local.windowStart === start ? local.count : 0;
  try {
    const { data, error } = await supabase
      .from("aitickets_rate_limits")
      .select("count")
      .eq("bucket", limit.bucket)
      .eq("key_hash", hashRateLimitKey(key))
      .eq("window_start", new Date(start).toISOString())
      .maybeSingle();
    if (error) throw new Error(error.message);
    return Math.max(Number(data?.count) || 0, localCount);
  } catch {
    return localCount;
  }
}

/** Registra un fallo (durable vía rateLimit + respaldo en memoria). */
async function recordFailure(supabase: any, limit: typeof FAIL_EVENT, key: string) {
  const start = windowStartMs(limit.windowSeconds);
  const id = `${limit.bucket}|${key}`;
  const entry = failMemory.get(id);
  if (!entry || entry.windowStart !== start) {
    if (failMemory.size > 5000) failMemory.clear();
    failMemory.set(id, { windowStart: start, count: 1 });
  } else {
    entry.count += 1;
  }
  try {
    await rateLimit(limit.bucket, key, { ...limit, supabase });
  } catch {
    /* falla abierto, igual que rateLimit */
  }
}

const fail = (message: string, reason: string, status: number) => jsonResponse({ valid: false, message, reason }, status);

export const POST: APIRoute = async ({ request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return fail("Solicitud inválida", "bad_request", 400);
  }

  const eventId = Number(body?.eventId);
  if (!Number.isInteger(eventId) || eventId <= 0) return fail("Evento inválido", "bad_request", 400);
  const code = normalizeDiscountCode(body?.code);
  if (!code) return fail(DISCOUNT_MESSAGES.invalid_format, "invalid_format", 400);

  if (!Array.isArray(body?.tickets) || body.tickets.length === 0 || body.tickets.length > MAX_TICKET_LINES) {
    return fail("Selecciona al menos una entrada", "bad_request", 400);
  }
  const quantities = new Map<number, number>();
  for (const t of body.tickets) {
    const id = Number(t?.id);
    const quantity = Number(t?.quantity);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(quantity) || quantity < 0 || quantity > 100) {
      return fail("Selección de entradas inválida", "bad_request", 400);
    }
    if (quantity > 0) quantities.set(id, (quantities.get(id) || 0) + quantity);
  }
  if (!quantities.size) return fail("Selecciona al menos una entrada", "bad_request", 400);

  const supabase = getSupabaseAdmin();
  const ip = clientIpFrom(request);
  const [byIp, byIpEvent] = await Promise.all([
    rateLimit(LIMIT_IP.bucket, ip, { ...LIMIT_IP, supabase }),
    rateLimit(LIMIT_IP_EVENT.bucket, ip === "unknown" ? null : `${ip}|${eventId}`, { ...LIMIT_IP_EVENT, supabase }),
  ]);
  if (!byIp.allowed || !byIpEvent.allowed) return fail(TOO_MANY, "rate_limited", 429);

  try {
    const loadEvent = (cols: string) => supabase.from("events").select(cols).eq("id", eventId).eq("status", "published").maybeSingle();
    let { data: event, error: eventError }: { data: any; error: any } = await loadEvent("id, slug, status, organization_id, fee_absorbed");
    // Base sin events.fee_absorbed (202610090200)
    if (eventError && ["42703", "PGRST204"].includes(String(eventError.code || ""))) ({ data: event, error: eventError } = await loadEvent("id, slug, status, organization_id"));
    if (eventError) throw new Error(eventError.message);
    if (!event || isDemoEventSlug(event.slug)) return fail("El evento no está disponible para la venta", "event", 404);

    const eventKey = `event:${event.id}`;
    const orgKey = `org:${event.organization_id}`;
    const [eventFails, orgFails] = await Promise.all([
      failCount(supabase, FAIL_EVENT, eventKey),
      failCount(supabase, FAIL_ORG, orgKey),
    ]);
    if (eventFails >= FAIL_EVENT.max || orgFails >= FAIL_ORG.max) return fail(TOO_MANY, "rate_limited", 429);

    const { data: tickets, error: ticketsError } = await supabase
      .from("event_tickets")
      .select(TICKET_COLUMNS)
      .eq("event_id", eventId)
      .in("id", [...quantities.keys()]);
    if (ticketsError) throw new Error(ticketsError.message);
    const byId = new Map((tickets || []).map((t: any) => [Number(t.id), t]));
    const now = new Date();
    let grossSubtotal = 0;
    for (const [id, qty] of quantities) {
      const ticket = byId.get(id);
      if (!ticket || !isTicketOnSale(ticket, now)) return fail("Una de las entradas seleccionadas ya no está a la venta", "ticket", 409);
      grossSubtotal += Math.round(Number(ticket.price) || 0) * qty;
    }

    if (grossSubtotal <= 0) return fail(DISCOUNT_MESSAGES.no_subtotal, "no_subtotal", 400);

    const result = await resolveDiscount(supabase, { event, code, grossSubtotal, buyerEmail: null, now });
    if (!result.ok) {
      if (PASS_THROUGH_REASONS.has(result.reason)) return fail(result.message, result.reason, result.status);
      await Promise.all([recordFailure(supabase, FAIL_EVENT, eventKey), recordFailure(supabase, FAIL_ORG, orgKey)]);
      return fail(INVALID_CODE, "not_found", 404);
    }

    const { discount } = result;
    const totals = computeDiscountedTotals(grossSubtotal, discount, { feeAbsorbed: event.fee_absorbed === true });
    return jsonResponse({
      valid: true,
      code: discount.code,
      kind: discount.kind,
      value: discount.value,
      label: discount.label,
      ...totals,
    });
  } catch (error: any) {
    console.error("discount-code error:", error?.message);
    return fail("No pudimos validar el código. Intenta nuevamente.", "error", 500);
  }
};

export const ALL: APIRoute = () => jsonResponse({ message: "Método no permitido" }, 405);
