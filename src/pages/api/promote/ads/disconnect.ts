// Desconecta una cuenta publicitaria en AI Tickets (status 'revoked'). No se borra la fila: sus anuncios guardan
// historial y métricas. No toca la conexión en Zernio ni en Meta (la de Facebook sigue sirviendo para publicar).
// Con anuncios activos o en revisión no se puede: primero hay que pausarlos o cancelarlos.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../../lib/auth-helpers";
import { getSessionContext, hasRole, ORG_ADMIN_ROLES, jsonResponse } from "../../../../lib/supabaseServer";
import { adsJsonError } from "../../../../lib/ads";

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return adsJsonError("No autorizado", 401);
    if (!hasRole(session.dbUser, ORG_ADMIN_ROLES)) return adsJsonError("Solo el dueño o un administrador puede desconectar la cuenta publicitaria.", 403);

    let body: any;
    try {
        body = await context.request.json();
    } catch {
        return adsJsonError("Solicitud inválida", 400);
    }
    const connectionId = Number(body?.connectionId);
    if (!Number.isSafeInteger(connectionId)) return adsJsonError("ID de conexión requerido", 400);

    const orgId = Number(session.dbUser.organization_id);
    const supabase = getSupabaseAdmin();
    const { data: connection } = await supabase
        .from("ad_account_connections")
        .select("id")
        .eq("id", connectionId)
        .eq("organization_id", orgId)
        .eq("provider", "zernio")
        .maybeSingle();
    if (!connection) return adsJsonError("Conexión no encontrada", 404);

    const { count } = await supabase
        .from("ad_campaigns")
        .select("id", { count: "exact", head: true })
        .eq("ad_account_connection_id", connectionId)
        .in("status", ["active", "pending_review", "creating"]);
    if (count) return adsJsonError("Tienes anuncios activos o en revisión con esta cuenta. Pausa o cancela esos anuncios primero.", 400);

    const { error } = await supabase
        .from("ad_account_connections")
        .update({ status: "revoked", updated_at: new Date().toISOString() })
        .eq("id", connectionId)
        .eq("organization_id", orgId);
    if (error) {
        console.error("[ads/disconnect]", error.message);
        return adsJsonError("No se pudo desconectar la cuenta.", 500);
    }
    return jsonResponse({ message: "Cuenta publicitaria desconectada de AI Tickets" });
};
