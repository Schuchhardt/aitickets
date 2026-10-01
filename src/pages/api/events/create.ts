import type { APIRoute } from "astro";
import { getFriendlyErrorMessage } from "../../../lib/auth-helpers";
import { getSessionContext, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { notifySlack } from "../_lib/server-utils";
import { createEventGraph, EventInputError } from "../_lib/events";

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ error: "Unauthorized" }, 401);
    const { dbUser } = session;
    if (!hasRole(dbUser, EVENT_MANAGER_ROLES)) {
        return jsonResponse({ message: "No tienes permisos para crear eventos" }, 403);
    }

    const state: { eventId: number | null } = { eventId: null };

    try {
        const body = await context.request.json();
        const { general, locations, tickets } = body || {};

        const created = await createEventGraph({ userId: dbUser.id, orgId: dbUser.organization_id }, { general, locations, tickets }, state);

        // Notificar en Slack
        const totalDates = locations.reduce((sum: number, loc: any) => sum + (loc.dates?.length || 0), 0);
        const ticketLines = created.ticketsPayload
            .map((t: any) => `  - ${t.ticket_name}: $${t.price} (${t.total_quantity ?? "sin límite"} disponibles)`)
            .join("\n");
        await notifySlack(
            `🎫 *Nuevo evento creado*\n• *Nombre:* ${created.name}\n• *Categoría:* ${general.category || "-"}\n• *Ubicaciones:* ${locations.length}\n• *Fechas:* ${totalDates}\n• *Tickets:*\n${ticketLines}\n• *Link:* /eventos/${created.slug}`,
        );

        return jsonResponse({ message: "Evento creado exitosamente", id: created.id }, 200);
    } catch (error) {
        if (error instanceof EventInputError) return jsonResponse({ message: error.message }, error.status);
        console.error("Event creation error:", error);
        return jsonResponse({ message: getFriendlyErrorMessage(error), id: state.eventId }, 500);
    }
};
