// Servidor MCP de administración de AI Tickets (Streamable HTTP, sin estado, respuestas JSON). Solo para el dueño de
// la plataforma: header "Authorization: Bearer aitkadm_…" (ver docs/api/admin.md y src/lib/admin-api/auth.ts).
// Deshabilitado (sin ADMIN_MCP_ENABLED / sin hash de la llave) o en otro host que SITE_URL: 404, como si no existiera.
// Sin CORS: ningún navegador necesita llamarlo.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { authenticateAdminRequest, adminEndpointAvailable } from "../../../lib/admin-api/auth";
import { handleAdminMcpPayload } from "../../../lib/admin-api/mcp";
import { publicOrigin, readJsonBody } from "../../../lib/producer-api/http";

export const prerender = false;

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(body === null ? null : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", ...extra },
    });

const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });

// Sin stream SSE iniciado por el servidor ni sesiones: el spec permite 405 (pero si está deshabilitado, 404)
const notAllowed: APIRoute = ({ request }) =>
    adminEndpointAvailable(request) ? json({ error: "Método no permitido. Usa POST con JSON-RPC." }, 405, { Allow: "POST" }) : notFound();
export const GET = notAllowed;
export const DELETE = notAllowed;
export const OPTIONS = notAllowed;

export const POST: APIRoute = async ({ request }) => {
    const supabase = getSupabaseAdmin();
    const auth = await authenticateAdminRequest(request, supabase);
    if (!auth.ok) {
        if (auth.status === 404) return notFound();
        return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: auth.error } }, auth.status, auth.status === 429 ? { "Retry-After": "60" } : {});
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
