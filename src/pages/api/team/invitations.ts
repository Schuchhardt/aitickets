// Invitaciones al equipo desde el panel (Mi equipo). Son las herramientas invite_member / revoke_invitation de la
// API de productores (src/lib/producer-api/tools/team.ts) con la sesión del usuario: mismos permisos por rol,
// reglas (otra organización, miembro activo, huérfanos, reenviar acceso), idempotencia y bitácora que el asistente de IA.
//   POST   { name?, email, role }  → crea la invitación y envía el correo con el link (vence en 7 días)
//   DELETE { invitation_id }        → la anula
// Reemplaza a POST /api/team/add: el alta directa le mostraba al administrador la contraseña de otra persona y
// creaba cuentas confirmadas para correos que nadie había verificado (Auth compartido con otras apps). Con la
// invitación, la persona prueba que el correo es suyo y elige su contraseña (/invitacion/<token>).
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

const readBody = async (context: Parameters<APIRoute>[0]) => {
    const body = await context.request.json().catch(() => null);
    return body && typeof body === "object" ? body : {};
};

export const POST: APIRoute = async (context) => {
    const body = await readBody(context);
    const args: Record<string, unknown> = {
        email: String(body.email || "").trim().toLowerCase().slice(0, 200),
        role: String(body.role || ""),
    };
    const name = String(body.name || "").trim().slice(0, 150);
    if (name) args.name = name;
    return run(context, "invite_member", args);
};

export const DELETE: APIRoute = async (context) => {
    const body = await readBody(context);
    return run(context, "revoke_invitation", { invitation_id: String(body.invitation_id || "") });
};
