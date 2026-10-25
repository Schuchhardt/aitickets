// Vuelta del diálogo de Meta al conectar la cuenta publicitaria vía Zernio (./connect).
// Zernio agrega ?connected=metaads&profileId=X&accountId=Y (o ?error=... si falló). La organización se toma de la
// SESIÓN y se valida contra el state firmado; el perfil debe ser el de la organización y la conexión debe pertenecer a
// ese perfil según Zernio (falla cerrado). Luego se guardan sus cuentas publicitarias.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../../lib/auth-helpers";
import { getSessionContext, hasRole, ORG_ADMIN_ROLES } from "../../../../lib/supabaseServer";
import { verifyOAuthState } from "../../../../lib/crypto";
import { ADS_STATE_MAX_AGE_MS, ADS_STATE_PURPOSE } from "../../../../lib/ads";
import { adsAccountBelongsToProfile, syncAdAccounts } from "../../../../../netlify/lib/zernio-ads.mjs";

const back = (params: string) => `/dashboard/promote?tab=ads&${params}`;

/** Errores de Zernio/Meta que el panel sabe explicar; el resto, genérico. */
function errorCode(error: string, reason: string): string {
    if (error === "payment_required" || error === "ads_addon_required") return "ads_unavailable";
    if (error === "meta_ads_authorization_denied") return "ads_denied";
    if (error === "no_facebook_pages" || /no_pages|page_not_granted|pages_permission/.test(reason)) return "ads_no_pages";
    if (/ad_accounts_not_granted/.test(reason)) return "ads_no_accounts";
    if (error === "invalid_state" || /state_expired/.test(reason)) return "expired_state";
    return "ads_failed";
}

export const GET: APIRoute = async (context) => {
    const { url, redirect } = context;
    try {
        const session = await getSessionContext(context);
        if (!session) return redirect("/organizadores/login");
        if (!hasRole(session.dbUser, ORG_ADMIN_ROLES)) return redirect(back("error=forbidden"));

        const error = url.searchParams.get("error");
        if (error) {
            console.error("[ads/callback] Zernio/Meta:", error, url.searchParams.get("error_reason") || "", (url.searchParams.get("error_message") || "").slice(0, 200));
            return redirect(back(`error=${errorCode(error, url.searchParams.get("error_reason") || "")}`));
        }

        const state = verifyOAuthState(url.searchParams.get("state") || "");
        if (!state || state.purpose !== ADS_STATE_PURPOSE || state.uid !== session.authUser.id || Number(state.org) !== Number(session.dbUser.organization_id)) {
            return redirect(back("error=invalid_state"));
        }
        if (typeof state.ts !== "number" || Date.now() - state.ts > ADS_STATE_MAX_AGE_MS) return redirect(back("error=expired_state"));

        const orgId = Number(session.dbUser.organization_id);
        const profileId = url.searchParams.get("profileId") || "";
        const adsAccountId = url.searchParams.get("accountId") || "";
        if (!profileId || !adsAccountId) return redirect(back("error=missing_params"));

        const supabase = getSupabaseAdmin();
        const { data: org } = await supabase.from("organizations").select("zernio_profile_id").eq("id", orgId).maybeSingle();
        if (!org?.zernio_profile_id || org.zernio_profile_id !== profileId) return redirect(back("error=invalid_profile"));
        if (!(await adsAccountBelongsToProfile(adsAccountId, profileId))) return redirect(back("error=invalid_account"));

        const count = await syncAdAccounts(supabase, orgId, adsAccountId);
        return redirect(back(count ? "connected=ads" : "error=ads_no_accounts"));
    } catch (err: any) {
        console.error("[ads/callback]", err?.status || "", err?.message);
        return redirect(back("error=ads_failed"));
    }
};
