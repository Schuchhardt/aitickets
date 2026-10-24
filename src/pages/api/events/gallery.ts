// Galería del evento desde el panel (EventGalleryManager.vue).
// GET  ?eventId=                                     → { images }
// POST { eventId, action: "add", images: [{ url, thumb_url?, width?, height?, caption? }] } → { images }
// POST { eventId, action: "caption", id, caption }    → { ok }
// POST { eventId, action: "reorder", ids: [...] }     → { ok }   (ids en el orden nuevo)
// POST { eventId, action: "delete", id }              → { ok }
// Las imágenes se suben antes con /api/events/upload-image (kind=gallery): aquí solo se aceptan URLs del
// bucket propio. Las imágenes del storage no se borran (pueden seguir referenciadas en posts o correos).
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, jsonResponse, type SessionContext } from "../../../lib/supabaseServer";
import {
    GALLERY_MAX_IMAGES,
    GALLERY_TABLE,
    isMissingTable,
    loadEventGallery,
    normalizeCaption,
    normalizeGalleryInput,
} from "../../../lib/eventGallery";
import { publicImageBaseUrl } from "../../../lib/imageStorage";

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

export const GET: APIRoute = async (context) => {
    const eventId = Number(new URL(context.request.url).searchParams.get("eventId"));
    const auth = await authorize(context, eventId);
    if (auth instanceof Response) return auth;
    return jsonResponse({ images: await loadEventGallery(eventId), max: GALLERY_MAX_IMAGES });
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

        default:
            return jsonResponse({ message: "Acción no válida" }, 400);
    }
};
