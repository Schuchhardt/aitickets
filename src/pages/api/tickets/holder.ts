// POST /api/tickets/holder — PÚBLICO con el id de una entrada (event_attendees.id): la persona de ese QR completa su
// nombre y sus respuestas a las preguntas por persona (events.checkout_fields, src/lib/checkoutFields.mjs). Es el
// formulario "Completa tus datos" de /ticket/<id>, al que llega el invitado desde su correo.
// Autorización: el id de la entrada (uuid aleatorio) es la misma llave que abre /ticket/<id>. Con ella solo se cambian
// holder_name y registration_answers de ESA entrada (nunca el correo, el QR ni la orden), y solo si la entrada está
// vigente, su orden pagada y el evento no terminó. Límite durable por IP y por entrada.
// Request: { ticketId, name?, answers?: { [preguntaId]: valor } }
// → 200 { ok, name, answers, missing } | 400 { message, field? } | 404 | 409 | 429 | 503
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { jsonResponse } from "../../../lib/supabaseServer";
import { clientIpFrom } from "../../../lib/sites";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";
import { asksAttendeeData, validateHolderUpdate, missingAttendeeData } from "../../../lib/checkoutFields.mjs";
import { isMissingColumn, eventEnded } from "../../../lib/attendeeHolder.mjs";

export const prerender = false;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMIT_IP = { windowSeconds: 10 * 60, max: 30 };
const LIMIT_TICKET = { windowSeconds: 60 * 60, max: 10 };
const NOT_FOUND = "No encontramos esta entrada. Revisa que el link esté completo.";

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  const ticketId = typeof body?.ticketId === "string" ? body.ticketId.trim() : "";
  if (!UUID_RE.test(ticketId)) return jsonResponse({ message: NOT_FOUND }, 400);

  const byIp = await rateLimit("ticket-holder:ip", clientIpFrom(request), LIMIT_IP);
  const byTicket = byIp.allowed ? await rateLimit("ticket-holder:ticket", ticketId, LIMIT_TICKET) : byIp;
  if (!byIp.allowed || !byTicket.allowed) return jsonResponse({ message: "Hiciste varios cambios seguidos. Espera un rato e intenta de nuevo." }, 429);

  const supabase = getSupabaseAdmin();
  const { data: ticket, error } = await supabase
    .from("event_attendees")
    .select("id, event_id, status, event_order_id, holder_name, holder_email, registration_answers")
    .eq("id", ticketId)
    .maybeSingle();
  if (error) {
    if (isMissingColumn(error)) return jsonResponse({ message: "Todavía no se pueden completar los datos aquí. Escríbele a la productora." }, 503);
    console.error("tickets/holder:", error.message);
    return jsonResponse({ message: "No pudimos guardar tus datos. Intenta de nuevo." }, 500);
  }
  if (!ticket) return jsonResponse({ message: NOT_FOUND }, 404);
  if (ticket.status === "cancelled") return jsonResponse({ message: "Esta entrada fue anulada." }, 409);

  const [{ data: order }, { data: event, error: eventError }] = await Promise.all([
    ticket.event_order_id
      ? supabase.from("event_orders").select("status, buyer_email, registration_answers").eq("id", ticket.event_order_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("events").select("id, checkout_fields, start_date, end_date").eq("id", ticket.event_id).maybeSingle(),
  ]);
  if (ticket.event_order_id && (order as any)?.status !== "paid") return jsonResponse({ message: "Esta entrada todavía no está confirmada." }, 409);
  if (eventError || !event) return jsonResponse({ message: NOT_FOUND }, 404);
  if (eventEnded(event)) return jsonResponse({ message: "El evento ya terminó: ya no se pueden cambiar los datos." }, 409);
  const fields = (event as any).checkout_fields;
  if (!asksAttendeeData(fields)) return jsonResponse({ message: "Este evento no pide datos de cada persona." }, 409);

  const check = validateHolderUpdate(fields, body, { currentName: ticket.holder_name });
  if (check.error) return jsonResponse({ message: check.error, field: check.field }, 400);

  const patch: Record<string, unknown> = { registration_answers: check.answers };
  if (check.name) patch.holder_name = check.name;
  const { error: updateError } = await supabase.from("event_attendees").update(patch).eq("id", ticket.id);
  if (updateError) {
    if (isMissingColumn(updateError)) return jsonResponse({ message: "Todavía no se pueden completar los datos aquí. Escríbele a la productora." }, 503);
    console.error("tickets/holder: no se pudo guardar:", updateError.message);
    return jsonResponse({ message: "No pudimos guardar tus datos. Intenta de nuevo." }, 500);
  }

  const missing = missingAttendeeData(fields, { ...ticket, ...patch }, { buyerEmail: (order as any)?.buyer_email, orderAnswers: (order as any)?.registration_answers });
  return jsonResponse({ ok: true, name: check.name, answers: check.answers || [], missing }, 200);
};
