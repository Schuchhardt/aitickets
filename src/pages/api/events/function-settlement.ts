// GET /api/events/function-settlement?event_id=&event_date_id=<id|all>&format=csv|json — borderó de una función
// (src/lib/functionSettlement.ts) para liquidar con la sala. event_date_id=all: las entradas válidas para cualquier
// función. csv (por defecto) descarga la planilla; json devuelve los datos. Mismos permisos que el CSV de órdenes.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { slugify } from "../_lib/server-utils";
import { functionSettlement, settlementCsv, SettlementError } from "../../../lib/functionSettlement";

export const prerender = false;

export const GET: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ error: "Unauthorized" }, 401);
    const { dbUser } = session;
    if (!hasRole(dbUser, EVENT_MANAGER_ROLES)) return jsonResponse({ message: "No tienes permisos para ver el borderó" }, 403);

    const eventId = context.url.searchParams.get("event_id");
    if (!eventId) return jsonResponse({ message: "event_id es obligatorio" }, 400);
    const event = await getOwnedEvent<{ id: number; name: string; slug: string }>(eventId, dbUser.organization_id, "id, name, slug", dbUser.id);
    if (!event) return jsonResponse({ message: "Evento no encontrado o no autorizado" }, 404);

    const fnParam = context.url.searchParams.get("event_date_id") || "";
    const functionId = fnParam === "all" ? null : Number(fnParam);
    if (functionId !== null && (!Number.isSafeInteger(functionId) || functionId <= 0)) return jsonResponse({ message: "event_date_id es obligatorio (id de la función o all)" }, 400);

    try {
        const settlement = await functionSettlement(getSupabaseAdmin(), { id: Number(event.id), name: event.name }, functionId);
        if (context.url.searchParams.get("format") === "json") return jsonResponse({ settlement });
        const label = settlement.function ? `${settlement.function.date}-${settlement.function.start_time || ""}` : "todas-las-funciones";
        return new Response(settlementCsv(settlement), {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="bordero-${slugify(event.slug || event.name || String(event.id))}-${slugify(label)}.csv"`,
                "Cache-Control": "no-store",
            },
        });
    } catch (err: any) {
        if (err instanceof SettlementError) return jsonResponse({ message: err.message }, 400);
        console.error("function-settlement:", err?.message || err);
        return jsonResponse({ message: "No se pudo armar el borderó" }, 500);
    }
};
