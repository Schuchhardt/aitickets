import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";

export const GET: APIRoute = async ({ url, redirect }) => {
    try {
        // Zernio standard mode appends: ?connected={platform}&profileId=X&accountId=Y&username=Z
        // Our connect.ts also appends ?org={orgId} to the redirect_url
        const orgId = url.searchParams.get("org");
        const platform = url.searchParams.get("connected");
        const accountId = url.searchParams.get("accountId");
        const username = url.searchParams.get("username");
        const error = url.searchParams.get("error");

        if (error) {
            console.error("Zernio OAuth error:", error);
            return redirect(`/dashboard/promote?error=oauth_failed`);
        }

        if (!orgId || !platform || !accountId) {
            return redirect(`/dashboard/promote?error=missing_params`);
        }

        if (!["instagram", "facebook"].includes(platform)) {
            return redirect(`/dashboard/promote?error=invalid_platform`);
        }

        const supabaseAdmin = getSupabaseAdmin();

        // Check if account already connected
        const { data: existing } = await supabaseAdmin
            .from("social_accounts")
            .select("id")
            .eq("organization_id", parseInt(orgId))
            .eq("platform", platform)
            .eq("zernio_account_id", accountId)
            .single();

        if (existing) {
            await supabaseAdmin
                .from("social_accounts")
                .update({
                    account_name: username,
                    status: "active",
                })
                .eq("id", existing.id);
        } else {
            const { error: insertError } = await supabaseAdmin
                .from("social_accounts")
                .insert({
                    organization_id: parseInt(orgId),
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
