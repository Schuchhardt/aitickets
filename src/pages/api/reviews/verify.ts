// POST /api/reviews/verify — PÚBLICO: valida la asistencia con la orden o la entrada y entrega el token para
// calificar (netlify/lib/review-token.mjs). Sirve el link de la orden (/order/<id>) o de una entrada
// (/ticket/<id>), su id o el código del QR: quien los tiene ya puede ver las entradas, así que también calificar.
// Request: { eventId, reference }  → 200 { token, ...sesión } | 400 | 404 | 409 | 429 | 503
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { jsonResponse } from "../../../lib/supabaseServer";
import { clientIpFrom } from "../../../lib/sites";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";
import { parseAttendanceReference, findAttendanceByReference, reviewsOpen } from "../../../../netlify/lib/reviews.mjs";
import { signReviewToken } from "../../../../netlify/lib/review-token.mjs";
import { loadReviewEvent, openReviewSession, sessionPayload, isMissingSchema, REVIEWS_UNAVAILABLE } from "../../../lib/eventReviews";

export const prerender = false;

const LIMIT_IP = { windowSeconds: 10 * 60, max: 20 };

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  const eventId = Number(body?.eventId);
  const ref = parseAttendanceReference(body?.reference);
  if (!Number.isSafeInteger(eventId) || eventId <= 0) return jsonResponse({ message: "Evento inválido" }, 400);
  if (!ref) return jsonResponse({ message: "Pega el link de tu entrada o de tu orden (está en el correo con tus entradas)." }, 400);

  const byIp = await rateLimit("reviews-verify:ip", clientIpFrom(request), LIMIT_IP);
  if (!byIp.allowed) return jsonResponse({ message: "Demasiados intentos. Espera unos minutos." }, 429);

  try {
    const supabase = getSupabaseAdmin();
    const loaded = await loadReviewEvent(eventId, supabase);
    if (!loaded) return jsonResponse({ message: "Este evento no recibe reseñas." }, 404);
    if (!reviewsOpen(loaded.event, loaded.dates)) return jsonResponse({ message: "Podrás calificar cuando empiece el evento." }, 409);
    const attendance = await findAttendanceByReference(supabase, eventId, ref);
    if (!attendance) return jsonResponse({ message: "No encontramos una entrada vigente de este evento con ese link o código." }, 404);
    const token = signReviewToken({ eventId, email: attendance.email, via: attendance.via });
    if (!token) {
      console.error("reviews/verify: falta REVIEW_TOKEN_SECRET (o EMAIL_VERIFY_SECRET/INTERNAL_API_SECRET)");
      return jsonResponse({ message: REVIEWS_UNAVAILABLE }, 503);
    }
    const opened = await openReviewSession(token, { supabase });
    if (!opened.ok) return jsonResponse({ message: opened.message }, opened.status);
    return jsonResponse({ token, verified_via: attendance.via, ...(await sessionPayload(supabase, opened.session)) });
  } catch (err: any) {
    if (isMissingSchema(err)) return jsonResponse({ message: REVIEWS_UNAVAILABLE }, 503);
    console.error("reviews/verify:", err?.message || err);
    return jsonResponse({ message: "Algo falló de nuestro lado. Inténtalo en unos segundos." }, 500);
  }
};
