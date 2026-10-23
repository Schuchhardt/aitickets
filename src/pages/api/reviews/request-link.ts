// POST /api/reviews/request-link — PÚBLICO: "Validar con mi correo". Si el email tiene una entrada vigente del
// evento, le envía su link personal para calificar. Siempre responde lo mismo (no revela quién compró).
// Request: { eventId, email } → 200 { ok: true } | 400 | 404 | 409 | 429
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { jsonResponse } from "../../../lib/supabaseServer";
import { clientIpFrom } from "../../../lib/sites";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";
import { isValidEmail, sendEmail } from "../../../../netlify/lib/mailer.mjs";
import { renderReviewLinkEmail } from "../../../../netlify/lib/emails/index.mjs";
import { findAttendanceByEmail, reviewsOpen } from "../../../../netlify/lib/reviews.mjs";
import { signReviewToken } from "../../../../netlify/lib/review-token.mjs";
import { reviewLinks } from "../../../../netlify/lib/review-requests.mjs";
import { loadReviewEvent } from "../../../lib/eventReviews";

export const prerender = false;

const LIMIT_IP = { windowSeconds: 10 * 60, max: 10 };
const LIMIT_EMAIL = { windowSeconds: 60 * 60, max: 3 };

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await request.json().catch(() => null);
  const eventId = Number(body?.eventId);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : "";
  if (!Number.isSafeInteger(eventId) || eventId <= 0) return jsonResponse({ message: "Evento inválido" }, 400);
  if (!isValidEmail(email)) return jsonResponse({ message: "Revisa tu email, parece incompleto." }, 400);

  const byIp = await rateLimit("reviews-link:ip", clientIpFrom(request), LIMIT_IP);
  if (!byIp.allowed) return jsonResponse({ message: "Demasiados intentos. Espera unos minutos." }, 429);

  const supabase = getSupabaseAdmin();
  const loaded = await loadReviewEvent(eventId, supabase).catch(() => null);
  if (!loaded) return jsonResponse({ message: "Este evento no recibe reseñas." }, 404);
  if (!reviewsOpen(loaded.event, loaded.dates)) return jsonResponse({ message: "Podrás calificar cuando empiece el evento." }, 409);

  // Mismo límite por email aunque no tenga entradas: nadie puede usar el formulario para llenar una casilla
  const byEmail = await rateLimit("reviews-link:email", `${eventId}:${email}`, LIMIT_EMAIL);
  if (byEmail.allowed) {
    const send = async () => {
      try {
        const attendance = await findAttendanceByEmail(supabase, eventId, email);
        if (!attendance) return;
        const token = signReviewToken({ eventId, email: attendance.email });
        if (!token) return console.error("reviews/request-link: falta REVIEW_TOKEN_SECRET");
        const { subject, html, text } = await renderReviewLinkEmail({ eventName: loaded.event.name, reviewUrl: reviewLinks(loaded.event.slug, token).review });
        await sendEmail({ to: email, subject, html, text, tags: ["review-link"] });
      } catch (err: any) {
        console.error("reviews/request-link:", err?.message || err);
      }
    };
    // Sin esperar el envío (responde igual tenga o no entradas: el tiempo de respuesta no lo delata)
    const waitUntil = (locals as any)?.netlify?.context?.waitUntil;
    if (typeof waitUntil === "function") waitUntil(send());
    else await send();
  }
  return jsonResponse({ ok: true, message: "Si ese correo tiene entradas para este evento, te enviamos un link para calificar. Revisa tu bandeja de entrada (y spam)." });
};
