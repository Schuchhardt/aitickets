// Servidor MCP de AI Tickets para productores (Streamable HTTP, sin estado, respuestas JSON).
// Conexión: URL https://aitickets.cl/api/mcp con OAuth 2.1 (claude.ai, ChatGPT: el cliente lo descubre por
// WWW-Authenticate) o header "Authorization: Bearer aitk_..." (llave de /dashboard/ia). Las herramientas viven en src/lib/producer-api/tools y son las mismas que /api/v1.
import type { APIRoute } from "astro";
import { handleMcpPayload } from "../../lib/producer-api/mcp";
import { resourceMetadataUrl } from "../../lib/producer-api/oauth";
import { apiJson, authorizeApiRequest, preflight, publicOrigin, readJsonBody } from "../../lib/producer-api/http";

export const prerender = false;

export const OPTIONS: APIRoute = () => preflight();

// Sin stream SSE iniciado por el servidor ni sesiones: el spec permite responder 405.
const notAllowed: APIRoute = () => apiJson({ error: "Método no permitido. Usa POST con JSON-RPC." }, 405, { Allow: "POST, OPTIONS" });
export const GET = notAllowed;
export const DELETE = notAllowed;

export const POST: APIRoute = async ({ request }) => {
    const auth = await authorizeApiRequest(request, "mcp");
    if (!auth.ok) {
        const headers: Record<string, string> = {};
        if (auth.status === 401) {
            const origin = publicOrigin(new URL(request.url));
            // resource_metadata: los clientes MCP (claude.ai, ChatGPT…) descubren desde aquí el flujo OAuth
            headers["WWW-Authenticate"] = `Bearer realm="aitickets", resource_metadata="${resourceMetadataUrl(origin)}", error="invalid_token", error_description="Conecta tu cuenta o usa una llave de ${origin}/dashboard/ia"`;
        }
        if (auth.status === 429) headers["Retry-After"] = "60";
        return apiJson({ jsonrpc: "2.0", id: null, error: { code: -32001, message: auth.error } }, auth.status, headers);
    }

    const body = await readJsonBody(request);
    if (!body.ok) return apiJson({ jsonrpc: "2.0", id: null, error: { code: -32700, message: body.error } }, body.status);

    const response = await handleMcpPayload(body.body, auth.ctx);
    if (response === null) return apiJson(null, 202);
    return apiJson(response, 200);
};
