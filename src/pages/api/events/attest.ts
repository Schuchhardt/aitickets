// Acreditar desde el panel (/dashboard/finance) que una función se realizó: usa la herramienta attest_function_held de
// la API de productores (permiso finance.manage, bitácora). POST { event_id, event_date_id?, note }
import type { APIRoute } from "astro";
import { getTool } from "../../../lib/producer-api/tools";
import { runTool, HTTP_STATUS } from "../../../lib/producer-api/registry";
import { dashboardToolContext } from "../../../lib/producer-api/session";
import { jsonResponse } from "../../../lib/supabaseServer";

export const prerender = false;

export const POST: APIRoute = async (context) => {
    const auth = await dashboardToolContext(context);
    if (!auth.ok) return jsonResponse({ ok: false, error: { code: auth.status === 401 ? "unauthorized" : "forbidden", message: auth.error } }, auth.status);
    const body = await context.request.json().catch(() => null);
    const args: Record<string, unknown> = { event_id: Math.round(Number(body?.event_id)), note: String(body?.note || "").trim() };
    if (body?.event_date_id != null && body.event_date_id !== "") args.event_date_id = Math.round(Number(body.event_date_id));
    const outcome = await runTool(getTool("attest_function_held")!, args, auth.ctx);
    if (!outcome.ok) return jsonResponse({ ok: false, error: { code: outcome.code, message: outcome.message } }, HTTP_STATUS[outcome.code]);
    return jsonResponse({ ok: true, data: outcome.result });
};
