// Videos de los asistentes para la galería del evento (aitickets_event_review_photos con media_type 'video', migración
// 202611080400). Pesan demasiado para pasar por las funciones de Netlify (cuerpo máx. ~6 MB): se suben directo a
// Supabase Storage con una URL firmada, igual que el video de portada (src/lib/videoStorage.ts).
// POST JSON { token, action: "upload_url", contentType, size, duration? }
//      → 200 { uploadUrl, publicUrl, max_bytes } | 400 | 401 | 403 | 409 (límite) | 429 | 503
//      URL firmada de un solo uso en event-attendee-videos/<evento>/ (sin datos personales en la ruta).
// POST multipart { token, action: "set", url, width?, height?, duration?, poster? }
//      → 201 { video, photos, message } | 400 | 401 | 403 | 409 | 429 | 503
//      Verifica que el archivo esté en la carpeta de ESTE evento, sea MP4/WEBM/MOV y no supere ATTENDEE_VIDEO_MAX_BYTES
//      (si no, lo borra). poster: un cuadro del video que saca el navegador (JPG/PNG/WEBP), se guarda optimizado.
//      Queda visible al tiro, o pendiente si la productora revisa las fotos antes (moderate_photos).
// Para borrar uno: /api/reviews/photos (action "delete"), que también borra el archivo de Storage.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { jsonResponse } from "../../../lib/supabaseServer";
import { clientIpFrom } from "../../../lib/sites";
import { sniffImageType, IMAGE_EXT } from "../../../lib/imageOptimize";
import { storeOptimizedImage } from "../../../lib/imageStorage";
import { EVENT_VIDEO_TYPES } from "../../../lib/eventVideo";
import { attendeeVideoPathPrefix, createVideoUploadAt, ownVideoLocationAt, removeVideoAt, verifyUploadedVideo, VideoStorageError } from "../../../lib/videoStorage";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";
import {
  REVIEW_PHOTOS_TABLE,
  MAX_VIDEOS_PER_PERSON,
  ATTENDEE_VIDEO_MAX_BYTES,
  ATTENDEE_VIDEO_MAX_SECONDS,
  reviewDisplayName,
} from "../../../../netlify/lib/reviews.mjs";
import { openReviewSession, loadOwnPhotos, countMedia, ownMediaItem, isMissingSchema, REVIEWS_UNAVAILABLE, PHOTO_COLUMNS } from "../../../lib/eventReviews";

export const prerender = false;

const LIMIT_IP = { windowSeconds: 10 * 60, max: 20 };
const POSTER_MAX_BYTES = 5 * 1024 * 1024;
const MB = Math.round(ATTENDEE_VIDEO_MAX_BYTES / (1024 * 1024));
const FORMAT_ERROR = "Formato no soportado: usa MP4 (recomendado), WEBM o MOV.";
const TOO_BIG = `El video pesa más de ${MB} MB. Recórtalo o grábalo en menor calidad y vuelve a intentarlo.`;
const TOO_LONG = `El video dura más de ${ATTENDEE_VIDEO_MAX_SECONDS} segundos. Recórtalo y vuelve a intentarlo.`;
const LIMIT_REACHED = `Puedes subir hasta ${MAX_VIDEOS_PER_PERSON} videos. Borra alguno para subir otro.`;

const positiveInt = (v: unknown, max: number) => {
  const n = Math.round(Number(v));
  return v !== null && v !== "" && Number.isFinite(n) && n > 0 && n <= max ? n : null;
};
/** Segundos que informó el navegador, con 1 s de margen por redondeo. true = demasiado largo. */
const tooLong = (duration: number | null) => duration !== null && duration > ATTENDEE_VIDEO_MAX_SECONDS + 1;

/** Póster del video (un cuadro que sacó el navegador), optimizado en el bucket de imágenes. null si no vino o no sirve. */
async function storePoster(file: unknown, eventId: number): Promise<string | null> {
  if (!file || typeof file === "string" || (file as File).size > POSTER_MAX_BYTES) return null;
  try {
    const buffer = Buffer.from(await (file as File).arrayBuffer());
    const contentType = sniffImageType(buffer);
    if (!contentType || !IMAGE_EXT[contentType]) return null;
    const stored = await storeOptimizedImage(buffer, contentType, { pathPrefix: `event-attendee-photos/${eventId}/poster`, maxSize: 1280 });
    return stored.url;
  } catch (err: any) {
    console.error("reviews/videos (póster):", err?.message || err);
    return null;
  }
}

export const POST: APIRoute = async ({ request }) => {
  const byIp = await rateLimit("reviews-videos:ip", clientIpFrom(request), LIMIT_IP);
  if (!byIp.allowed) return jsonResponse({ message: "Demasiados videos seguidos. Espera unos minutos." }, 429);

  const isJson = (request.headers.get("content-type") || "").includes("application/json");
  try {
    const supabase = getSupabaseAdmin();

    if (isJson) {
      const body = await request.json().catch(() => null);
      if (body?.action !== "upload_url") return jsonResponse({ message: "Solicitud inválida" }, 400);
      const contentType = String(body.contentType || "").toLowerCase();
      const size = Number(body.size);
      if (!EVENT_VIDEO_TYPES[contentType]) return jsonResponse({ message: FORMAT_ERROR }, 400);
      if (!Number.isFinite(size) || size <= 0) return jsonResponse({ message: "Archivo de video no válido." }, 400);
      if (size > ATTENDEE_VIDEO_MAX_BYTES) return jsonResponse({ message: TOO_BIG }, 400);
      if (tooLong(positiveInt(body.duration, 24 * 3600))) return jsonResponse({ message: TOO_LONG }, 400);
      const opened = await openReviewSession(body.token, { supabase });
      if (!opened.ok) return jsonResponse({ message: opened.message }, opened.status);
      const { session } = opened;
      if (countMedia(await loadOwnPhotos(supabase, session.event.id, session.email)).videos >= MAX_VIDEOS_PER_PERSON) {
        return jsonResponse({ message: LIMIT_REACHED }, 409);
      }
      const upload = await createVideoUploadAt(attendeeVideoPathPrefix(Number(session.event.id)), contentType);
      return jsonResponse({ uploadUrl: upload.uploadUrl, publicUrl: upload.publicUrl, max_bytes: ATTENDEE_VIDEO_MAX_BYTES });
    }

    const form = await request.formData().catch(() => null);
    if (form?.get("action") !== "set") return jsonResponse({ message: "Solicitud inválida" }, 400);
    const opened = await openReviewSession(form.get("token"), { supabase });
    if (!opened.ok) return jsonResponse({ message: opened.message }, opened.status);
    const { session } = opened;
    const eventId = Number(session.event.id);
    const url = form.get("url");
    const location = ownVideoLocationAt(url, attendeeVideoPathPrefix(eventId));
    if (!location) return jsonResponse({ message: "Video no válido." }, 400);

    const current = await loadOwnPhotos(supabase, eventId, session.email);
    // Confirmar dos veces el mismo archivo (doble clic, reintento) no lo duplica
    const already = current.find((p) => p.url === url);
    if (already) return jsonResponse({ video: ownMediaItem(already), photos: current.map(ownMediaItem) });
    // Las URLs de los videos visibles son públicas: nadie puede reclamar como suyo (y luego borrar) el video de otro
    const { data: taken, error: takenError } = await supabase.from(REVIEW_PHOTOS_TABLE).select("id").eq("event_id", eventId).eq("url", String(url)).limit(1);
    if (takenError) throw takenError;
    if (taken?.length) return jsonResponse({ message: "Video no válido." }, 400);
    if (countMedia(current).videos >= MAX_VIDEOS_PER_PERSON) {
      await removeVideoAt(location);
      return jsonResponse({ message: LIMIT_REACHED }, 409);
    }
    const duration = positiveInt(form.get("duration"), 3600);
    if (tooLong(duration)) {
      await removeVideoAt(location);
      return jsonResponse({ message: TOO_LONG }, 400);
    }
    await verifyUploadedVideo(location, { maxBytes: ATTENDEE_VIDEO_MAX_BYTES });

    const { data: video, error } = await supabase
      .from(REVIEW_PHOTOS_TABLE)
      .insert({
        event_id: eventId,
        organization_id: session.event.organization_id,
        email: session.email,
        display_name: reviewDisplayName(session.attendance.first_name, session.attendance.last_name),
        media_type: "video",
        url: String(url),
        thumb_url: await storePoster(form.get("poster"), eventId),
        width: positiveInt(form.get("width"), 20000),
        height: positiveInt(form.get("height"), 20000),
        duration,
        status: session.settings.moderate_photos ? "pending" : "visible",
      })
      .select(PHOTO_COLUMNS)
      .single();
    if (error) {
      await removeVideoAt(location);
      throw error;
    }
    return jsonResponse(
      {
        video: ownMediaItem(video),
        photos: [...current, video].map(ownMediaItem),
        message: video.status === "pending" ? "¡Gracias! Tu video se publicará cuando la productora lo revise." : "¡Listo! Tu video ya está en la galería.",
      },
      201,
    );
  } catch (err: any) {
    if (err instanceof VideoStorageError) return jsonResponse({ message: err.message }, err.status);
    if (isMissingSchema(err)) return jsonResponse({ message: REVIEWS_UNAVAILABLE }, 503);
    console.error("reviews/videos:", err?.message || err);
    return jsonResponse({ message: "No pudimos subir el video. Inténtalo de nuevo." }, 500);
  }
};
