// Servidor MCP de administración de AI Tickets (Streamable HTTP, sin estado, respuestas JSON).
// Auth: llave estática "aitkadm_…" O token OAuth (aitk_) cuyo email esté en ADMIN_MCP_EMAILS.
// Ver docs/api/admin.md y src/lib/admin-api/auth.ts.
// Deshabilitado (sin ADMIN_MCP_ENABLED / sin credenciales) o en otro host que SITE_URL: 404.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { authenticateAdminRequest, adminEndpointAvailable } from "../../../lib/admin-api/auth";
import { handleAdminMcpPayload } from "../../../lib/admin-api/mcp";
import { publicOrigin, readJsonBody, CORS_HEADERS } from "../../../lib/producer-api/http";
import { adminResourceMetadataUrl } from "../../../lib/producer-api/oauth";

export const prerender = false;

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(body === null ? null : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", ...CORS_HEADERS, ...extra },
    });

const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });

export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS_HEADERS });

const notAllowed: APIRoute = ({ request }) =>
    adminEndpointAvailable(request) ? json({ error: "Método no permitido. Usa POST con JSON-RPC." }, 405, { Allow: "POST, OPTIONS" }) : notFound();
export const GET = notAllowed;
export const DELETE = notAllowed;

export const POST: APIRoute = async ({ request }) => {
    const supabase = getSupabaseAdmin();
    const auth = await authenticateAdminRequest(request, supabase);
    if (!auth.ok) {
        if (auth.status === 404) return notFound();
        const extra: Record<string, string> = {};
        if (auth.status === 401) {
            const origin = publicOrigin(new URL(request.url));
            extra["WWW-Authenticate"] = `Bearer realm="aitickets-admin", resource_metadata="${adminResourceMetadataUrl(origin)}", error="invalid_token"`;
        }
        if (auth.status === 429) extra["Retry-After"] = "60";
        return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: auth.error } }, auth.status, extra);
    }

    const body = await readJsonBody(request);
    if (!body.ok) return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: body.error } }, body.status);

    const requestUrl = new URL(request.url);
    const response = await handleAdminMcpPayload(body.body, {
        supabase,
        origin: publicOrigin(requestUrl),
        requestUrl,
        keyKind: auth.keyKind,
        fingerprint: auth.fingerprint,
        ipHash: auth.ipHash,
    });
    if (response === null) return json(null, 202);
    return json(response, 200);
};
