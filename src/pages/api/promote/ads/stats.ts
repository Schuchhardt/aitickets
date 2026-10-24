// Anuncios de la organización con métricas al día (Zernio) y ventas atribuidas (utm_campaign=ad-<id>).
// Reintenta las creaciones sin confirmar y sincroniza los que llevan más de 10 min sin hacerlo (src/lib/ads.ts).
// Body opcional: { eventId } para los de un evento.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../../lib/auth-helpers";
import { getSessionContext, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../../lib/supabaseServer";
import { adsJsonError, loadAdConnections, loadAdsView } from "../../../../lib/ads";
import { adsEnabled } from "../../../../../netlify/lib/zernio-ads.mjs";

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return adsJsonError("No autorizado", 401);
    if (!hasRole(session.dbUser, EVENT_MANAGER_ROLES)) return adsJsonError("No tienes permisos para esta acción", 403);

    let body: any = {};
    try {
        body = await context.request.json();
    } catch {
        /* sin body: todos los anuncios */
    }
    const eventId = body?.eventId != null && Number.isSafeInteger(Number(body.eventId)) ? Number(body.eventId) : null;
    const orgId = Number(session.dbUser.organization_id);
    const supabase = getSupabaseAdmin();
    try {
        const enabled = adsEnabled();
        const [campaigns, connections] = await Promise.all([
            loadAdsView(supabase, { organizationId: orgId, userId: Number(session.dbUser.id), eventId, sync: enabled }),
            loadAdConnections(supabase, orgId),
        ]);
        return jsonResponse({ enabled, campaigns, connections });
    } catch (err: any) {
        console.error("[ads/stats]", err?.message);
        return adsJsonError("No se pudieron cargar los anuncios.", 500);
    }
};
