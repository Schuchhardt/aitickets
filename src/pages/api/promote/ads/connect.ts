import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../../lib/auth-helpers";
import { getSessionContext, hasRole, EVENT_MANAGER_ROLES } from "../../../../lib/supabaseServer";
import { createOAuthState } from "../../../../lib/crypto";

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401 });
    }
    if (!hasRole(session.dbUser, EVENT_MANAGER_ROLES)) {
        return new Response(JSON.stringify({ message: "No tienes permisos para esta acción" }), { status: 403, headers: { "Content-Type": "application/json" } });
    }
    const user = session.authUser;

    try {
        const metaAppId = import.meta.env.META_APP_ID;
        if (!metaAppId) {
            return new Response(JSON.stringify({ message: "Meta App ID no configurado" }), { status: 500 });
        }

        const supabaseAdmin = getSupabaseAdmin();
        const dbUser = session.dbUser;

        if (!dbUser?.organization_id) {
            return new Response(JSON.stringify({ message: "Organización no encontrada" }), { status: 404 });
        }

        const siteUrl = import.meta.env.SITE_URL || "https://aitickets.cl";
        const redirectUri = `${siteUrl}/api/promote/ads/callback`;

        // HMAC-signed state to prevent CSRF and verify org ownership
        const state = createOAuthState({
            org: dbUser.organization_id,
            uid: user.id,
            ts: Date.now(),
        });

        // Facebook Login OAuth URL with ads_management permission
        const scopes = [
            "ads_management",
            "ads_read",
            "business_management",
            "pages_read_engagement",
        ].join(",");

        const authUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${metaAppId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&state=${encodeURIComponent(state)}&response_type=code`;

        return new Response(JSON.stringify({ redirect_url: authUrl }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("Meta connect error:", error);
        return new Response(JSON.stringify({ message: "Error interno del servidor" }), { status: 500 });
    }
};
