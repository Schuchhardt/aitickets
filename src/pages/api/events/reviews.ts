// Reseñas de un evento desde el panel (EventReviewsManager.vue).
// GET  ?eventId=  → { settings, summary, reviews, photos, stats, ended, upcoming_events, invitations }
//      reviews incluye email y comentario privado (solo la productora los ve).
// POST { eventId, action: "settings", enabled?, reward: { value, valid_days } | null, moderate_photos?, show_while_on_sale? }
//      → { settings }
// POST { eventId, action: "review_status", id, public_status: "visible" | "hidden" } → { ok }
//      (ocultar un comentario NO cambia el promedio: todas las calificaciones cuentan)
// POST { eventId, action: "photo_status", id, status: "visible" | "hidden" } → { ok }
// POST { eventId, action: "photo_delete", id } → { ok }
// Los cambios que se ven en la página pública vacían su caché (src/middleware.ts, PURGE_ON_WRITE). Las
// invitaciones al próximo evento van por /api/events/invitations (no tocan la página).
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, jsonResponse, type SessionContext } from "../../../lib/supabaseServer";
import { isMissingSchema, REVIEWS_UNAVAILABLE } from "../../../lib/eventReviews";
import { recentInvitations } from "../../../lib/invitations";
import { isEventEnded } from "../../../components/event/eventView.js";
import {
  REVIEWS_TABLE,
  REVIEW_PHOTOS_TABLE,
  REVIEW_REQUEST_TYPE,
  INVITE_AUDIENCES,
  REWARD_LIMITS,
  normalizeReviewSettings,
  summarizeRatings,
  functionEndsAt,
} from "../../../../netlify/lib/reviews.mjs";
import { formatFunctionLabel } from "../../../../netlify/lib/dates.mjs";

export const prerender = false;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authorize(context: Parameters<typeof getSessionContext>[0], eventId: number): Promise<{ session: SessionContext } | Response> {
  const session = await getSessionContext(context);
  if (!session) return jsonResponse({ message: "No autorizado" }, 401);
  if (!hasRole(session.dbUser, EVENT_MANAGER_ROLES)) return jsonResponse({ message: "No tienes permisos para ver las reseñas" }, 403);
  if (!Number.isSafeInteger(eventId) || eventId <= 0) return jsonResponse({ message: "eventId es obligatorio" }, 400);
  const event = await getOwnedEvent(eventId, session.dbUser.organization_id, "id", session.dbUser.id);
  if (!event) return jsonResponse({ message: "Evento no encontrado" }, 404);
  return { session };
}

const failure = (error: any, label: string) => {
  if (isMissingSchema(error)) return jsonResponse({ message: REVIEWS_UNAVAILABLE }, 503);
  console.error(`events/reviews (${label}):`, error?.message || error);
  return jsonResponse({ message: "No se pudo completar la acción" }, 500);
};

/** Eventos próximos y publicados de la organización (a los que se puede invitar). */
async function upcomingEvents(supabase: any, organizationId: number, excludeId: number) {
  const { data: events } = await supabase
    .from("events")
    .select("id, name, status, cancelled_at, end_date, start_date, event_dates ( id, date, start_time, end_time )")
    .eq("organization_id", organizationId)
    .eq("status", "published")
    .order("start_date", { ascending: true })
    .limit(200);
  const now = Date.now();
  return (events || [])
    .filter((e: any) => String(e.id) !== String(excludeId) && !e.cancelled_at)
    .map((e: any) => {
      const dates = (e.event_dates || []).slice().sort((a: any, b: any) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`));
      const next = dates.find((d: any) => (functionEndsAt(d)?.getTime() ?? 0) > now);
      const upcoming = dates.length ? Boolean(next) : Boolean(e.end_date || e.start_date) && new Date(e.end_date || e.start_date).getTime() > now;
      return upcoming ? { id: Number(e.id), name: e.name, date_label: next ? formatFunctionLabel(next, { withPlace: false }) : "" } : null;
    })
    .filter(Boolean);
}

export const GET: APIRoute = async (context) => {
  const eventId = Number(new URL(context.request.url).searchParams.get("eventId"));
  const auth = await authorize(context, eventId);
  if (auth instanceof Response) return auth;
  const orgId = Number(auth.session.dbUser.organization_id);
  const supabase = getSupabaseAdmin();

  let { data: event, error: eventError }: { data: any; error: any } = await supabase.from("events").select("id, end_date, review_settings").eq("id", eventId).maybeSingle();
  if (eventError?.code === "42703") ({ data: event, error: eventError } = await supabase.from("events").select("id, end_date").eq("id", eventId).maybeSingle());
  if (eventError) return failure(eventError, "event");

  const [reviewsRes, photosRes, requestsRes, datesRes] = await Promise.all([
    supabase
      .from(REVIEWS_TABLE)
      .select("id, email, display_name, rating, public_comment, private_comment, public_status, verified_via, reward_code_id, reward_code, created_at, updated_at")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(2000),
    supabase.from(REVIEW_PHOTOS_TABLE).select("id, email, display_name, url, thumb_url, status, created_at").eq("event_id", eventId).order("created_at", { ascending: false }).limit(500),
    supabase.from("notification_log").select("id", { count: "exact", head: true }).eq("event_id", eventId).eq("type", REVIEW_REQUEST_TYPE),
    supabase.from("event_dates").select("id, date, start_time, end_time").eq("event_id", eventId),
  ]);
  const unavailable = [reviewsRes, photosRes].some((r: any) => r.error && isMissingSchema(r.error));
  if (!unavailable) {
    const failed = [reviewsRes, photosRes].find((r: any) => r.error);
    if (failed) return failure((failed as any).error, "list");
  }
  const reviews = (reviewsRes.data || []) as any[];

  // Premios entregados y usados (órdenes pagadas con el código)
  const rewardIds = reviews.map((r) => r.reward_code_id).filter(Boolean);
  let rewardsUsed = 0;
  if (rewardIds.length) {
    const { data: stats } = await supabase.rpc("aitickets_discount_code_stats", { p_code_ids: rewardIds });
    rewardsUsed = (stats || []).filter((s: any) => Number(s.paid_orders) > 0).length;
  }

  const dates = (datesRes.data || []).map((d: any) => {
    const end = functionEndsAt(d);
    return { end_iso: end ? end.toISOString() : null };
  });
  const ended = isEventEnded({ dates, end_date: event?.end_date }, new Date());

  return jsonResponse({
    unavailable,
    settings: normalizeReviewSettings(event?.review_settings),
    reward_limits: REWARD_LIMITS,
    audiences: INVITE_AUDIENCES,
    ended,
    summary: summarizeRatings(reviews),
    reviews: reviews.map((r) => ({
      id: r.id,
      name: r.display_name || "Asistente",
      email: r.email,
      rating: r.rating,
      public_comment: r.public_comment,
      private_comment: r.private_comment,
      public_status: r.public_status,
      reward_code: r.reward_code,
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
    photos: ((photosRes.data || []) as any[]).map((p) => ({ id: p.id, url: p.url, thumb_url: p.thumb_url, status: p.status, name: p.display_name, email: p.email, created_at: p.created_at })),
    stats: { requests_sent: requestsRes.count || 0, rewards_granted: rewardIds.length, rewards_used: rewardsUsed },
    upcoming_events: await upcomingEvents(supabase, orgId, eventId),
    invitations: await recentInvitations(supabase, orgId, eventId),
  });
};

export const POST: APIRoute = async (context) => {
  const body = await context.request.json().catch(() => null);
  const eventId = Number(body?.eventId);
  const auth = await authorize(context, eventId);
  if (auth instanceof Response) return auth;
  const { dbUser } = auth.session;
  const orgId = Number(dbUser.organization_id);
  const supabase = getSupabaseAdmin();

  switch (body?.action) {
    case "settings": {
      const { data: current, error: loadError } = await supabase.from("events").select("review_settings").eq("id", eventId).maybeSingle();
      if (loadError) return failure(loadError, "settings");
      const prev = normalizeReviewSettings(current?.review_settings);
      const next = normalizeReviewSettings({
        enabled: typeof body.enabled === "boolean" ? body.enabled : prev.enabled,
        reward: body.reward === undefined ? prev.reward : body.reward,
        moderate_photos: typeof body.moderate_photos === "boolean" ? body.moderate_photos : prev.moderate_photos,
        show_while_on_sale: typeof body.show_while_on_sale === "boolean" ? body.show_while_on_sale : prev.show_while_on_sale,
      });
      if (body.reward && !next.reward) return jsonResponse({ message: `El premio debe ser entre ${REWARD_LIMITS.minValue}% y ${REWARD_LIMITS.maxValue}%.` }, 400);
      const { error } = await supabase.from("events").update({ review_settings: next }).eq("id", eventId).eq("organization_id", orgId);
      if (error) return failure(error, "settings");
      return jsonResponse({ settings: next });
    }

    case "review_status": {
      if (!UUID_RE.test(String(body.id)) || !["visible", "hidden"].includes(body.public_status)) return jsonResponse({ message: "Solicitud inválida" }, 400);
      const { data, error } = await supabase
        .from(REVIEWS_TABLE)
        .update({ public_status: body.public_status })
        .eq("id", body.id)
        .eq("event_id", eventId)
        .select("id");
      if (error) return failure(error, "review_status");
      if (!data?.length) return jsonResponse({ message: "Reseña no encontrada" }, 404);
      return jsonResponse({ ok: true });
    }

    case "photo_status": {
      if (!UUID_RE.test(String(body.id)) || !["visible", "hidden"].includes(body.status)) return jsonResponse({ message: "Solicitud inválida" }, 400);
      const { data, error } = await supabase.from(REVIEW_PHOTOS_TABLE).update({ status: body.status }).eq("id", body.id).eq("event_id", eventId).select("id");
      if (error) return failure(error, "photo_status");
      if (!data?.length) return jsonResponse({ message: "Foto no encontrada" }, 404);
      return jsonResponse({ ok: true });
    }

    case "photo_delete": {
      if (!UUID_RE.test(String(body.id))) return jsonResponse({ message: "Foto no válida" }, 400);
      const { error } = await supabase.from(REVIEW_PHOTOS_TABLE).delete().eq("id", body.id).eq("event_id", eventId);
      if (error) return failure(error, "photo_delete");
      return jsonResponse({ ok: true });
    }

    default:
      return jsonResponse({ message: "Acción no válida" }, 400);
  }
};
