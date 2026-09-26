import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, hasRole, EVENT_MANAGER_ROLES } from "../../../lib/supabaseServer";
import { verifyOAuthState } from "../../../lib/crypto";

const ZERNIO_BASE = "https://zernio.com/api/v1";
const STATE_MAX_AGE_MS = 15 * 60 * 1000;

const idOf = (v: any): string | null => {
    if (!v) return null;
    if (typeof v === "string") return v;
    return v._id ? String(v._id) : v.id ? String(v.id) : null;
};

/**
 * Confirma con la API de Zernio que la cuenta conectada pertenece al perfil de la organización.
 * Si la API falla o la respuesta no permite confirmarlo, se rechaza (fail closed).
 */
async function zernioAccountBelongsToProfile(accountId: string, profileId: string, platform: string): Promise<boolean> {
    const apiKey = import.meta.env.ZERNIO_API_KEY;
    if (!apiKey) return false;
    try {
        const listUrl = new URL(`${ZERNIO_BASE}/accounts`);
        listUrl.searchParams.set("profileId", profileId);
        const res = await fetch(listUrl.toString(), { headers: { Authorization: `Bearer ${apiKey}` } });
        if (!res.ok) {
            console.error("Zernio accounts lookup failed:", res.status);
            return false;
        }
        const data = await res.json().catch(() => null);
        const accounts: any[] = Array.isArray(data) ? data : Array.isArray(data?.accounts) ? data.accounts : [];
        const account = accounts.find((a) => idOf(a) === accountId);
        if (!account) return false;
        // Si la respuesta trae el perfil/plataforma, deben coincidir
        const accountProfile = idOf(account.profileId ?? account.profile);
        if (accountProfile && accountProfile !== profileId) return false;
        if (account.platform && account.platform !== platform) return false;
        return true;
    } catch (err) {
        console.error("Zernio accounts lookup error:", err);
        return false;
    }
}

export const GET: APIRoute = async (context) => {
    const { url, redirect } = context;
    try {
        // Zernio (modo estándar) agrega: ?connected={platform}&profileId=X&accountId=Y&username=Z
        // La organización se toma de la SESIÓN y se valida contra el state firmado en /api/promote/connect.
        const session = await getSessionContext(context);
        if (!session) {
            return redirect("/organizadores/login");
        }
        if (!hasRole(session.dbUser, EVENT_MANAGER_ROLES)) {
            return redirect(`/dashboard/promote?error=forbidden`);
        }

        const error = url.searchParams.get("error");
        if (error) {
            console.error("Zernio OAuth error:", error);
            return redirect(`/dashboard/promote?error=oauth_failed`);
        }

        // 1. State firmado: misma organización, mismo usuario, no vencido
        const state = verifyOAuthState(url.searchParams.get("state") || "");
        if (!state || state.purpose !== "zernio" || !state.org || !state.uid) {
            return redirect(`/dashboard/promote?error=invalid_state`);
        }
        if (state.uid !== session.authUser.id || Number(state.org) !== Number(session.dbUser.organization_id)) {
            console.error("Zernio state mismatch (uid/org)");
            return redirect(`/dashboard/promote?error=invalid_state`);
        }
        if (typeof state.ts !== "number" || Date.now() - state.ts > STATE_MAX_AGE_MS) {
            return redirect(`/dashboard/promote?error=expired_state`);
        }

        const orgId = session.dbUser.organization_id;
        const profileId = url.searchParams.get("profileId");
        const platform = url.searchParams.get("connected");
        const accountId = url.searchParams.get("accountId");
        const username = (url.searchParams.get("username") || "").slice(0, 200) || null;

        if (!platform || !accountId || !profileId) {
            return redirect(`/dashboard/promote?error=missing_params`);
        }
        if (!["instagram", "facebook"].includes(platform) || (state.platform && state.platform !== platform)) {
            return redirect(`/dashboard/promote?error=invalid_platform`);
        }

        const supabaseAdmin = getSupabaseAdmin();

        // 2. El perfil de Zernio debe ser el de esta organización
        const { data: org } = await supabaseAdmin
            .from("organizations")
            .select("zernio_profile_id")
            .eq("id", orgId)
            .single();
        if (!org?.zernio_profile_id || profileId !== org.zernio_profile_id) {
            return redirect(`/dashboard/promote?error=invalid_profile`);
        }

        // 3. La cuenta debe pertenecer a ese perfil según Zernio
        if (!(await zernioAccountBelongsToProfile(accountId, org.zernio_profile_id, platform))) {
            return redirect(`/dashboard/promote?error=invalid_account`);
        }

        // Check if account already connected
        const { data: existing } = await supabaseAdmin
            .from("social_accounts")
            .select("id")
            .eq("organization_id", orgId)
            .eq("platform", platform)
            .eq("zernio_account_id", accountId)
            .maybeSingle();

        if (existing) {
            await supabaseAdmin
                .from("social_accounts")
                .update({
                    account_name: username,
                    status: "active",
                })
                .eq("id", existing.id)
                .eq("organization_id", orgId);
        } else {
            const { error: insertError } = await supabaseAdmin
                .from("social_accounts")
                .insert({
                    organization_id: orgId,
                    platform,
                    zernio_account_id: accountId,
                    account_name: username,
                    status: "active",
                });

            if (insertError) {
                console.error("Insert social account error:", insertError);
                return redirect(`/dashboard/promote?error=db_error`);
            }
        }

        return redirect(`/dashboard/promote?connected=${platform}`);
    } catch (error) {
        console.error("Callback error:", error);
        return redirect(`/dashboard/promote?error=internal`);
    }
};
