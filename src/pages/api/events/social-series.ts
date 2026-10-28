// Tarjeta "Difusión automática" del evento (/dashboard/events/[id]): historias y posts automáticos en Instagram, y
// en Facebook y TikTok si el productor las activa.
// Usa las herramientas *_social_series de la API de productores (permisos por rol, confirmación en dos pasos y
// bitácora), así el panel valida lo mismo que el MCP.
//   GET  ?event_id=                                        → get_social_series
//   POST { action: "prepare", event_id, ...opciones }      → prepare_social_series
//   POST { action: "approve" | "resume" | "cancel", event_id[, confirmation_token] }
//        → primero { status: "confirmation_required", summary, confirmation_token }; con el token, ejecuta
//   POST { action: "pause", event_id }                     → pause_social_series
import type { APIRoute } from "astro";
import { getTool } from "../../../lib/producer-api/tools";
import { runTool, HTTP_STATUS } from "../../../lib/producer-api/registry";
import { dashboardToolContext } from "../../../lib/producer-api/session";
import { jsonResponse } from "../../../lib/supabaseServer";

export const prerender = false;

const TOOLS: Record<string, string> = {
    prepare: "prepare_social_series",
    approve: "approve_social_series",
    pause: "pause_social_series",
    resume: "resume_social_series",
    cancel: "cancel_social_series",
};
const PREPARE_FIELDS = ["feed_posts_enabled", "sold_out_story_enabled", "keyword", "extra_keywords", "dm_message", "base_image_url", "facebook_enabled", "tiktok_enabled", "reel_enabled"];

const run = async (context: Parameters<APIRoute>[0], tool: string, args: Record<string, unknown>) => {
    const auth = await dashboardToolContext(context);
    if (!auth.ok) return jsonResponse({ ok: false, error: { code: auth.status === 401 ? "unauthorized" : "forbidden", message: auth.error } }, auth.status);
    const outcome = await runTool(getTool(tool)!, args, auth.ctx);
    if (!outcome.ok) return jsonResponse({ ok: false, error: { code: outcome.code, message: outcome.message } }, HTTP_STATUS[outcome.code]);
    return jsonResponse({ ok: true, data: outcome.result });
};

export const GET: APIRoute = async (context) => {
    const eventId = Math.round(Number(context.url.searchParams.get("event_id")));
    return run(context, "get_social_series", { event_id: eventId });
};

export const POST: APIRoute = async (context) => {
    const body = await context.request.json().catch(() => null);
    const tool = TOOLS[String(body?.action || "")];
    if (!tool) return jsonResponse({ ok: false, error: { code: "invalid_input", message: "Acción inválida." } }, 400);
    const args: Record<string, unknown> = { event_id: Math.round(Number(body?.event_id)) };
    if (body.action === "prepare") for (const k of PREPARE_FIELDS) if (body[k] !== undefined) args[k] = body[k];
    if (body.action === "cancel" && body.reason) args.reason = String(body.reason).slice(0, 200);
    if (body.confirmation_token) args.confirmation_token = String(body.confirmation_token);
    return run(context, tool, args);
};
