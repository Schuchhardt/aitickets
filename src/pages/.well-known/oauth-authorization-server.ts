// Metadatos del servidor de autorización OAuth (RFC 8414) para conectar clientes MCP (claude.ai, ChatGPT…).
import type { APIRoute } from "astro";
import { authorizationServerMetadata } from "../../lib/producer-api/oauth";
import { apiJson, preflight, publicOrigin } from "../../lib/producer-api/http";

export const prerender = false;
export const OPTIONS: APIRoute = () => preflight();
export const GET: APIRoute = ({ request }) => apiJson(authorizationServerMetadata(publicOrigin(new URL(request.url))), 200, { "Cache-Control": "public, max-age=3600" });
