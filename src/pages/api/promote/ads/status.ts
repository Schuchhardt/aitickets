// Pausa, reanuda o cancela un anuncio creado desde AI Tickets (vía Zernio). Pausar y cancelar detienen el gasto, así
// que puede hacerlo cualquiera que administre eventos; reanudar vuelve a gastar y queda para dueños/administradores.
// Solo cambia el interruptor del anuncio: su campaña y su conjunto quedan como estaban.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../../lib/auth-helpers";
import { getSessionContext, hasRole, EVENT_MANAGER_ROLES, ORG_ADMIN_ROLES, jsonResponse } from "../../../../lib/supabaseServer";
import { adsJsonError } from "../../../../lib/ads";
import { canAccessEventByStaff } from "../../../../../netlify/lib/event-staff.mjs";
import { AD_STATUSES, adsEnabled, cancelZernioAd, friendlyAdsError, setZernioAdStatus } from "../../../../../netlify/lib/zernio-ads.mjs";

const ACTIONS = ["pause", "activate", "cancel"] as const;
const DONE = new Set(["cancelled", "completed", "error", "creating"]);

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return adsJsonError("No autorizado", 401);
    if (!hasRole(session.dbUser, EVENT_MANAGER_ROLES)) return adsJsonError("No tienes permisos para esta acción", 403);
    if (!adsEnabled()) return adsJsonError("Los anuncios no están disponibles en este momento.", 503);

    let body: any;
    try {
        body = await context.request.json();
    } catch {
        return adsJsonError("Solicitud inválida", 400);
    }
    const action = body?.action;
    const campaignId = Number(body?.campaignId);
    if (!ACTIONS.includes(action) || !Number.isSafeInteger(campaignId)) return adsJsonError("Datos inválidos", 400);
    if (action === "activate" && !hasRole(session.dbUser, ORG_ADMIN_ROLES)) {
        return adsJsonError("Solo el dueño o un administrador puede reactivar un anuncio (vuelve a gastar).", 403);
    }

    const orgId = Number(session.dbUser.organization_id);
    const supabase = getSupabaseAdmin();
    const { data: ad } = await supabase
        .from("ad_campaigns")
        .select("id, event_id, status, zernio_ad_id, provider")
        .eq("id", campaignId)
        .eq("organization_id", orgId)
        .eq("provider", "zernio")
        .maybeSingle();
    if (!ad || !(await canAccessEventByStaff(supabase, Number(session.dbUser.id), ad.event_id))) return adsJsonError("Anuncio no encontrado", 404);
    if (!ad.zernio_ad_id || DONE.has(ad.status)) return adsJsonError("Este anuncio ya no se puede cambiar.", 409);

    try {
        let status: string;
        if (action === "cancel") {
            await cancelZernioAd(ad.zernio_ad_id);
            status = "cancelled";
        } else {
            const res = await setZernioAdStatus(ad.zernio_ad_id, action === "pause" ? "paused" : "active");
            // Al reanudar puede quedar en revisión: se usa lo que Meta reporta si es un estado conocido
            status = AD_STATUSES.includes(res?.status) ? res.status : action === "pause" ? "paused" : "active";
        }
        await supabase
            .from("ad_campaigns")
            .update({ status, updated_at: new Date().toISOString() })
            .eq("id", ad.id)
            .eq("organization_id", orgId);
        const message = action === "pause" ? "Anuncio pausado" : action === "cancel" ? "Anuncio cancelado: ya no gastará más" : "Anuncio activado";
        return jsonResponse({ status, message });
    } catch (err: any) {
        console.error("[ads/status]", err?.status || "", err?.message);
        return adsJsonError(friendlyAdsError(err), 502);
    }
};
