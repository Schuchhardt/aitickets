// Videos del evento desde el panel (EventVideoUploader.vue). `slot`: "cover" (reemplaza la imagen de portada en la
// página pública, events.cover_video) o "gallery" (opcional, arriba de las fotos, events.gallery_video).
// GET  ?eventId=&slot=                                              → { video, available, max_bytes }
// POST { eventId, slot, action: "upload_url", contentType, size }   → { uploadUrl, publicUrl }  (subida directa a Storage)
// POST { eventId, slot, action: "set", url, poster_url?, width?, height?, duration? } → { video, image_url }
// POST { eventId, slot, action: "delete" }                          → { ok }
// "set" solo acepta archivos de ese evento y organización, verificados como video y bajo el máximo
// (src/lib/videoStorage.ts). El guardado (borra el video anterior; con "cover" y sin imagen, el póster pasa a ser la
// imagen) está en src/lib/eventVideoStore.ts, compartido con la API de productores (set_event_video).
// Los cambios vacían la caché de la página pública (src/middleware.ts, PURGE_ON_WRITE).
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, jsonResponse, type SessionContext } from "../../../lib/supabaseServer";
import { EVENT_VIDEO_MAX_BYTES, EVENT_VIDEO_TYPES, isEventVideoSlot, type EventVideoSlot } from "../../../lib/eventVideo";
import { clearEventVideo, EventVideoUnavailableError, EVENT_VIDEO_UNAVAILABLE, loadEventVideoState, saveEventVideo } from "../../../lib/eventVideoStore";
import { publicImageBaseUrl } from "../../../lib/imageStorage";
import { createVideoUpload, ownVideoLocation, verifyUploadedVideo, VideoStorageError } from "../../../lib/videoStorage";

export const prerender = false;

async function authorize(
    context: Parameters<typeof getSessionContext>[0],
    eventId: number,
    slot: unknown,
): Promise<{ session: SessionContext; slot: EventVideoSlot } | Response> {
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ message: "No autorizado" }, 401);
    if (!hasRole(session.dbUser, EVENT_MANAGER_ROLES)) return jsonResponse({ message: "No tienes permisos para editar eventos" }, 403);
    if (!Number.isSafeInteger(eventId) || eventId <= 0) return jsonResponse({ message: "eventId es obligatorio" }, 400);
    if (!isEventVideoSlot(slot)) return jsonResponse({ message: "slot debe ser cover o gallery" }, 400);
    const event = await getOwnedEvent(eventId, session.dbUser.organization_id, "id", session.dbUser.id);
    if (!event) return jsonResponse({ message: "Evento no encontrado" }, 404);
    return { session, slot };
}

/** Estado actual; si la lectura falla por otra cosa que la migración pendiente, se registra y se informa como no disponible. */
async function loadCurrent(eventId: number, slot: EventVideoSlot) {
    try {
        return await loadEventVideoState(getSupabaseAdmin(), eventId, slot);
    } catch (err: any) {
        console.error(`events/video (${slot}):`, err?.message || err);
        return { available: false, video: null, raw: null, imageUrl: null };
    }
}

/** Errores del guardado → respuesta (migración pendiente: 503). */
const saveFailure = (err: any, label: "set" | "delete") => {
    if (err instanceof EventVideoUnavailableError) return jsonResponse({ message: EVENT_VIDEO_UNAVAILABLE }, 503);
    console.error(`events/video (${label}):`, err?.message || err);
    return jsonResponse({ message: label === "delete" ? "No se pudo quitar el video" : "No se pudo guardar el video" }, 500);
};

const positiveInt = (v: unknown, max: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 && n <= max ? n : null;
};

export const GET: APIRoute = async (context) => {
    const params = new URL(context.request.url).searchParams;
    const eventId = Number(params.get("eventId"));
    const auth = await authorize(context, eventId, params.get("slot"));
    if (auth instanceof Response) return auth;
    const current = await loadCurrent(eventId, auth.slot);
    return jsonResponse({ video: current.video, available: current.available, max_bytes: EVENT_VIDEO_MAX_BYTES });
};

export const POST: APIRoute = async (context) => {
    const body = await context.request.json().catch(() => null);
    const eventId = Number(body?.eventId);
    const auth = await authorize(context, eventId, body?.slot);
    if (auth instanceof Response) return auth;
    const { slot } = auth;
    const orgId = Number(auth.session.dbUser.organization_id);
    const supabase = getSupabaseAdmin();

    switch (body?.action) {
        case "upload_url": {
            const contentType = String(body.contentType || "").toLowerCase();
            const size = Number(body.size);
            if (!EVENT_VIDEO_TYPES[contentType]) return jsonResponse({ message: "Formato no soportado: usa MP4 (recomendado), WEBM o MOV." }, 400);
            if (!Number.isFinite(size) || size <= 0) return jsonResponse({ message: "Archivo de video no válido" }, 400);
            if (size > EVENT_VIDEO_MAX_BYTES) return jsonResponse({ message: "El video supera los 50 MB. Comprímelo o recórtalo antes de subirlo." }, 400);
            if (!(await loadCurrent(eventId, slot)).available) return jsonResponse({ message: EVENT_VIDEO_UNAVAILABLE }, 503);
            try {
                const upload = await createVideoUpload(orgId, eventId, contentType);
                return jsonResponse({ uploadUrl: upload.uploadUrl, publicUrl: upload.publicUrl, maxBytes: EVENT_VIDEO_MAX_BYTES });
            } catch (err: any) {
                if (err instanceof VideoStorageError) return jsonResponse({ message: err.message }, err.status);
                console.error("events/video (upload_url):", err?.message || err);
                return jsonResponse({ message: "No se pudo preparar la subida del video" }, 500);
            }
        }

        case "set": {
            const location = ownVideoLocation(body.url, orgId, eventId);
            if (!location) return jsonResponse({ message: "Video no válido" }, 400);
            if (!(await loadCurrent(eventId, slot)).available) return jsonResponse({ message: EVENT_VIDEO_UNAVAILABLE }, 503);
            let verified;
            try {
                verified = await verifyUploadedVideo(location);
            } catch (err: any) {
                if (err instanceof VideoStorageError) return jsonResponse({ message: err.message }, err.status);
                console.error("events/video (set):", err?.message || err);
                return jsonResponse({ message: "No se pudo verificar el video" }, 500);
            }
            const imageBase = publicImageBaseUrl();
            const poster =
                typeof body.poster_url === "string" && body.poster_url.startsWith(imageBase) && !body.poster_url.includes("..") && body.poster_url.length <= 1000
                    ? body.poster_url
                    : null;
            try {
                const saved = await saveEventVideo(supabase, {
                    eventId,
                    organizationId: orgId,
                    slot,
                    video: {
                        url: String(body.url),
                        poster_url: poster,
                        width: positiveInt(body.width, 20000),
                        height: positiveInt(body.height, 20000),
                        duration: positiveInt(body.duration, 24 * 3600),
                        mime: verified.mime,
                        bytes: verified.bytes,
                    },
                });
                return jsonResponse({ video: saved.video, image_url: saved.image_url });
            } catch (err) {
                return saveFailure(err, "set");
            }
        }

        case "delete": {
            try {
                await clearEventVideo(supabase, { eventId, organizationId: orgId, slot });
                return jsonResponse({ ok: true });
            } catch (err) {
                return saveFailure(err, "delete");
            }
        }

        default:
            return jsonResponse({ message: "Acción no válida" }, 400);
    }
};
