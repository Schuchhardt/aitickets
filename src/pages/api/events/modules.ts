// "Más herramientas" del detalle del evento: agregar una herramienta al panel (events.panel_modules).
// POST { eventId, moduleId }. Registro: src/lib/eventModules.ts.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { isAddableModule, normalizeAddedModules } from "../../../lib/eventModules";

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ message: "No autorizado" }, 401);
    const { dbUser } = session;
    if (!hasRole(dbUser, EVENT_MANAGER_ROLES)) return jsonResponse({ message: "No tienes permisos para editar eventos" }, 403);

    const body = await context.request.json().catch(() => null);
    const moduleId = String(body?.moduleId || "");
    if (!isAddableModule(moduleId)) return jsonResponse({ message: "Herramienta no válida" }, 400);

    const event = await getOwnedEvent<{ id: number }>(Number(body.eventId), dbUser.organization_id, "id", dbUser.id);
    if (!event) return jsonResponse({ message: "Evento no encontrado" }, 404);

    // La columna llega con la migración 202610280300 (los deploy previews y local comparten la BD de producción)
    const missingColumn = (error: any) => error?.code === "42703" || error?.code === "PGRST204";
    const unavailable = () => jsonResponse({ message: "Esta opción estará disponible después del próximo deploy." }, 503);

    const supabase = getSupabaseAdmin();
    const { data: current, error: readError } = await supabase.from("events").select("panel_modules").eq("id", event.id).single();
    if (missingColumn(readError)) return unavailable();
    if (readError) {
        console.error("events/modules:", readError.message);
        return jsonResponse({ message: "No se pudo guardar" }, 500);
    }

    const added = normalizeAddedModules([...normalizeAddedModules(current?.panel_modules), moduleId]);

    const { error } = await supabase
        .from("events")
        .update({ panel_modules: added })
        .eq("id", event.id)
        .eq("organization_id", dbUser.organization_id);
    if (missingColumn(error)) return unavailable();
    if (error) {
        console.error("events/modules:", error.message);
        return jsonResponse({ message: "No se pudo guardar" }, 500);
    }
    return jsonResponse({ ok: true, added });
};
