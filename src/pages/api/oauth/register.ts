// Registro dinámico de clientes OAuth (RFC 7591). Público (lo usan claude.ai, ChatGPT, Claude Code…), con
// límite por IP. No da acceso a nada por sí solo: el productor debe aprobar la conexión en /oauth/authorize.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { OAuthError, registerClient } from "../../../lib/producer-api/oauth";
import { apiJson, clientIp, preflight } from "../../../lib/producer-api/http";
import { isMissingApiSchema } from "../../../lib/producer-api/keys";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";

export const prerender = false;
export const OPTIONS: APIRoute = () => preflight();

export const POST: APIRoute = async ({ request }) => {
    const supabase = getSupabaseAdmin();
    const limit = await rateLimit("oauth:register", clientIp(request), { windowSeconds: 3600, max: 30, supabase });
    if (!limit.allowed) return apiJson({ error: "slow_down", error_description: "Demasiados registros. Intenta más tarde." }, 429, { "Retry-After": "3600" });
    let body: any;
    try {
        body = JSON.parse((await request.text()).slice(0, 32 * 1024) || "{}");
    } catch {
        return apiJson({ error: "invalid_client_metadata", error_description: "JSON inválido." }, 400);
    }
    try {
        return apiJson(await registerClient(supabase, body), 201);
    } catch (err: any) {
        if (err instanceof OAuthError) return apiJson({ error: err.error, error_description: err.message }, err.status);
        if (isMissingApiSchema(err) || /aitickets_oauth/.test(String(err?.message))) return apiJson({ error: "temporarily_unavailable", error_description: "OAuth aún no está disponible." }, 503);
        console.error("oauth register:", err?.message);
        return apiJson({ error: "server_error" }, 500);
    }
};
