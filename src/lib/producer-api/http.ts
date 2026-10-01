// Capa HTTP común de /api/mcp y /api/v1: autenticación por llave, límite de tasa, CORS y contexto.
// Estas rutas NO usan cookies (solo la llave en el header), así que no aplica CSRF: el middleware las exime.
import { getSupabaseAdmin } from "../auth-helpers";
import { siteUrl } from "../../pages/api/_lib/server-utils";
import { rateLimit } from "../../../netlify/lib/rate-limit.mjs";
import { authenticateApiKey, extractApiKey } from "./keys";
import type { ToolContext } from "./registry";

export const REQUESTS_PER_MINUTE = 120;
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

export const CORS_HEADERS: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-API-Key, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
    "Access-Control-Expose-Headers": "Mcp-Protocol-Version, WWW-Authenticate",
    "Access-Control-Max-Age": "86400",
};

export function apiJson(body: unknown, status = 200, extra: Record<string, string> = {}) {
    return new Response(body === null ? null : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", ...CORS_HEADERS, ...extra },
    });
}

export const preflight = () => new Response(null, { status: 204, headers: CORS_HEADERS });

export function publicOrigin(requestUrl: URL) {
    return siteUrl() || requestUrl.origin;
}

export type ApiAuth = { ok: true; ctx: ToolContext } | { ok: false; status: number; error: string };

/** Autentica la llave, aplica el límite por llave y arma el contexto de las herramientas. */
export async function authorizeApiRequest(request: Request, channel: "mcp" | "rest"): Promise<ApiAuth> {
    const supabase = getSupabaseAdmin();
    const auth = await authenticateApiKey(supabase, extractApiKey(request));
    if (!auth.ok) return { ok: false, status: auth.status, error: auth.error };

    const limit = await rateLimit("api:key", auth.actor.keyId, { windowSeconds: 60, max: REQUESTS_PER_MINUTE, supabase });
    if (!limit.allowed) return { ok: false, status: 429, error: `Demasiadas peticiones: máximo ${REQUESTS_PER_MINUTE} por minuto por llave.` };

    const requestUrl = new URL(request.url);
    return { ok: true, ctx: { supabase, actor: auth.actor, origin: publicOrigin(requestUrl), requestUrl, channel } };
}

/** Lee el cuerpo JSON con tope de tamaño. */
export async function readJsonBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; status: number; error: string }> {
    const declared = Number(request.headers.get("content-length") || 0);
    if (declared > MAX_BODY_BYTES) return { ok: false, status: 413, error: "Cuerpo demasiado grande (máx. 8 MB)." };
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return { ok: false, status: 413, error: "Cuerpo demasiado grande (máx. 8 MB)." };
    if (!text.trim()) return { ok: true, body: {} };
    try {
        return { ok: true, body: JSON.parse(text) };
    } catch {
        return { ok: false, status: 400, error: "JSON inválido." };
    }
}
