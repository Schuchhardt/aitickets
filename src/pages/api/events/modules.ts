// "Más herramientas" del detalle del evento: activar o apagar un módulo del panel (events.panel_modules).
// POST { eventId, moduleId, enabled } — enabled null vuelve al valor por defecto del perfil. Registro: src/lib/eventModules.ts.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { isToggleableModule, normalizeOverrides } from "../../../lib/eventModules";

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ message: "No autorizado" }, 401);
    const { dbUser } = session;
    if (!hasRole(dbUser, EVENT_MANAGER_ROLES)) return jsonResponse({ message: "No tienes permisos para editar eventos" }, 403);

    const body = await context.request.json().catch(() => null);
    const moduleId = String(body?.moduleId || "");
    if (!isToggleableModule(moduleId)) return jsonResponse({ message: "Herramienta no válida" }, 400);
    if (body.enabled !== null && typeof body.enabled !== "boolean") return jsonResponse({ message: "Valor no válido" }, 400);

    const event = await getOwnedEvent<{ id: number; panel_modules: unknown }>(Number(body.eventId), dbUser.organization_id, "id, panel_modules", dbUser.id);
    if (!event) return jsonResponse({ message: "Evento no encontrado" }, 404);

    const overrides = normalizeOverrides(event.panel_modules);
    if (body.enabled === null) delete overrides[moduleId];
    else overrides[moduleId] = body.enabled;

    const { error } = await getSupabaseAdmin()
        .from("events")
        .update({ panel_modules: Object.keys(overrides).length ? overrides : null })
        .eq("id", event.id)
        .eq("organization_id", dbUser.organization_id);
    if (error) {
        console.error("events/modules:", error.message);
        return jsonResponse({ message: "No se pudo guardar" }, 500);
    }
    return jsonResponse({ ok: true, overrides });
};
