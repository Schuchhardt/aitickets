import type { APIRoute } from "astro";
import { getSupabaseAdmin, getFriendlyErrorMessage } from "../../../lib/auth-helpers";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { DUPLICATE_SOURCE_COLUMNS, duplicateEventAsDraft } from "../../../lib/eventDuplicate";

/**
 * Duplica un evento como borrador: copia datos generales, categoría, ubicaciones, tipos de entrada y FAQs.
 * NO copia las funciones (fechas): el productor debe agregar las nuevas fechas antes de publicar.
 * La lógica vive en src/lib/eventDuplicate.ts (compartida con duplicate_event de la API de productores).
 */
export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ error: "Unauthorized" }, 401);
    const { dbUser } = session;
    if (!hasRole(dbUser, EVENT_MANAGER_ROLES)) {
        return jsonResponse({ message: "No tienes permisos para duplicar eventos" }, 403);
    }

    let newEventId: number | null = null;

    try {
        const { eventId } = await context.request.json();
        if (!eventId) return jsonResponse({ message: "eventId es obligatorio" }, 400);

        const source = await getOwnedEvent<any>(eventId, dbUser.organization_id, DUPLICATE_SOURCE_COLUMNS, dbUser.id);
        if (!source) return jsonResponse({ message: "Evento no encontrado o no autorizado" }, 404);

        const created = await duplicateEventAsDraft(getSupabaseAdmin(), source, { organizationId: dbUser.organization_id, userId: dbUser.id });
        newEventId = created.id;

        return jsonResponse({ message: "Evento duplicado como borrador. Agrega las nuevas fechas antes de publicar.", id: newEventId }, 200);
    } catch (error: any) {
        console.error("Duplicate event error:", error);
        return jsonResponse({ message: getFriendlyErrorMessage(error), id: newEventId ?? error?.newEventId ?? null }, 500);
    }
};
