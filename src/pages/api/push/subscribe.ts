import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, jsonResponse } from "../../../lib/supabaseServer";

export const prerender = false;

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ error: "Unauthorized" }, 401);

    let body: any;
    try {
        body = await context.request.json();
    } catch {
        return jsonResponse({ error: "Invalid JSON" }, 400);
    }

    const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : "";
    const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh.trim() : "";
    const auth = typeof body?.keys?.auth === "string" ? body.keys.auth.trim() : "";

    if (!endpoint || !p256dh || !auth) {
        return jsonResponse({ error: "endpoint, keys.p256dh and keys.auth are required" }, 400);
    }

    const supabase = getSupabaseAdmin();
    const userAgent = context.request.headers.get("user-agent") || null;

    const { error } = await supabase
        .from("push_subscriptions")
        .upsert(
            {
                user_id: session.authUser.id,
                organization_id: session.dbUser.organization_id,
                endpoint,
                p256dh,
                auth,
                user_agent: userAgent,
            },
            { onConflict: "endpoint" },
        );

    if (error) {
        console.error("push/subscribe:", error.message);
        return jsonResponse({ error: "Error saving subscription" }, 500);
    }

    return jsonResponse({ ok: true });
};
