// Catálogo de la API REST de productores: GET /api/v1 (público, sin datos de la organización).
// Cada herramienta se invoca con POST /api/v1/<nombre> y cuerpo JSON (mismas herramientas que el MCP).
import type { APIRoute } from "astro";
import { TOOLS } from "../../../lib/producer-api/tools";
import { publicSchema } from "../../../lib/producer-api/registry";
import { SCOPE_LABELS } from "../../../lib/producer-api/keys";
import { apiJson, preflight, publicOrigin, REQUESTS_PER_MINUTE } from "../../../lib/producer-api/http";

export const prerender = false;

export const OPTIONS: APIRoute = () => preflight();

export const GET: APIRoute = ({ request }) => {
    const origin = publicOrigin(new URL(request.url));
    return apiJson({
        name: "AI Tickets Producer API",
        version: "1.0.0",
        authentication: `Header "Authorization: Bearer aitk_..." con una llave creada en ${origin}/dashboard/ia`,
        mcp_endpoint: `${origin}/api/mcp`,
        rate_limit: `${REQUESTS_PER_MINUTE} peticiones por minuto por llave`,
        conventions: { currency: "CLP", timezone: "America/Santiago" },
        scopes: SCOPE_LABELS,
        errors: "{ ok: false, error: { code, message } } con HTTP 400 invalid_input, 401, 403 forbidden, 404 not_found, 409 conflict, 429 rate_limited, 5xx",
        tools: TOOLS.map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            scope: t.scope,
            method: "POST",
            url: `${origin}/api/v1/${t.name}`,
            input_schema: publicSchema(t.inputSchema),
        })),
    });
};
