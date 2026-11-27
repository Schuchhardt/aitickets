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
    if (!endpoint) return jsonResponse({ error: "endpoint is required" }, 400);

    const supabase = getSupabaseAdmin();
    await supabase
        .from("push_subscriptions")
        .delete()
        .eq("endpoint", endpoint)
        .eq("user_id", session.authUser.id);

    return jsonResponse({ ok: true });
};
