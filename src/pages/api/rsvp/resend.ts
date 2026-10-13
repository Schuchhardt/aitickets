// POST /api/rsvp/resend — PÚBLICO: reenvía la entrada de una inscripción gratis al mismo email
// (estado "Ya estás inscrito con este email" de la página del evento).
// Request: { eventId, email }
// Respuesta: SIEMPRE 200 { message } si la solicitud es válida (exista o no la inscripción): el correo solo
// llega a la dirección inscrita, así que no se filtra nada a quien lo pide. 400 inválida, 429 demasiados intentos.
// Antiabuso: límite durable por IP y por email (netlify/lib/rate-limit.mjs).
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { jsonResponse } from "../../../lib/supabaseServer";
import { clientIpFrom } from "../../../lib/sites";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";
import { isValidEmail } from "../../../../netlify/lib/mailer.mjs";
import { sendOrderTicketsEmail } from "../../../../netlify/lib/tickets-email.mjs";

export const prerender = false;

const LIMIT_IP = { bucket: "rsvp-resend:ip", windowSeconds: 10 * 60, max: 10 };
const LIMIT_EMAIL = { bucket: "rsvp-resend:email", windowSeconds: 60 * 60, max: 3 };
const DONE = "Listo, revisa tu correo.";

export const POST: APIRoute = async ({ request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ message: "Solicitud inválida" }, 400);
  }
  const eventId = Number(body?.eventId);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : "";
  if (!Number.isInteger(eventId) || eventId <= 0 || !isValidEmail(email)) {
    return jsonResponse({ message: "Revisa tu email, parece incompleto." }, 400);
  }

  const byIp = await rateLimit(LIMIT_IP.bucket, clientIpFrom(request), LIMIT_IP);
  const byEmail = byIp.allowed ? await rateLimit(LIMIT_EMAIL.bucket, `${eventId}|${email}`, LIMIT_EMAIL) : byIp;
  if (!byIp.allowed || !byEmail.allowed) {
    return jsonResponse({ message: "Ya te reenviamos la entrada hace poco. Revisa tu correo (y la carpeta de spam)." }, 429);
  }

  try {
    const { data: orders, error } = await getSupabaseAdmin()
      .from("event_orders")
      .select("id")
      .eq("event_id", eventId)
      .eq("buyer_email", email)
      .eq("status", "paid")
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const orderId = orders?.[0]?.id;
    if (orderId) {
      const result = await sendOrderTicketsEmail(orderId, { force: true });
      if (!result.ok) console.error(`rsvp/resend: no se pudo reenviar la orden ${orderId} (${result.status})`);
    }
  } catch (err: any) {
    console.error("rsvp/resend:", err?.message || err);
  }
  return jsonResponse({ message: DONE }, 200);
};
