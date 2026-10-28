// POST /api/events/waitlist — PÚBLICO: deja un email en la lista de espera / avisos de un evento publicado
// (cupos llenos, agotado o venta por abrir). Registra en aitickets_event_waitlist; el aviso lo manda
// send-waitlist-notifications (netlify/lib/waitlist.mjs) y el productor ve la lista en su panel.
// Request: { eventId, email, kind?: 'full'|'sold_out'|'sale_opens', functionId?, utm?: {source,medium,campaign} }
// Respuesta: 200 { ok: true } (también si el email ya estaba anotado), 400 inválida, 404 evento, 429, 503.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { jsonResponse } from "../../../lib/supabaseServer";
import { clientIpFrom } from "../../../lib/sites";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";
import { isValidEmail } from "../../../../netlify/lib/mailer.mjs";

export const prerender = false;

const KINDS = new Set(["full", "sold_out", "sale_opens"]);
const LIMIT_IP = { bucket: "waitlist:ip", windowSeconds: 10 * 60, max: 20 };
const clip = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().replace(/[^\w.\-+ ]/g, "").slice(0, 128) || null : null);

export const POST: APIRoute = async ({ request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ message: "Solicitud inválida" }, 400);
  }
  const eventId = Number(body?.eventId);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : "";
  const kind = KINDS.has(body?.kind) ? body.kind : "full";
  const functionId = Number(body?.functionId);
  if (!Number.isInteger(eventId) || eventId <= 0) return jsonResponse({ message: "Evento inválido" }, 400);
  if (!isValidEmail(email)) return jsonResponse({ message: "Revisa tu email, parece incompleto." }, 400);

  const byIp = await rateLimit(LIMIT_IP.bucket, clientIpFrom(request), LIMIT_IP);
  if (!byIp.allowed) return jsonResponse({ message: "Demasiados intentos. Espera unos minutos." }, 429);

  const supabase = getSupabaseAdmin();
  const { data: event } = await supabase.from("events").select("id").eq("id", eventId).eq("status", "published").maybeSingle();
  if (!event) return jsonResponse({ message: "Evento no encontrado" }, 404);

  let eventDateId: number | null = null;
  if (Number.isInteger(functionId) && functionId > 0) {
    const { data: fn } = await supabase.from("event_dates").select("id").eq("id", functionId).eq("event_id", eventId).maybeSingle();
    eventDateId = fn ? Number(fn.id) : null;
  }

  const utm = body?.utm && typeof body.utm === "object" ? body.utm : {};
  const { error } = await supabase.from("aitickets_event_waitlist").insert({
    event_id: eventId,
    event_date_id: eventDateId,
    email,
    kind,
    utm_source: clip(utm.source),
    utm_medium: clip(utm.medium),
    utm_campaign: clip(utm.campaign),
  });
  // 23505: ya estaba anotado (índice único evento + email + tipo) => éxito igual
  if (error && error.code !== "23505") {
    console.error("waitlist:", error.message);
    const missing = error.code === "42P01" || error.code === "PGRST205";
    return jsonResponse({ message: missing ? "La lista de espera aún no está disponible." : "Algo falló de nuestro lado. Inténtalo en unos segundos." }, 503);
  }
  return jsonResponse({ ok: true }, 200);
};
