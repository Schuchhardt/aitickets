// Galería del evento desde el panel (EventGalleryManager.vue).
// GET  ?eventId=                                     → { images }
// POST { eventId, action: "add", images: [{ url, thumb_url?, width?, height?, caption? }] } → { images }
// POST { eventId, action: "caption", id, caption }    → { ok }
// POST { eventId, action: "reorder", ids: [...] }     → { ok }   (ids en el orden nuevo)
// POST { eventId, action: "delete", id }              → { ok }
// Video de portada (events.gallery_video, uno por evento, arriba de las fotos):
// POST { eventId, action: "video_upload_url", contentType, size } → { uploadUrl, publicUrl }  (subida directa a Storage)
// POST { eventId, action: "video_set", url, poster_url?, width?, height?, duration? } → { video }
// POST { eventId, action: "video_delete" }            → { ok }
// Las imágenes se suben antes con /api/events/upload-image (kind=gallery): aquí solo se aceptan URLs del
// bucket propio. Las imágenes del storage no se borran (pueden seguir referenciadas en posts o correos); el video
// anterior sí (solo se usa aquí y pesa mucho). Los cambios vacían la caché de la página (src/middleware.ts).
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, jsonResponse, type SessionContext } from "../../../lib/supabaseServer";
import {
    GALLERY_MAX_IMAGES,
    GALLERY_TABLE,
    GALLERY_VIDEO_MAX_BYTES,
    GALLERY_VIDEO_TYPES,
    isMissingTable,
    loadEventGallery,
    normalizeCaption,
    normalizeGalleryInput,
    normalizeGalleryVideo,
} from "../../../lib/eventGallery";
import { publicImageBaseUrl } from "../../../lib/imageStorage";
import { createVideoUpload, ownVideoLocation, removeStoredVideo, verifyUploadedVideo, VideoStorageError } from "../../../lib/videoStorage";

export const prerender = false;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authorize(context: Parameters<typeof getSessionContext>[0], eventId: number): Promise<{ session: SessionContext } | Response> {
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ message: "No autorizado" }, 401);
    if (!hasRole(session.dbUser, EVENT_MANAGER_ROLES)) return jsonResponse({ message: "No tienes permisos para editar eventos" }, 403);
    if (!Number.isSafeInteger(eventId) || eventId <= 0) return jsonResponse({ message: "eventId es obligatorio" }, 400);
    const event = await getOwnedEvent(eventId, session.dbUser.organization_id, "id", session.dbUser.id);
    if (!event) return jsonResponse({ message: "Evento no encontrado" }, 404);
    return { session };
}

const failure = (error: any, label: string) => {
    if (isMissingTable(error)) return jsonResponse({ message: "La galería aún no está disponible. Intenta más tarde." }, 503);
    console.error(`events/gallery (${label}):`, error?.message || error);
    return jsonResponse({ message: "No se pudo guardar la galería" }, 500);
};

const VIDEO_UNAVAILABLE = "El video de la galería aún no está disponible. Intenta en unos minutos.";
const isMissingColumn = (error: any) => error?.code === "42703" || error?.code === "PGRST204";

/** Video actual del evento. available=false si la columna aún no existe (deploy preview sin migrar). */
async function loadGalleryVideo(eventId: number) {
    const { data, error } = await getSupabaseAdmin().from("events").select("gallery_video").eq("id", eventId).maybeSingle();
    if (error) {
        if (!isMissingColumn(error)) console.error("events/gallery (video):", error.message);
        return { available: !isMissingColumn(error), video: null, raw: null };
    }
    return { available: true, video: normalizeGalleryVideo((data as any)?.gallery_video), raw: (data as any)?.gallery_video ?? null };
}

const positiveInt = (v: unknown, max: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 && n <= max ? n : null;
};

export const GET: APIRoute = async (context) => {
    const eventId = Number(new URL(context.request.url).searchParams.get("eventId"));
    const auth = await authorize(context, eventId);
    if (auth instanceof Response) return auth;
    const [images, video] = await Promise.all([loadEventGallery(eventId), loadGalleryVideo(eventId)]);
    return jsonResponse({
        images,
        max: GALLERY_MAX_IMAGES,
        video: video.video,
        video_available: video.available,
        video_max_bytes: GALLERY_VIDEO_MAX_BYTES,
    });
};

export const POST: APIRoute = async (context) => {
    const body = await context.request.json().catch(() => null);
    const eventId = Number(body?.eventId);
    const auth = await authorize(context, eventId);
    if (auth instanceof Response) return auth;
    const { dbUser } = auth.session;
    const supabase = getSupabaseAdmin();
    const table = () => supabase.from(GALLERY_TABLE);

    switch (body?.action) {
        case "add": {
            const baseUrl = publicImageBaseUrl();
            const raw = Array.isArray(body.images) ? body.images.slice(0, GALLERY_MAX_IMAGES) : [];
            const valid = raw.map((img: any) => normalizeGalleryInput(img, baseUrl)).filter(Boolean) as NonNullable<ReturnType<typeof normalizeGalleryInput>>[];
            if (!valid.length) return jsonResponse({ message: "No hay imágenes válidas para agregar" }, 400);

            const { data: existing, error: countError } = await table()
                .select("position")
                .eq("event_id", eventId)
                .order("position", { ascending: false })
                .limit(GALLERY_MAX_IMAGES);
            if (countError) return failure(countError, "add");
            const current = existing?.length || 0;
            if (current + valid.length > GALLERY_MAX_IMAGES) {
                return jsonResponse({ message: `La galería admite hasta ${GALLERY_MAX_IMAGES} imágenes (quedan ${Math.max(0, GALLERY_MAX_IMAGES - current)}).` }, 400);
            }
            const start = current ? Number(existing![0].position) + 1 : 0;
            const { error } = await table().insert(
                valid.map((img, i) => ({
                    ...img,
                    event_id: eventId,
                    organization_id: dbUser.organization_id,
                    position: start + i,
                    created_by_user_id: dbUser.id,
                }))
            );
            if (error) return failure(error, "add");
            return jsonResponse({ images: await loadEventGallery(eventId) }, 201);
        }

        case "caption": {
            if (!UUID_RE.test(String(body.id))) return jsonResponse({ message: "Imagen no válida" }, 400);
            const { data, error } = await table()
                .update({ caption: normalizeCaption(body.caption) })
                .eq("id", body.id)
                .eq("event_id", eventId)
                .select("id");
            if (error) return failure(error, "caption");
            if (!data?.length) return jsonResponse({ message: "Imagen no encontrada" }, 404);
            return jsonResponse({ ok: true });
        }

        case "reorder": {
            const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String).filter((id: string) => UUID_RE.test(id)) : [];
            if (!ids.length || ids.length > GALLERY_MAX_IMAGES) return jsonResponse({ message: "Orden no válido" }, 400);
            const { data: rows, error: listError } = await table().select("id").eq("event_id", eventId);
            if (listError) return failure(listError, "reorder");
            const own = new Set((rows || []).map((r: any) => r.id));
            if (ids.some((id) => !own.has(id))) return jsonResponse({ message: "Orden no válido" }, 400);
            const results = await Promise.all(
                ids.map((id, position) => table().update({ position }).eq("id", id).eq("event_id", eventId))
            );
            const failed = results.find((r) => r.error);
            if (failed) return failure(failed.error, "reorder");
            return jsonResponse({ ok: true });
        }

        case "delete": {
            if (!UUID_RE.test(String(body.id))) return jsonResponse({ message: "Imagen no válida" }, 400);
            const { error } = await table().delete().eq("id", body.id).eq("event_id", eventId);
            if (error) return failure(error, "delete");
            return jsonResponse({ ok: true });
        }

        case "video_upload_url": {
            const contentType = String(body.contentType || "").toLowerCase();
            const size = Number(body.size);
            if (!GALLERY_VIDEO_TYPES[contentType]) return jsonResponse({ message: "Formato no soportado: usa MP4 (recomendado), WEBM o MOV." }, 400);
            if (!Number.isFinite(size) || size <= 0) return jsonResponse({ message: "Archivo de video no válido" }, 400);
            if (size > GALLERY_VIDEO_MAX_BYTES) return jsonResponse({ message: "El video supera los 50 MB. Comprímelo o recórtalo antes de subirlo." }, 400);
            const current = await loadGalleryVideo(eventId);
            if (!current.available) return jsonResponse({ message: VIDEO_UNAVAILABLE }, 503);
            try {
                const upload = await createVideoUpload(Number(dbUser.organization_id), eventId, contentType);
                return jsonResponse({ uploadUrl: upload.uploadUrl, publicUrl: upload.publicUrl, maxBytes: GALLERY_VIDEO_MAX_BYTES });
            } catch (err: any) {
                if (err instanceof VideoStorageError) return jsonResponse({ message: err.message }, err.status);
                console.error("events/gallery (video_upload_url):", err?.message || err);
                return jsonResponse({ message: "No se pudo preparar la subida del video" }, 500);
            }
        }

        case "video_set": {
            const orgId = Number(dbUser.organization_id);
            const location = ownVideoLocation(body.url, orgId, eventId);
            if (!location) return jsonResponse({ message: "Video no válido" }, 400);
            const current = await loadGalleryVideo(eventId);
            if (!current.available) return jsonResponse({ message: VIDEO_UNAVAILABLE }, 503);
            let verified;
            try {
                verified = await verifyUploadedVideo(location);
            } catch (err: any) {
                if (err instanceof VideoStorageError) return jsonResponse({ message: err.message }, err.status);
                console.error("events/gallery (video_set):", err?.message || err);
                return jsonResponse({ message: "No se pudo verificar el video" }, 500);
            }
            const imageBase = publicImageBaseUrl();
            const poster = typeof body.poster_url === "string" && body.poster_url.startsWith(imageBase) && !body.poster_url.includes("..") && body.poster_url.length <= 1000
                ? body.poster_url
                : null;
            const value = {
                url: String(body.url),
                poster_url: poster,
                width: positiveInt(body.width, 20000),
                height: positiveInt(body.height, 20000),
                duration: positiveInt(body.duration, 24 * 3600),
                mime: verified.mime,
                bytes: verified.bytes,
                updated_at: new Date().toISOString(),
            };
            const { error } = await supabase.from("events").update({ gallery_video: value }).eq("id", eventId).eq("organization_id", orgId);
            if (error) {
                if (isMissingColumn(error)) return jsonResponse({ message: VIDEO_UNAVAILABLE }, 503);
                return failure(error, "video_set");
            }
            if (current.video && current.video.url !== value.url) await removeStoredVideo(current.video.url, orgId, eventId);
            return jsonResponse({ video: normalizeGalleryVideo(value) });
        }

        case "video_delete": {
            const orgId = Number(dbUser.organization_id);
            const current = await loadGalleryVideo(eventId);
            if (!current.available) return jsonResponse({ message: VIDEO_UNAVAILABLE }, 503);
            if (!current.raw) return jsonResponse({ ok: true });
            const { error } = await supabase.from("events").update({ gallery_video: null }).eq("id", eventId).eq("organization_id", orgId);
            if (error) return failure(error, "video_delete");
            if (current.video) await removeStoredVideo(current.video.url, orgId, eventId);
            return jsonResponse({ ok: true });
        }

        default:
            return jsonResponse({ message: "Acción no válida" }, 400);
    }
};
