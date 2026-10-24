// POST /api/orders/message — PÚBLICO con el id de una orden pagada con entradas vigentes: mensaje del asistente a la
// productora del evento. Se guarda (aitickets_attendee_messages) y se envía por correo al equipo de la productora
// (admin/producer) con Reply-To = asistente; el panel lo muestra en la página del evento.
// Request: { orderId, message } → 200 { ok, message } | 400 | 404 | 429 | 503
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { jsonResponse } from "../../../lib/supabaseServer";
import { clientIpFrom } from "../../../lib/sites";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";
import { sendEmail, isValidEmail, formatRecipient, SITE_URL } from "../../../../netlify/lib/mailer.mjs";
import { renderAttendeeMessageEmail } from "../../../../netlify/lib/emails/index.mjs";
import { orderCopy } from "../../../../netlify/lib/order-kind.mjs";
import {
  MESSAGES_TABLE,
  MESSAGE_MAX,
  isOrderId,
  loadOrderHolder,
  normalizeAttendeeMessage,
  isMissingCommunitySchema,
} from "../../../../netlify/lib/attendee-community.mjs";

export const prerender = false;

const LIMIT_IP = { windowSeconds: 60 * 60, max: 10 };
const LIMIT_ORDER = { windowSeconds: 24 * 60 * 60, max: 5 };
const MAX_RECIPIENTS = 3;

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  const orderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";
  if (!isOrderId(orderId)) return jsonResponse({ message: "Orden no encontrada" }, 400);
  if (typeof body?.message === "string" && body.message.length > MESSAGE_MAX * 2) return jsonResponse({ message: "Tu mensaje es muy largo." }, 400);
  const text = normalizeAttendeeMessage(body?.message);
  if (!text) return jsonResponse({ message: "Escribe tu mensaje." }, 400);

  const byIp = await rateLimit("attendee-message:ip", clientIpFrom(request), LIMIT_IP);
  const byOrder = byIp.allowed ? await rateLimit("attendee-message:order", orderId, LIMIT_ORDER) : byIp;
  if (!byIp.allowed || !byOrder.allowed) return jsonResponse({ message: "Ya enviaste varios mensajes. Espera la respuesta en tu correo." }, 429);

  try {
    const supabase = getSupabaseAdmin();
    const holder = await loadOrderHolder(supabase, orderId);
    if (!holder) return jsonResponse({ message: "Solo quienes tienen entradas vigentes pueden escribirle a la productora." }, 404);
    const { event, email } = holder;
    const name = [holder.firstName, holder.lastName].filter(Boolean).join(" ");

    const { data: saved, error: insertError } = await supabase
      .from(MESSAGES_TABLE)
      .insert({ event_id: event.id, organization_id: event.organization_id, order_id: orderId, email, name: name || null, message: text })
      .select("id")
      .single();
    if (insertError || !saved) throw insertError || new Error("No se pudo guardar el mensaje");

    const [{ data: team }, { data: org }] = await Promise.all([
      supabase.from("users").select("email, active").eq("organization_id", event.organization_id).in("role", ["admin", "producer"]).limit(10),
      supabase.from("organizations").select("public_name").eq("id", event.organization_id).maybeSingle(),
    ]);
    const recipients = [...new Set((team || []).filter((u: any) => u.active !== false && isValidEmail(u.email)).map((u: any) => String(u.email).toLowerCase()))].slice(0, MAX_RECIPIENTS);
    let mailError: string | null = null;
    if (!recipients.length) {
      mailError = "sin_destinatario";
    } else {
      try {
        const mail = await renderAttendeeMessageEmail({
          eventName: event.name,
          name,
          email,
          ticketsLabel: `${holder.liveCount} ${holder.liveCount === 1 ? "entrada" : "entradas"} · ${orderCopy(holder.kind, holder.liveCount).badge}`,
          message: text,
          dashboardUrl: `${SITE_URL}/dashboard/events/${event.id}#mensajes`,
        });
        await sendEmail({ to: recipients, subject: mail.subject, html: mail.html, text: mail.text, replyTo: formatRecipient(name, email), tags: ["attendee-message"] });
      } catch (err: any) {
        console.error("orders/message: error al enviar el correo", err?.message || err);
        mailError = String(err?.message || err || "error").slice(0, 500);
      }
    }
    const { error: updateError } = await supabase
      .from(MESSAGES_TABLE)
      .update(mailError ? { mail_error: mailError } : { delivered_at: new Date().toISOString() })
      .eq("id", saved.id);
    if (updateError) console.error("orders/message: no se pudo registrar el envío", updateError.message);

    const orgName = String(org?.public_name || "").trim();
    return jsonResponse({ ok: true, message: `Listo, ${orgName || "la productora"} recibió tu mensaje. Te responderán a ${email}.` });
  } catch (err: any) {
    if (isMissingCommunitySchema(err)) return jsonResponse({ message: "Los mensajes todavía no están disponibles. Inténtalo más tarde." }, 503);
    console.error("orders/message:", err?.message || err);
    return jsonResponse({ message: "Algo falló de nuestro lado. Inténtalo en unos segundos." }, 500);
  }
};
