import type { APIRoute } from "astro";
import { jsonResponse } from "../../../lib/supabaseServer";

export const prerender = false;

export const GET: APIRoute = async () => {
    const publicKey = import.meta.env.VAPID_PUBLIC_KEY;
    if (!publicKey) return jsonResponse({ error: "Push notifications not configured" }, 404);
    return jsonResponse({ publicKey });
};
