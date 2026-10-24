// Videos del evento desde el panel (EventVideoUploader.vue). `slot`: "cover" (reemplaza la imagen de portada en la
// página pública, events.cover_video) o "gallery" (opcional, arriba de las fotos, events.gallery_video).
// GET  ?eventId=&slot=                                              → { video, available, max_bytes }
// POST { eventId, slot, action: "upload_url", contentType, size }   → { uploadUrl, publicUrl }  (subida directa a Storage)
// POST { eventId, slot, action: "set", url, poster_url?, width?, height?, duration? } → { video, image_url }
// POST { eventId, slot, action: "delete" }                          → { ok }
// "set" solo acepta archivos de ese evento y organización, verificados como video y bajo el máximo
// (src/lib/videoStorage.ts), y borra el video anterior del slot (solo se usa aquí y pesa mucho). Con slot "cover",
// si el evento no tiene imagen, el póster del video pasa a ser su imagen (cartelera, al compartir, correos).
// Los cambios vacían la caché de la página pública (src/middleware.ts, PURGE_ON_WRITE).
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, jsonResponse, type SessionContext } from "../../../lib/supabaseServer";
import { EVENT_VIDEO_MAX_BYTES, EVENT_VIDEO_SLOTS, EVENT_VIDEO_TYPES, isEventVideoSlot, normalizeEventVideo, type EventVideoSlot } from "../../../lib/eventVideo";
import { publicImageBaseUrl } from "../../../lib/imageStorage";
import { createVideoUpload, ownVideoLocation, removeStoredVideo, verifyUploadedVideo, VideoStorageError } from "../../../lib/videoStorage";

export const prerender = false;

const UNAVAILABLE = "Los videos del evento aún no están disponibles. Intenta en unos minutos.";
const isMissingColumn = (error: any) => error?.code === "42703" || error?.code === "PGRST204";

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

/** Video actual del slot y la imagen del evento. available=false si la columna aún no existe (preview sin migrar). */
async function loadCurrent(eventId: number, slot: EventVideoSlot) {
    const column = EVENT_VIDEO_SLOTS[slot];
    const { data, error } = await getSupabaseAdmin().from("events").select(`image_url, ${column}`).eq("id", eventId).maybeSingle();
    if (error) {
        if (!isMissingColumn(error)) console.error(`events/video (${slot}):`, error.message);
        return { available: !isMissingColumn(error), video: null, raw: null, imageUrl: null };
    }
    const raw = (data as any)?.[column] ?? null;
    return { available: true, video: normalizeEventVideo(raw), raw, imageUrl: ((data as any)?.image_url as string | null) || null };
}

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
    const column = EVENT_VIDEO_SLOTS[slot];
    const supabase = getSupabaseAdmin();

    switch (body?.action) {
        case "upload_url": {
            const contentType = String(body.contentType || "").toLowerCase();
            const size = Number(body.size);
            if (!EVENT_VIDEO_TYPES[contentType]) return jsonResponse({ message: "Formato no soportado: usa MP4 (recomendado), WEBM o MOV." }, 400);
            if (!Number.isFinite(size) || size <= 0) return jsonResponse({ message: "Archivo de video no válido" }, 400);
            if (size > EVENT_VIDEO_MAX_BYTES) return jsonResponse({ message: "El video supera los 50 MB. Comprímelo o recórtalo antes de subirlo." }, 400);
            if (!(await loadCurrent(eventId, slot)).available) return jsonResponse({ message: UNAVAILABLE }, 503);
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
            const current = await loadCurrent(eventId, slot);
            if (!current.available) return jsonResponse({ message: UNAVAILABLE }, 503);
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
            // Portada sin imagen: el póster del video la reemplaza en la cartelera, al compartir y en los correos
            const setsImage = slot === "cover" && !current.imageUrl && Boolean(poster);
            const patch: Record<string, unknown> = { [column]: value, ...(setsImage ? { image_url: poster } : {}) };
            const { error } = await supabase.from("events").update(patch).eq("id", eventId).eq("organization_id", orgId);
            if (error) {
                if (isMissingColumn(error)) return jsonResponse({ message: UNAVAILABLE }, 503);
                console.error("events/video (set):", error.message);
                return jsonResponse({ message: "No se pudo guardar el video" }, 500);
            }
            if (current.video && current.video.url !== value.url) await removeStoredVideo(current.video.url, orgId, eventId);
            return jsonResponse({ video: normalizeEventVideo(value), image_url: setsImage ? poster : current.imageUrl });
        }

        case "delete": {
            const current = await loadCurrent(eventId, slot);
            if (!current.available) return jsonResponse({ message: UNAVAILABLE }, 503);
            if (!current.raw) return jsonResponse({ ok: true });
            const { error } = await supabase.from("events").update({ [column]: null }).eq("id", eventId).eq("organization_id", orgId);
            if (error) {
                console.error("events/video (delete):", error.message);
                return jsonResponse({ message: "No se pudo quitar el video" }, 500);
            }
            if (current.video) await removeStoredVideo(current.video.url, orgId, eventId);
            return jsonResponse({ ok: true });
        }

        default:
            return jsonResponse({ message: "Acción no válida" }, 400);
    }
};
