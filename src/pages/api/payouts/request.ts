// Solicitar retiro desde el panel (/dashboard/finance). Usa la herramienta request_payout de la API de
// productores, así que valida lo mismo que por MCP/REST (permiso finance.manage, cuenta verificada, espera
// de 72 h tras cambiarla, saldo disponible) y pide confirmación en dos pasos:
//   POST { amount? }                                       → { status: "confirmation_required", summary, confirmation_token }
//   POST { amount?, confirmation_token, idempotency_key }  → retiro registrado
import type { APIRoute } from "astro";
import { getTool } from "../../../lib/producer-api/tools";
import { runTool, HTTP_STATUS } from "../../../lib/producer-api/registry";
import { dashboardToolContext } from "../../../lib/producer-api/session";
import { jsonResponse } from "../../../lib/supabaseServer";

export const prerender = false;

export const POST: APIRoute = async (context) => {
    const auth = await dashboardToolContext(context);
    if (!auth.ok) return jsonResponse({ ok: false, error: { code: auth.status === 401 ? "unauthorized" : "forbidden", message: auth.error } }, auth.status);

    let body: any = {};
    try {
        body = await context.request.json();
    } catch {
        return jsonResponse({ ok: false, error: { code: "invalid_input", message: "Cuerpo JSON inválido." } }, 400);
    }
    const args: Record<string, unknown> = {};
    if (body?.amount != null && body.amount !== "") args.amount = Math.round(Number(body.amount));
    if (body?.confirmation_token) args.confirmation_token = String(body.confirmation_token);
    if (body?.idempotency_key) args.idempotency_key = String(body.idempotency_key);

    const outcome = await runTool(getTool("request_payout")!, args, auth.ctx);
    if (!outcome.ok) return jsonResponse({ ok: false, error: { code: outcome.code, message: outcome.message } }, HTTP_STATUS[outcome.code]);
    return jsonResponse({ ok: true, data: outcome.result });
};
