// Reseñas de eventos del lado del servidor de Astro: sesión de quien califica (token firmado), su reseña y fotos,
// el premio por calificar y lo que se muestra en la página pública. Reglas en netlify/lib/reviews.mjs.
// Lo usan /api/reviews*, /api/events/reviews y src/lib/eventPage.ts. Solo servidor.
import { getSupabaseAdmin } from "./auth-helpers";
import { isDemoEventSlug } from "./demoEvent.mjs";
import {
  REVIEWS_TABLE,
  REVIEW_PHOTOS_TABLE,
  PUBLIC_REVIEWS_PAGE,
  PUBLIC_PHOTOS_MAX,
  MAX_PHOTOS_PER_PERSON,
  normalizeReviewSettings,
  reviewsOpen,
  findAttendanceByEmail,
  summarizeRatings,
  publicReview,
  publicPhoto,
  generateRewardCode,
  rewardLabel,
  maskEmail,
} from "../../netlify/lib/reviews.mjs";
import { verifyReviewToken } from "../../netlify/lib/review-token.mjs";
import { REVIEW_REWARD_SOURCE } from "../../netlify/lib/discounts.mjs";

type Supabase = ReturnType<typeof getSupabaseAdmin>;

/** Tabla o columna aún no creada (deploy previews comparten la BD de producción y no migran). */
export const isMissingSchema = (error: any) => ["42P01", "PGRST205", "42703", "PGRST204"].includes(String(error?.code || ""));

export const REVIEWS_UNAVAILABLE = "Las reseñas aún no están disponibles. Intenta en unos minutos.";

const EVENT_COLUMNS = "id, name, slug, status, organization_id, start_date, end_date, cancelled_at";

export type ReviewSettings = ReturnType<typeof normalizeReviewSettings>;

export interface ReviewEvent {
  event: { id: number; name: string; slug: string; status: string; organization_id: number; start_date: string | null; end_date: string | null };
  settings: ReviewSettings;
  dates: Array<{ id: number; date: string; start_time: string | null; end_time: string | null }>;
}

/** Evento publicado (no demo ni cancelado) con su configuración de reseñas y sus funciones. */
export async function loadReviewEvent(eventId: number, supabase: Supabase = getSupabaseAdmin()): Promise<ReviewEvent | null> {
  if (!Number.isSafeInteger(eventId) || eventId <= 0) return null;
  let { data: event, error }: { data: any; error: any } = await supabase.from("events").select(`${EVENT_COLUMNS}, review_settings`).eq("id", eventId).maybeSingle();
  if (error?.code === "42703") ({ data: event, error } = await supabase.from("events").select(EVENT_COLUMNS).eq("id", eventId).maybeSingle());
  if (error) throw error;
  if (!event || event.status !== "published" || event.cancelled_at || isDemoEventSlug(event.slug)) return null;
  const { data: dates, error: dError } = await supabase.from("event_dates").select("id, date, start_time, end_time").eq("event_id", event.id);
  if (dError) throw dError;
  return { event, settings: normalizeReviewSettings(event.review_settings), dates: dates || [] };
}

export interface ReviewSession extends ReviewEvent {
  email: string;
  /** Cómo se validó la asistencia (va firmado en el token). */
  via: "email_link" | "order" | "ticket";
  attendance: NonNullable<Awaited<ReturnType<typeof findAttendanceByEmail>>>;
}

/**
 * Valida el token de reseña: firma y vigencia, evento publicado y ya empezado, y que el email siga teniendo una
 * entrada vigente (un reembolso posterior la anula).
 */
export async function openReviewSession(
  token: unknown,
  { supabase = getSupabaseAdmin(), now = new Date() }: { supabase?: Supabase; now?: Date } = {},
): Promise<{ ok: true; session: ReviewSession } | { ok: false; status: number; message: string }> {
  const payload = verifyReviewToken(typeof token === "string" ? token : "", { now });
  if (!payload) return { ok: false, status: 401, message: "El link para calificar no es válido o venció. Pide uno nuevo en la página del evento." };
  const loaded = await loadReviewEvent(payload.eventId, supabase);
  if (!loaded) return { ok: false, status: 404, message: "Este evento ya no recibe reseñas." };
  if (!reviewsOpen(loaded.event, loaded.dates, now)) return { ok: false, status: 409, message: "Podrás calificar cuando empiece el evento." };
  const attendance = await findAttendanceByEmail(supabase, loaded.event.id, payload.email);
  if (!attendance) return { ok: false, status: 403, message: "No encontramos una entrada vigente de este evento con tu correo." };
  return { ok: true, session: { ...loaded, email: payload.email, via: payload.via, attendance } };
}

export const REVIEW_COLUMNS = "id, event_id, organization_id, attendee_id, email, display_name, rating, public_comment, private_comment, public_status, verified_via, reward_code_id, reward_code, created_at, updated_at";
export const PHOTO_COLUMNS = "id, event_id, email, display_name, url, thumb_url, width, height, status, created_at";

export async function loadOwnReview(supabase: Supabase, eventId: number, email: string) {
  const { data, error } = await supabase.from(REVIEWS_TABLE).select(REVIEW_COLUMNS).eq("event_id", eventId).eq("email", email).maybeSingle();
  if (error) throw error;
  return data as any;
}

export async function loadOwnPhotos(supabase: Supabase, eventId: number, email: string) {
  const { data, error } = await supabase
    .from(REVIEW_PHOTOS_TABLE)
    .select(PHOTO_COLUMNS)
    .eq("event_id", eventId)
    .eq("email", email)
    .order("created_at", { ascending: true })
    .limit(MAX_PHOTOS_PER_PERSON * 2);
  if (error) throw error;
  return (data || []) as any[];
}

/** Premio entregado (código, etiqueta y vencimiento) de una reseña, o null. */
export async function loadGrantedReward(supabase: Supabase, review: any) {
  if (!review?.reward_code_id) return null;
  const { data } = await supabase.from("aitickets_discount_codes").select("code, value, ends_at, active").eq("id", review.reward_code_id).maybeSingle();
  if (!data) return null;
  return { code: data.code, label: rewardLabel({ value: Number(data.value) }), valid_until: data.ends_at, active: data.active !== false };
}

/** Lo que ve quien califica: su reseña, sus fotos, el premio y los límites. */
export async function sessionPayload(supabase: Supabase, session: ReviewSession) {
  const [review, photos] = await Promise.all([loadOwnReview(supabase, session.event.id, session.email), loadOwnPhotos(supabase, session.event.id, session.email)]);
  return {
    event_id: Number(session.event.id),
    email: maskEmail(session.email),
    name: session.attendance.first_name || null,
    review: review
      ? {
          rating: review.rating,
          public_comment: review.public_comment,
          private_comment: review.private_comment,
          public_status: review.public_status,
          created_at: review.created_at,
          updated_at: review.updated_at,
        }
      : null,
    reward_offer: session.settings.reward ? { label: rewardLabel(session.settings.reward), valid_days: session.settings.reward.valid_days } : null,
    reward: await loadGrantedReward(supabase, review),
    photos: photos.map((p) => ({ id: p.id, url: p.url, thumb_url: p.thumb_url, status: p.status })),
    max_photos: MAX_PHOTOS_PER_PERSON,
    moderate_photos: session.settings.moderate_photos,
  };
}

/**
 * Crea el código de descuento del premio: un solo uso, % sobre cualquier evento de la productora, vence en
 * valid_days. Reintenta si el código al azar ya existía. null si no se pudo.
 */
export async function grantReviewReward(
  supabase: Supabase,
  { organizationId, reward, now = new Date() }: { organizationId: number; reward: { value: number; valid_days: number }; now?: Date },
): Promise<{ id: string; code: string; ends_at: string } | null> {
  const endsAt = new Date(now.getTime() + reward.valid_days * 86400_000).toISOString();
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = generateRewardCode();
    const { data, error } = await supabase
      .from("aitickets_discount_codes")
      .insert([
        {
          organization_id: organizationId,
          event_id: null,
          code,
          kind: "percent",
          value: reward.value,
          max_uses: 1,
          per_buyer_limit: 1,
          starts_at: null,
          ends_at: endsAt,
          active: true,
          created_by: null,
          source: REVIEW_REWARD_SOURCE,
        },
      ])
      .select("id, code, ends_at")
      .single();
    if (!error && data) return data as any;
    if (String(error?.code) !== "23505") {
      console.error("grantReviewReward:", error?.message);
      return null;
    }
  }
  return null;
}

/**
 * Lo que muestra la página pública de un evento terminado: resumen de calificaciones (TODAS cuentan, también las
 * de comentario oculto: ocultar un comentario no cambia el promedio), comentarios públicos visibles y fotos
 * visibles. null si las tablas aún no existen.
 */
export async function loadPublicReviews(
  eventId: number,
  { offset = 0, limit = PUBLIC_REVIEWS_PAGE, withPhotos = true, supabase = getSupabaseAdmin() }: { offset?: number; limit?: number; withPhotos?: boolean; supabase?: Supabase } = {},
) {
  const [ratingsRes, commentsRes, photosRes] = await Promise.all([
    supabase.from(REVIEWS_TABLE).select("rating").eq("event_id", eventId).limit(20000),
    supabase
      .from(REVIEWS_TABLE)
      .select("id, display_name, rating, public_comment, created_at", { count: "exact" })
      .eq("event_id", eventId)
      .eq("public_status", "visible")
      .not("public_comment", "is", null)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1),
    withPhotos
      ? supabase
          .from(REVIEW_PHOTOS_TABLE)
          .select("id, url, thumb_url, width, height, display_name")
          .eq("event_id", eventId)
          .eq("status", "visible")
          .order("created_at", { ascending: true })
          .limit(PUBLIC_PHOTOS_MAX)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const failed = [ratingsRes, commentsRes, photosRes].find((r: any) => r.error);
  if (failed) {
    if (!isMissingSchema((failed as any).error)) console.error("loadPublicReviews:", (failed as any).error?.message);
    return null;
  }
  const reviews = ((commentsRes.data || []) as any[]).map(publicReview);
  return {
    summary: summarizeRatings((ratingsRes.data || []) as any[]),
    reviews,
    comments_total: (commentsRes as any).count ?? reviews.length,
    photos: ((photosRes.data || []) as any[]).map(publicPhoto),
  };
}
