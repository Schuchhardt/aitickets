import type { APIRoute } from "astro";
import { getSessionUser } from "../../../lib/supabaseServer";

export const GET: APIRoute = async (context) => {
    const user = await getSessionUser(context);

    return new Response(JSON.stringify({
        user,
        cookies: {
            accessToken: context.cookies.get("sb-access-token")?.value ? 'exists' : 'missing',
            refreshToken: context.cookies.get("sb-refresh-token")?.value ? 'exists' : 'missing',
        }
    }), {
        status: 200,
        headers: {
            "Content-Type": "application/json",
        },
    });
};
