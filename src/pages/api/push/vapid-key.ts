import type { APIRoute } from "astro";
import { jsonResponse } from "../../../lib/supabaseServer";

export const prerender = false;

export const GET: APIRoute = async () => {
    // process.env primero: en Netlify la clave puede cambiar sin rebuild; import.meta.env como respaldo (dev)
    const publicKey = (typeof process !== "undefined" ? process.env?.VAPID_PUBLIC_KEY : undefined) || import.meta.env.VAPID_PUBLIC_KEY;
    if (!publicKey) return jsonResponse({ error: "Push notifications not configured" }, 404);
    return jsonResponse({ publicKey });
};
