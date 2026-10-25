// Conecta la cuenta publicitaria de Meta de la productora vía Zernio (netlify/lib/zernio-ads.mjs).
// Si su Facebook (conectado para publicar) ya tiene permisos de anuncios, Zernio la conecta sin pasar por Meta y se
// guardan sus cuentas publicitarias al tiro; si no, se devuelve el diálogo de Meta y la vuelta llega a ./callback.
// Solo dueños/administradores (ORG_ADMIN_ROLES): la cuenta publicitaria es de la productora y Meta le cobra a ella.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../../lib/auth-helpers";
import { getSessionContext, hasRole, ORG_ADMIN_ROLES, jsonResponse } from "../../../../lib/supabaseServer";
import { createOAuthState } from "../../../../lib/crypto";
import { siteUrl } from "../../_lib/server-utils";
import { ADS_STATE_PURPOSE, adsJsonError } from "../../../../lib/ads";
import { adsEnabled, ensureZernioProfile, friendlyAdsError, startAdsConnection, syncAdAccounts } from "../../../../../netlify/lib/zernio-ads.mjs";

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return adsJsonError("No autorizado", 401);
    if (!hasRole(session.dbUser, ORG_ADMIN_ROLES)) return adsJsonError("Solo el dueño o un administrador de la productora puede conectar la cuenta publicitaria.", 403);
    if (!adsEnabled()) return adsJsonError("Los anuncios no están disponibles en este momento.", 503);

    const orgId = Number(session.dbUser.organization_id);
    const supabase = getSupabaseAdmin();
    try {
        const profileId = await ensureZernioProfile(supabase, orgId);
        // Si hay un Facebook conectado para publicar, la conexión de anuncios cuelga de esa cuenta
        const { data: facebook } = await supabase
            .from("social_accounts")
            .select("zernio_account_id")
            .eq("organization_id", orgId)
            .eq("platform", "facebook")
            .eq("status", "active")
            .limit(1)
            .maybeSingle();
        const state = createOAuthState({ purpose: ADS_STATE_PURPOSE, org: orgId, uid: session.authUser.id, ts: Date.now() });
        const redirectUrl = `${siteUrl() || "https://aitickets.cl"}/api/promote/ads/callback?state=${encodeURIComponent(state)}`;
        const data = await startAdsConnection({ profileId, redirectUrl, postingAccountId: facebook?.zernio_account_id || undefined });

        if (data?.alreadyConnected && data.accountId) {
            const count = await syncAdAccounts(supabase, orgId, String(data.accountId));
            if (!count) return adsJsonError("Tu cuenta de Meta no tiene cuentas publicitarias. Crea una en business.facebook.com y vuelve a intentarlo.", 409);
            return jsonResponse({ connected: true, adAccounts: count });
        }
        if (data?.authUrl) return jsonResponse({ redirect_url: data.authUrl });
        return adsJsonError("Zernio no devolvió cómo conectar la cuenta.", 502);
    } catch (err: any) {
        console.error("[ads/connect]", err?.status || "", err?.message);
        return adsJsonError(friendlyAdsError(err), 502);
    }
};
