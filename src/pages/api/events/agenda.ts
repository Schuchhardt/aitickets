// Agenda del evento desde el panel (EventAgendaManager.vue). Son las herramientas get_event_agenda /
// update_event_agenda de la API de productores (src/lib/producer-api/tools/agenda.ts) con la sesión del usuario:
// mismos permisos por rol, validación y bitácora que el asistente de IA. Guardar vacía la caché de la página.
//   GET ?event_id=N                → { ok, data: { functions, blocks, ... } }
//   PUT { event_id, blocks: [...] } → la agenda completa (reemplaza la anterior)
import type { APIRoute } from "astro";
import { getTool } from "../../../lib/producer-api/tools";
import { runTool, HTTP_STATUS } from "../../../lib/producer-api/registry";
import { dashboardToolContext } from "../../../lib/producer-api/session";
import { jsonResponse } from "../../../lib/supabaseServer";

export const prerender = false;

const run = async (context: Parameters<APIRoute>[0], tool: string, args: Record<string, unknown>) => {
    const auth = await dashboardToolContext(context);
    if (!auth.ok) return jsonResponse({ ok: false, error: { code: auth.status === 401 ? "unauthorized" : "forbidden", message: auth.error } }, auth.status);
    const outcome = await runTool(getTool(tool)!, args, auth.ctx);
    if (!outcome.ok) return jsonResponse({ ok: false, error: { code: outcome.code, message: outcome.message } }, HTTP_STATUS[outcome.code]);
    return jsonResponse({ ok: true, data: outcome.result });
};

export const GET: APIRoute = async (context) => run(context, "get_event_agenda", { event_id: Math.round(Number(context.url.searchParams.get("event_id"))) });

export const PUT: APIRoute = async (context) => {
    const body = await context.request.json().catch(() => null);
    return run(context, "update_event_agenda", { event_id: Math.round(Number(body?.event_id)), blocks: Array.isArray(body?.blocks) ? body.blocks : [] });
};
