// Reseñas de un evento.
// GET  ?eventId=&offset= — PÚBLICO: resumen de calificaciones y comentarios públicos visibles (paginados, "Ver
//      más" de la página del evento). Respuesta igual para todos: caché corta en el CDN.
// POST { token, rating, public_comment?, private_comment? } — con token de reseña: crea o actualiza la reseña de
//      quien califica. La primera vez, si la productora configuró premio, crea su código de descuento
//      (un solo uso) y se lo manda por correo. → 200 { review, reward } | 400 | 401 | 403 | 404 | 409 | 429 | 503
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { jsonResponse } from "../../../lib/supabaseServer";
import { clientIpFrom } from "../../../lib/sites";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";
import { sendEmail, SITE_URL } from "../../../../netlify/lib/mailer.mjs";
import { renderReviewThanksEmail } from "../../../../netlify/lib/emails/index.mjs";
import { formatInstantLong } from "../../../../netlify/lib/dates.mjs";
import {
  REVIEWS_TABLE,
  PUBLIC_COMMENT_MAX,
  PRIVATE_COMMENT_MAX,
  PUBLIC_REVIEWS_PAGE,
  normalizeRating,
  normalizeComment,
  reviewDisplayName,
  rewardLabel,
} from "../../../../netlify/lib/reviews.mjs";
import {
  openReviewSession,
  sessionPayload,
  loadOwnReview,
  loadPublicReviews,
  grantReviewReward,
  isMissingSchema,
  REVIEWS_UNAVAILABLE,
} from "../../../lib/eventReviews";

export const prerender = false;

const LIMIT_IP = { windowSeconds: 10 * 60, max: 30 };

export const GET: APIRoute = async ({ url }) => {
  const eventId = Number(url.searchParams.get("eventId"));
  const offset = Math.max(0, Math.min(5000, Math.floor(Number(url.searchParams.get("offset")) || 0)));
  if (!Number.isSafeInteger(eventId) || eventId <= 0) return jsonResponse({ message: "Evento inválido" }, 400);
  const supabase = getSupabaseAdmin();
  const { data: event } = await supabase.from("events").select("id").eq("id", eventId).eq("status", "published").maybeSingle();
  if (!event) return jsonResponse({ message: "Evento no encontrado" }, 404);
  const data = await loadPublicReviews(eventId, { offset, limit: PUBLIC_REVIEWS_PAGE, withPhotos: offset === 0, supabase });
  if (!data) return jsonResponse({ message: REVIEWS_UNAVAILABLE }, 503);
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Netlify-CDN-Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await request.json().catch(() => null);
  const rating = normalizeRating(body?.rating);
  if (!rating) return jsonResponse({ message: "Elige de 1 a 5 estrellas." }, 400);
  const publicComment = normalizeComment(body?.public_comment, PUBLIC_COMMENT_MAX);
  const privateComment = normalizeComment(body?.private_comment, PRIVATE_COMMENT_MAX);

  const byIp = await rateLimit("reviews-submit:ip", clientIpFrom(request), LIMIT_IP);
  if (!byIp.allowed) return jsonResponse({ message: "Demasiados intentos. Espera unos minutos." }, 429);

  try {
    const supabase = getSupabaseAdmin();
    const opened = await openReviewSession(body?.token, { supabase });
    if (!opened.ok) return jsonResponse({ message: opened.message }, opened.status);
    const { session } = opened;
    const now = new Date().toISOString();
    const fields = {
      rating,
      public_comment: publicComment,
      private_comment: privateComment,
      display_name: reviewDisplayName(session.attendance.first_name, session.attendance.last_name),
      attendee_id: session.attendance.attendeeId,
      updated_at: now,
    };

    // Insertar primero: si ya existía (23505) se actualiza. Solo quien inserta entrega el premio, así dos envíos
    // simultáneos nunca crean dos códigos.
    let created = false;
    const existing = await loadOwnReview(supabase, session.event.id, session.email);
    if (!existing) {
      const { error } = await supabase.from(REVIEWS_TABLE).insert({
        ...fields,
        event_id: session.event.id,
        organization_id: session.event.organization_id,
        email: session.email,
        verified_via: session.via,
        created_at: now,
      });
      if (error && String(error.code) !== "23505") throw error;
      created = !error;
    }
    if (!created) {
      const { error } = await supabase.from(REVIEWS_TABLE).update(fields).eq("event_id", session.event.id).eq("email", session.email);
      if (error) throw error;
    }

    let reward: { code: string; label: string; valid_until: string } | null = null;
    if (created && session.settings.reward) {
      const granted = await grantReviewReward(supabase, { organizationId: Number(session.event.organization_id), reward: session.settings.reward });
      if (granted) {
        await supabase.from(REVIEWS_TABLE).update({ reward_code_id: granted.id, reward_code: granted.code }).eq("event_id", session.event.id).eq("email", session.email);
        reward = { code: granted.code, label: rewardLabel(session.settings.reward), valid_until: granted.ends_at };
        const sendThanks = async () => {
          try {
            const { data: org } = await supabase.from("organizations").select("public_name, website").eq("id", session.event.organization_id).maybeSingle();
            const { subject, html, text } = await renderReviewThanksEmail({
              eventName: session.event.name,
              organizerName: org?.public_name || "",
              rewardCode: granted.code,
              rewardLabel: reward!.label,
              validUntil: formatInstantLong(granted.ends_at, false),
              eventsUrl: org?.website || `${SITE_URL}/eventos`,
            });
            await sendEmail({ to: session.email, subject, html, text, tags: ["review-reward"], idempotencyKey: `review-reward-${granted.id}` });
          } catch (err: any) {
            console.error("reviews: correo del premio:", err?.message || err);
          }
        };
        const waitUntil = (locals as any)?.netlify?.context?.waitUntil;
        if (typeof waitUntil === "function") waitUntil(sendThanks());
        else await sendThanks();
      }
    }

    const payload = await sessionPayload(supabase, session);
    return jsonResponse({ ...payload, created, reward: reward || payload.reward });
  } catch (err: any) {
    if (isMissingSchema(err)) return jsonResponse({ message: REVIEWS_UNAVAILABLE }, 503);
    console.error("reviews POST:", err?.message || err);
    return jsonResponse({ message: "No pudimos guardar tu reseña. Inténtalo en unos segundos." }, 500);
  }
};
