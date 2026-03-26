import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";

export const GET: APIRoute = async () => {
    const supabaseAdmin = getSupabaseAdmin();
    const { data: events, error } = await supabaseAdmin
        .from('events')
        .select('*')
        .eq('name', 'Prod E2E Event')
        .limit(1);

    return new Response(JSON.stringify({
        found: events && events.length > 0,
        events: events || [],
        error
    }, null, 2), {
        headers: { "Content-Type": "application/json" }
    });
};
