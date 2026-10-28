// Credenciales con nombre para imprimir (CredentialsPrintCard.vue, pestaña Puerta del panel; src/lib/credentials.ts).
//   GET ?event_id=N[&function_id=M] → PDF A4 con 4 credenciales por hoja (nombre, empresa, tipo de entrada y QR)
// Con la sesión del usuario (dashboardToolContext): permiso attendees.read (llevan nombres) y acceso por evento del
// equipo (loadOwnedEvent).
import type { APIRoute } from "astro";
import { HTTP_STATUS, ToolError } from "../../../lib/producer-api/registry";
import { dashboardToolContext } from "../../../lib/producer-api/session";
import { roleAllows } from "../../../lib/producer-api/permissions";
import { loadOwnedEvent } from "../../../lib/producer-api/tools/common";
import { jsonResponse } from "../../../lib/supabaseServer";
import { MAX_CREDENTIALS_PER_PDF, loadCredentials, renderCredentials } from "../../../lib/credentials";
import { pdfFileName } from "../../../lib/certificates";

export const prerender = false;

const fail = (code: string, message: string, status: number) => jsonResponse({ ok: false, error: { code, message } }, status);

export const GET: APIRoute = async (context) => {
    const auth = await dashboardToolContext(context);
    if (!auth.ok) return fail(auth.status === 401 ? "unauthorized" : "forbidden", auth.error, auth.status);
    if (!roleAllows(auth.ctx.actor.role, "attendees.read")) return fail("forbidden", "Tu rol no permite ver los datos de los asistentes.", 403);
    const eventId = Math.round(Number(context.url.searchParams.get("event_id")));
    if (!Number.isSafeInteger(eventId) || eventId <= 0) return fail("invalid_input", "event_id inválido", 400);
    const rawFn = context.url.searchParams.get("function_id");
    const functionId = rawFn ? Math.round(Number(rawFn)) : null;
    if (functionId !== null && (!Number.isSafeInteger(functionId) || functionId <= 0)) return fail("invalid_input", "function_id inválido", 400);
    try {
        const event = await loadOwnedEvent<any>(auth.ctx, eventId, "id, name");
        const cards = await loadCredentials(auth.ctx.supabase, eventId, { functionId });
        if (!cards) return fail("not_found", "Esa función no es de este evento.", 404);
        if (!cards.length) return fail("conflict", "No hay entradas emitidas para imprimir credenciales.", 409);
        if (cards.length > MAX_CREDENTIALS_PER_PDF) return fail("conflict", `Son ${cards.length} credenciales: elige una función para dividirlas.`, 409);
        const pdf = renderCredentials(cards, event.name);
        return new Response(new Uint8Array(pdf), {
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="${pdfFileName("credenciales", event.name)}"`,
                "Cache-Control": "private, no-store",
            },
        });
    } catch (err: any) {
        if (err instanceof ToolError) return fail(err.code, err.message, HTTP_STATUS[err.code]);
        console.error("credentials pdf:", err?.message || err);
        return fail("internal", "No se pudieron generar las credenciales. Intenta nuevamente.", 500);
    }
};
