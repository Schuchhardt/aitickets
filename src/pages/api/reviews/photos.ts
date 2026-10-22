// Fotos de los asistentes para la galería compartida del evento (aitickets_event_review_photos).
// POST multipart { token, file } — con token de reseña: sube una foto (JPG/PNG/WEBP/GIF, máx. 5 MB; el navegador
//      ya la achica) y la deja visible, o pendiente si la productora revisa las fotos antes de publicarlas.
//      → 201 { photo, photos } | 400 | 401 | 403 | 409 (límite) | 429 | 503
// POST JSON { token, action: "delete", id } — quien la subió la borra. → 200 { photos }
// Se optimizan como las de la galería del productor (src/lib/imageStorage.ts) y se guardan en
// event-attendee-photos/<evento>/ sin datos personales en la ruta.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { jsonResponse } from "../../../lib/supabaseServer";
import { clientIpFrom } from "../../../lib/sites";
import { sniffImageType, IMAGE_EXT } from "../../../lib/imageOptimize";
import { storeOptimizedImage } from "../../../lib/imageStorage";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";
import { REVIEW_PHOTOS_TABLE, MAX_PHOTOS_PER_PERSON, reviewDisplayName } from "../../../../netlify/lib/reviews.mjs";
import { openReviewSession, loadOwnPhotos, isMissingSchema, REVIEWS_UNAVAILABLE, PHOTO_COLUMNS } from "../../../lib/eventReviews";

export const prerender = false;

const MAX_BYTES = 5 * 1024 * 1024;
const LIMIT_IP = { windowSeconds: 10 * 60, max: 40 };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ownList = (rows: any[]) => rows.map((p) => ({ id: p.id, url: p.url, thumb_url: p.thumb_url, status: p.status }));

export const POST: APIRoute = async ({ request }) => {
  const byIp = await rateLimit("reviews-photos:ip", clientIpFrom(request), LIMIT_IP);
  if (!byIp.allowed) return jsonResponse({ message: "Demasiadas fotos seguidas. Espera unos minutos." }, 429);

  const isJson = (request.headers.get("content-type") || "").includes("application/json");
  try {
    const supabase = getSupabaseAdmin();

    if (isJson) {
      const body = await request.json().catch(() => null);
      if (body?.action !== "delete" || !UUID_RE.test(String(body?.id))) return jsonResponse({ message: "Solicitud inválida" }, 400);
      const opened = await openReviewSession(body?.token, { supabase });
      if (!opened.ok) return jsonResponse({ message: opened.message }, opened.status);
      const { session } = opened;
      const { error } = await supabase.from(REVIEW_PHOTOS_TABLE).delete().eq("id", body.id).eq("event_id", session.event.id).eq("email", session.email);
      if (error) throw error;
      return jsonResponse({ photos: ownList(await loadOwnPhotos(supabase, session.event.id, session.email)) });
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    const opened = await openReviewSession(form?.get("token"), { supabase });
    if (!opened.ok) return jsonResponse({ message: opened.message }, opened.status);
    const { session } = opened;
    if (!file || typeof file === "string") return jsonResponse({ message: "No llegó ninguna foto." }, 400);
    if (file.size > MAX_BYTES) return jsonResponse({ message: "La foto no debe superar los 5 MB." }, 400);

    const current = await loadOwnPhotos(supabase, session.event.id, session.email);
    if (current.length >= MAX_PHOTOS_PER_PERSON) {
      return jsonResponse({ message: `Puedes subir hasta ${MAX_PHOTOS_PER_PERSON} fotos. Borra alguna para subir otra.` }, 409);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const contentType = sniffImageType(buffer);
    if (!contentType || !IMAGE_EXT[contentType]) return jsonResponse({ message: "Solo se permiten fotos JPG, PNG, WEBP o GIF." }, 400);

    const stored = await storeOptimizedImage(buffer, contentType, {
      pathPrefix: `event-attendee-photos/${session.event.id}/foto`,
      maxSize: 2000,
      thumbnail: true,
    });
    const { data: photo, error } = await supabase
      .from(REVIEW_PHOTOS_TABLE)
      .insert({
        event_id: session.event.id,
        organization_id: session.event.organization_id,
        email: session.email,
        display_name: reviewDisplayName(session.attendance.first_name, session.attendance.last_name),
        url: stored.url,
        thumb_url: stored.thumb_url,
        width: stored.width,
        height: stored.height,
        status: session.settings.moderate_photos ? "pending" : "visible",
      })
      .select(PHOTO_COLUMNS)
      .single();
    if (error) throw error;
    return jsonResponse(
      {
        photo: { id: photo.id, url: photo.url, thumb_url: photo.thumb_url, status: photo.status },
        photos: ownList([...current, photo]),
        message: photo.status === "pending" ? "¡Gracias! Tu foto se publicará cuando la productora la revise." : "¡Listo! Tu foto ya está en la galería.",
      },
      201,
    );
  } catch (err: any) {
    if (isMissingSchema(err)) return jsonResponse({ message: REVIEWS_UNAVAILABLE }, 503);
    console.error("reviews/photos:", err?.message || err);
    return jsonResponse({ message: "No pudimos subir la foto. Inténtalo de nuevo." }, 500);
  }
};
