// POST /api/reviews/session — PÚBLICO con token de reseña: lo que ve quien califica (su reseña, sus fotos y el
// premio). Request: { token } → 200 { ...sesión } | 401 | 403 | 404 | 409 | 503
// POST (no GET) para que el token no quede en logs ni en la caché.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { jsonResponse } from "../../../lib/supabaseServer";
import { openReviewSession, sessionPayload, isMissingSchema, REVIEWS_UNAVAILABLE } from "../../../lib/eventReviews";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  try {
    const supabase = getSupabaseAdmin();
    const opened = await openReviewSession(body?.token, { supabase });
    if (!opened.ok) return jsonResponse({ message: opened.message }, opened.status);
    return jsonResponse(await sessionPayload(supabase, opened.session));
  } catch (err: any) {
    if (isMissingSchema(err)) return jsonResponse({ message: REVIEWS_UNAVAILABLE }, 503);
    console.error("reviews/session:", err?.message || err);
    return jsonResponse({ message: "Algo falló de nuestro lado. Inténtalo en unos segundos." }, 500);
  }
};
