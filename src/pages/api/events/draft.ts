// POST /api/events/draft — borrador automático del formulario "Crear evento" (CreateEventForm.vue).
// Body: { draftId?: number, general: { name, description, imageUrl, category, isPrivate, coverSettings } }.
// Sin draftId crea el evento en borrador; con draftId actualiza ese borrador (solo los datos del primer paso).
// Se guarda apenas hay nombre y categoría, descripción o imagen (draftIsSavable). Respuesta: { id }.
// 409 si el borrador ya se completó o se editó en otra pestaña: el formulario deja de autoguardar y lo avisa.
import type { APIRoute } from "astro";
import { getFriendlyErrorMessage } from "../../../lib/auth-helpers";
import { getSessionContext, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { saveFormDraft, EventInputError } from "../_lib/events";

export const prerender = false;

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ error: "Unauthorized" }, 401);
    const { dbUser } = session;
    if (!hasRole(dbUser, EVENT_MANAGER_ROLES)) return jsonResponse({ message: "No tienes permisos para crear eventos" }, 403);

    try {
        const body = await context.request.json();
        const draftId = Number(body?.draftId) > 0 ? Number(body.draftId) : null;
        const { id } = await saveFormDraft({ userId: dbUser.id, orgId: dbUser.organization_id }, body?.general || {}, draftId);
        return jsonResponse({ id }, 200);
    } catch (error) {
        if (error instanceof EventInputError) return jsonResponse({ message: error.message }, error.status);
        console.error("Draft save error:", error);
        return jsonResponse({ message: getFriendlyErrorMessage(error) }, 500);
    }
};
