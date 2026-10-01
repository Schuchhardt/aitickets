// API REST de productores: POST /api/v1/<herramienta> con cuerpo JSON. Respuesta:
//   200 { ok: true, data }  |  4xx/5xx { ok: false, error: { code, message } }
// Autenticación: "Authorization: Bearer aitk_..." (llave de /dashboard/ia). Ver GET /api/v1.
import type { APIRoute } from "astro";
import { getTool } from "../../../lib/producer-api/tools";
import { runTool, HTTP_STATUS } from "../../../lib/producer-api/registry";
import { apiJson, authorizeApiRequest, preflight, readJsonBody } from "../../../lib/producer-api/http";

export const prerender = false;

export const OPTIONS: APIRoute = () => preflight();

export const GET: APIRoute = () => apiJson({ ok: false, error: { code: "method_not_allowed", message: "Usa POST con cuerpo JSON. Catálogo en GET /api/v1." } }, 405, { Allow: "POST, OPTIONS" });

export const POST: APIRoute = async ({ params, request }) => {
    const tool = getTool(String(params.tool || ""));
    if (!tool) return apiJson({ ok: false, error: { code: "not_found", message: `Herramienta desconocida: ${params.tool}. Ver GET /api/v1.` } }, 404);

    const auth = await authorizeApiRequest(request, "rest");
    if (!auth.ok) {
        const code = auth.status === 429 ? "rate_limited" : auth.status === 403 ? "forbidden" : auth.status === 503 ? "unavailable" : "unauthorized";
        return apiJson({ ok: false, error: { code, message: auth.error } }, auth.status, auth.status === 429 ? { "Retry-After": "60" } : {});
    }

    const body = await readJsonBody(request);
    if (!body.ok) return apiJson({ ok: false, error: { code: "invalid_input", message: body.error } }, body.status);

    const outcome = await runTool(tool, body.body, auth.ctx);
    if (!outcome.ok) return apiJson({ ok: false, error: { code: outcome.code, message: outcome.message } }, HTTP_STATUS[outcome.code]);
    return apiJson({ ok: true, data: outcome.result });
};
