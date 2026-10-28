// Certificados de asistencia desde el panel (CertificatesCard.vue). Usa las herramientas de la API de productores con
// la sesión del usuario (src/lib/producer-api/tools/certificates.ts): mismos permisos, confirmación y bitácora.
//   GET  ?event_id=N[&min_sessions=&hours=]              → get_attendance_certificates (JSON)
//   GET  ?event_id=N&format=pdf[&min_sessions=&hours=]   → un PDF con todos los certificados (permiso attendees.read)
//   POST { action: "send", event_id, min_sessions?, hours?, note?, resend_all?[, confirmation_token] }
//        → primero { status: "confirmation_required", summary, confirmation_token }; con el token, envía
import type { APIRoute } from "astro";
import { getTool } from "../../../lib/producer-api/tools";
import { runTool, HTTP_STATUS, ToolError } from "../../../lib/producer-api/registry";
import { dashboardToolContext } from "../../../lib/producer-api/session";
import { roleAllows } from "../../../lib/producer-api/permissions";
import { loadOwnedEvent } from "../../../lib/producer-api/tools/common";
import { jsonResponse } from "../../../lib/supabaseServer";
import { MAX_CERTIFICATES_PER_PDF, loadCertificates, pdfFileName, renderCertificates } from "../../../lib/certificates";

export const prerender = false;

const fail = (code: string, message: string, status: number) => jsonResponse({ ok: false, error: { code, message } }, status);

const run = async (context: Parameters<APIRoute>[0], tool: string, args: Record<string, unknown>) => {
    const auth = await dashboardToolContext(context);
    if (!auth.ok) return fail(auth.status === 401 ? "unauthorized" : "forbidden", auth.error, auth.status);
    const outcome = await runTool(getTool(tool)!, args, auth.ctx);
    if (!outcome.ok) return fail(outcome.code, outcome.message, HTTP_STATUS[outcome.code]);
    return jsonResponse({ ok: true, data: outcome.result });
};

const options = (src: { get: (k: string) => unknown }) => {
    const out: Record<string, number> = {};
    const min = Math.round(Number(src.get("min_sessions")));
    if (Number.isInteger(min) && min > 1) out.min_sessions = min;
    const hours = Number(src.get("hours"));
    if (Number.isFinite(hours) && hours > 0) out.hours = hours;
    return out;
};

export const GET: APIRoute = async (context) => {
    const params = context.url.searchParams;
    const eventId = Math.round(Number(params.get("event_id")));
    if (params.get("format") !== "pdf") return run(context, "get_attendance_certificates", { event_id: eventId, ...options(params) });

    const auth = await dashboardToolContext(context);
    if (!auth.ok) return fail(auth.status === 401 ? "unauthorized" : "forbidden", auth.error, auth.status);
    if (!roleAllows(auth.ctx.actor.role, "attendees.read")) return fail("forbidden", "Tu rol no permite ver los datos de los asistentes.", 403);
    if (!Number.isSafeInteger(eventId) || eventId <= 0) return fail("invalid_input", "event_id inválido", 400);
    try {
        const event = await loadOwnedEvent<any>(auth.ctx, eventId, "id, name, organization_id, start_date");
        const opts = options(params);
        const certs = await loadCertificates(auth.ctx.supabase, event, { minSessions: opts.min_sessions ?? 1, hours: opts.hours ?? null });
        const eligible = certs.rows.filter((r) => r.eligible);
        if (!eligible.length) return fail("conflict", "Nadie cumple las condiciones para recibir certificado todavía.", 409);
        if (eligible.length > MAX_CERTIFICATES_PER_PDF) {
            return fail("conflict", `Son ${eligible.length} certificados: el PDF admite hasta ${MAX_CERTIFICATES_PER_PDF}. Escríbenos y te los preparamos.`, 409);
        }
        const pdf = renderCertificates(certs, eligible);
        return new Response(new Uint8Array(pdf), {
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="${pdfFileName("certificados", event.name)}"`,
                "Cache-Control": "private, no-store",
            },
        });
    } catch (err: any) {
        if (err instanceof ToolError) return fail(err.code, err.message, HTTP_STATUS[err.code]);
        console.error("certificates pdf:", err?.message || err);
        return fail("internal", "No se pudieron generar los certificados. Intenta nuevamente.", 500);
    }
};

export const POST: APIRoute = async (context) => {
    const body = await context.request.json().catch(() => null);
    if (body?.action !== "send") return fail("invalid_input", "Acción inválida.", 400);
    const args: Record<string, unknown> = {
        event_id: Math.round(Number(body?.event_id)),
        ...options({ get: (k: string) => body?.[k] }),
        resend_all: body?.resend_all === true,
    };
    if (typeof body?.note === "string" && body.note.trim()) args.note = body.note.trim().slice(0, 500);
    if (body?.confirmation_token) args.confirmation_token = String(body.confirmation_token);
    return run(context, "send_attendance_certificates", args);
};
