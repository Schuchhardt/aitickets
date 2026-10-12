// Portada del evento desde el detalle del panel: imagen (image_url) y ajuste por dispositivo (cover_settings).
// POST { eventId, imageUrl?, coverSettings? } — solo se actualiza lo que viene en el cuerpo.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { saveCoverSettings } from "../_lib/events";

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ message: "No autorizado" }, 401);
    const { dbUser } = session;
    if (!hasRole(dbUser, EVENT_MANAGER_ROLES)) return jsonResponse({ message: "No tienes permisos para editar eventos" }, 403);

    const body = await context.request.json().catch(() => null);
    const event = await getOwnedEvent<{ id: number }>(Number(body?.eventId), dbUser.organization_id, "id", dbUser.id);
    if (!event) return jsonResponse({ message: "Evento no encontrado" }, 404);

    try {
        if (body.imageUrl !== undefined) {
            const imageUrl = body.imageUrl ? String(body.imageUrl).slice(0, 1000) : null;
            if (imageUrl && !/^https:\/\//.test(imageUrl)) return jsonResponse({ message: "URL de imagen no válida" }, 400);
            const { error } = await getSupabaseAdmin()
                .from("events")
                .update({ image_url: imageUrl })
                .eq("id", event.id)
                .eq("organization_id", dbUser.organization_id);
            if (error) throw error;
            if (!imageUrl) await saveCoverSettings(event.id, dbUser.organization_id, null);
        }
        if (body.coverSettings !== undefined) {
            await saveCoverSettings(event.id, dbUser.organization_id, body.coverSettings);
        }
        return jsonResponse({ ok: true });
    } catch (err: any) {
        console.error("events/cover:", err?.message || err);
        return jsonResponse({ message: "No se pudo guardar la portada" }, 500);
    }
};
