import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../../lib/auth-helpers";
import { getSessionUser } from "../../../../lib/supabaseServer";
import { verifyOAuthState, encryptToken } from "../../../../lib/crypto";

export const GET: APIRoute = async (context) => {
    const { url, redirect } = context;

    try {
        // Fix #1: Validate session — user must be logged in
        const user = await getSessionUser(context);
        if (!user) {
            return redirect("/organizadores/login?redirect=/dashboard/promote");
        }

        const code = url.searchParams.get("code");
        const stateRaw = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
            console.error("Meta OAuth error:", error, url.searchParams.get("error_description"));
            return redirect("/dashboard/promote?tab=ads&error=meta_oauth_failed");
        }

        if (!code || !stateRaw) {
            return redirect("/dashboard/promote?tab=ads&error=missing_params");
        }

        // Fix #1: Verify HMAC-signed state (prevents CSRF)
        const state = verifyOAuthState(stateRaw);
        if (!state || !state.org || !state.uid) {
            return redirect("/dashboard/promote?tab=ads&error=invalid_state");
        }

        // Verify the OAuth state belongs to the logged-in user
        if (state.uid !== user.id) {
            console.error("OAuth state uid mismatch:", state.uid, "vs", user.id);
            return redirect("/dashboard/promote?tab=ads&error=invalid_state");
        }

        // Reject states older than 15 minutes
        if (Date.now() - state.ts > 15 * 60 * 1000) {
            return redirect("/dashboard/promote?tab=ads&error=expired_state");
        }

        // Verify user actually belongs to the org in state
        const supabaseAdmin = getSupabaseAdmin();
        const { data: dbUser } = await supabaseAdmin
            .from("users")
            .select("organization_id")
            .eq("auth_user_id", user.id)
            .single();

        if (!dbUser || dbUser.organization_id !== state.org) {
            console.error("Org mismatch:", dbUser?.organization_id, "vs", state.org);
            return redirect("/dashboard/promote?tab=ads&error=invalid_state");
        }

        const orgId = state.org;
        const metaAppId = import.meta.env.META_APP_ID;
        const metaAppSecret = import.meta.env.META_APP_SECRET;
        const siteUrl = import.meta.env.SITE_URL || "https://aitickets.cl";
        const redirectUri = `${siteUrl}/api/promote/ads/callback`;

        // Exchange code for short-lived token
        const tokenUrl = `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${metaAppId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${metaAppSecret}&code=${code}`;

        const tokenRes = await fetch(tokenUrl);
        if (!tokenRes.ok) {
            console.error("Meta token exchange failed:", await tokenRes.text());
            return redirect("/dashboard/promote?tab=ads&error=token_exchange");
        }
        const tokenData = await tokenRes.json();

        // Exchange for long-lived token (60 days)
        const longLivedUrl = `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${metaAppId}&client_secret=${metaAppSecret}&fb_exchange_token=${tokenData.access_token}`;

        const longLivedRes = await fetch(longLivedUrl);
        const longLivedData = longLivedRes.ok ? await longLivedRes.json() : tokenData;
        const accessToken = longLivedData.access_token || tokenData.access_token;
        const expiresIn = longLivedData.expires_in || 5184000; // default 60 days

        // Get user info
        const meRes = await fetch(`https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${accessToken}`);
        const meData = meRes.ok ? await meRes.json() : { id: null, name: null };

        // Fix #2: Fetch ALL ad accounts, not just first
        const adAccountsRes = await fetch(`https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name,account_status&limit=50&access_token=${accessToken}`);
        const adAccountsData = adAccountsRes.ok ? await adAccountsRes.json() : { data: [] };
        const adAccounts = adAccountsData.data?.filter((a: any) => a.account_status === 1) || []; // 1 = ACTIVE

        if (adAccounts.length === 0) {
            return redirect("/dashboard/promote?tab=ads&error=no_ad_account");
        }

        const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

        // Fix #3: Encrypt access token before storing
        const encryptedToken = encryptToken(accessToken);

        // Fix #2: If multiple accounts, store them all. If one, store directly.
        // Remove old connections for this org first (re-auth refreshes everything)
        await supabaseAdmin
            .from("ad_account_connections")
            .delete()
            .eq("organization_id", orgId)
            .eq("platform", "meta");

        const connectionsToInsert = adAccounts.map((account: any) => ({
            organization_id: orgId,
            platform: "meta",
            meta_ad_account_id: account.id,
            meta_user_id: meData.id,
            account_name: account.name || meData.name || "Meta Ads",
            access_token: encryptedToken,
            token_expires_at: tokenExpiresAt,
            status: "active",
        }));

        const { error: insertError } = await supabaseAdmin
            .from("ad_account_connections")
            .insert(connectionsToInsert);

        if (insertError) {
            console.error("Insert ad account error:", insertError);
            return redirect("/dashboard/promote?tab=ads&error=db_error");
        }

        return redirect("/dashboard/promote/ads?connected=meta");
    } catch (error) {
        console.error("Meta callback error:", error);
        return redirect("/dashboard/promote?tab=ads&error=internal");
    }
};
