// Catálogo de la API REST de productores: GET /api/v1 (público, sin datos de la organización).
// Cada herramienta se invoca con POST /api/v1/<nombre> y cuerpo JSON (mismas herramientas que el MCP).
import type { APIRoute } from "astro";
import { TOOLS } from "../../../lib/producer-api/tools";
import { effectiveSchema, publicSchema, toolPermission } from "../../../lib/producer-api/registry";
import { PERMISSION_LABELS, ROLE_LABELS, ROLE_PERMISSIONS } from "../../../lib/producer-api/permissions";
import { SCOPE_LABELS } from "../../../lib/producer-api/keys";
import { apiJson, preflight, publicOrigin, REQUESTS_PER_MINUTE } from "../../../lib/producer-api/http";

export const prerender = false;

export const OPTIONS: APIRoute = () => preflight();

export const GET: APIRoute = ({ request }) => {
    const origin = publicOrigin(new URL(request.url));
    return apiJson({
        name: "AI Tickets Producer API",
        version: "2.0.0",
        authentication: `Header "Authorization: Bearer aitk_..." con una llave creada en ${origin}/dashboard/ia`,
        mcp_endpoint: `${origin}/api/mcp`,
        rate_limit: `${REQUESTS_PER_MINUTE} peticiones por minuto por llave`,
        conventions: { currency: "CLP", timezone: "America/Santiago" },
        scopes: SCOPE_LABELS,
        roles: Object.fromEntries(Object.entries(ROLE_PERMISSIONS).map(([role, perms]) => [role, { label: ROLE_LABELS[role], permissions: perms }])),
        permissions: PERMISSION_LABELS,
        confirmation:
            "Las herramientas con requires_confirmation=true se llaman dos veces: la primera devuelve { status: 'confirmation_required', summary, confirmation_token }; " +
            "la acción se ejecuta solo al repetir la llamada con los mismos argumentos y ese token (un solo uso, 15 minutos).",
        idempotency: "Las herramientas que crean o mueven dinero aceptan idempotency_key: un reintento con la misma clave devuelve la misma respuesta.",
        errors: "{ ok: false, error: { code, message } } con HTTP 400 invalid_input, 401, 403 forbidden, 404 not_found, 409 conflict, 429 rate_limited, 5xx",
        tools: TOOLS.map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            scope: t.scope,
            permission: toolPermission(t),
            requires_confirmation: Boolean(t.confirm),
            idempotent: Boolean(t.confirm || t.idempotent),
            method: "POST",
            url: `${origin}/api/v1/${t.name}`,
            input_schema: publicSchema(effectiveSchema(t)),
        })),
    });
};
