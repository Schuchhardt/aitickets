// Metadatos del recurso protegido (RFC 9728): /.well-known/oauth-protected-resource y
// /.well-known/oauth-protected-resource/api/mcp. Indican a los clientes MCP dónde autorizarse.
import type { APIRoute } from "astro";
import { protectedResourceMetadata, adminProtectedResourceMetadata } from "../../../lib/producer-api/oauth";
import { apiJson, preflight, publicOrigin } from "../../../lib/producer-api/http";

export const prerender = false;
export const OPTIONS: APIRoute = () => preflight();
export const GET: APIRoute = ({ params, request }) => {
    const path = String(params.path || "");
    const origin = publicOrigin(new URL(request.url));
    if (path === "api/admin/mcp") return apiJson(adminProtectedResourceMetadata(origin), 200, { "Cache-Control": "public, max-age=3600" });
    if (path && path !== "api/mcp") return apiJson({ error: "not_found" }, 404);
    return apiJson(protectedResourceMetadata(origin), 200, { "Cache-Control": "public, max-age=3600" });
};
