// POST /api/buyer/access-link — PÚBLICO: envía el link de acceso a "Mis entradas" (netlify/lib/buyer-session.mjs).
// Request: { email } (formulario de /mis-entradas) o { orderId } (botón de la página de una orden: el link va al
// correo del comprador de esa orden, sin escribirlo). Respuesta: SIEMPRE 200 { ok, message } si la solicitud es
// válida, tenga o no entradas ese email (no revela quién compró). Solo se envía si el email tiene alguna orden
// pagada: no sirve para mandar correos a cualquier dirección. 400 inválida, 429 demasiados intentos.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { jsonResponse } from "../../../lib/supabaseServer";
import { clientIpFrom } from "../../../lib/sites";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";
import { isValidEmail, sendEmail, SITE_URL } from "../../../../netlify/lib/mailer.mjs";
import { renderBuyerAccessEmail } from "../../../../netlify/lib/emails/index.mjs";
import { signBuyerLink, safeBuyerNext, BUYER_LINK_TTL_MINUTES } from "../../../../netlify/lib/buyer-session.mjs";
import { hasBuyerOrders } from "../../../../netlify/lib/buyer-orders.mjs";
import { loadOrderHolder, isOrderId } from "../../../../netlify/lib/attendee-community.mjs";
import { maskEmail } from "../../../../netlify/lib/reviews.mjs";

export const prerender = false;

const LIMIT_IP = { windowSeconds: 10 * 60, max: 10 };
const LIMIT_EMAIL = { windowSeconds: 60 * 60, max: 3 };

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await request.json().catch(() => null);
  const orderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";
  const typed = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : "";
  if (orderId ? !isOrderId(orderId) : !isValidEmail(typed)) {
    return jsonResponse({ message: orderId ? "Orden no encontrada" : "Revisa tu email, parece incompleto." }, 400);
  }

  const byIp = await rateLimit("buyer-link:ip", clientIpFrom(request), LIMIT_IP);
  if (!byIp.allowed) return jsonResponse({ message: "Demasiados intentos. Espera unos minutos." }, 429);

  const supabase = getSupabaseAdmin();
  let email = typed;
  let name = "";
  let next = "/mis-entradas";
  if (orderId) {
    const holder = await loadOrderHolder(supabase, orderId).catch(() => null);
    if (!holder) return jsonResponse({ message: "Orden no encontrada" }, 404);
    email = holder.email;
    name = holder.firstName;
    next = safeBuyerNext(`/order/${orderId}`);
  }

  const done = orderId
    ? `Listo. Te enviamos el link a ${maskEmail(email)}: ábrelo en este dispositivo.`
    : "Si ese correo tiene entradas, te enviamos un link para verlas. Revisa tu bandeja de entrada (y spam).";

  const byEmail = await rateLimit("buyer-link:email", email, LIMIT_EMAIL);
  if (!byEmail.allowed) return jsonResponse({ message: "Ya te enviamos un link hace poco. Revisa tu correo (y la carpeta de spam)." }, 429);

  const send = async () => {
    try {
      if (!orderId && !(await hasBuyerOrders(supabase, email))) return;
      const token = signBuyerLink(email);
      if (!token) return console.error("buyer/access-link: falta BUYER_SESSION_SECRET (o EMAIL_VERIFY_SECRET/INTERNAL_API_SECRET)");
      const url = `${SITE_URL}/mis-entradas/acceso?t=${encodeURIComponent(token)}${next !== "/mis-entradas" ? `&next=${encodeURIComponent(next)}` : ""}`;
      const { subject, html, text } = await renderBuyerAccessEmail({ name, url, minutes: BUYER_LINK_TTL_MINUTES });
      await sendEmail({ to: email, subject, html, text, tags: ["buyer-access"] });
    } catch (err: any) {
      console.error("buyer/access-link:", err?.message || err);
    }
  };
  // Sin esperar el envío cuando se puede: el tiempo de respuesta no delata si el email tiene entradas
  const waitUntil = (locals as any)?.netlify?.context?.waitUntil;
  if (typeof waitUntil === "function") waitUntil(send());
  else await send();
  return jsonResponse({ ok: true, message: done });
};
