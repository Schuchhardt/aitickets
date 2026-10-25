// Devolución directa de un evento sin autorización del productor (uso interno de AI Tickets).
// Header: x-admin-secret = ADMIN_API_SECRET. Runbook: docs/runbooks/devolucion-directa.md.
//   POST { event_id, reason_code, admin, detail?, buyer_message?, notify_buyers?, dry_run? }
//   reason_code: not_held | producer_unresponsive | permit_revoked | fraud
//   dry_run: true (por defecto) devuelve el resumen sin ejecutar; dry_run: false cancela y registra los reembolsos.
import type { APIRoute } from "astro";
import { directRefundEvent, DIRECT_REFUND_REASONS } from "../../../../lib/adminDirectRefund";
import { adminGuard } from "../_auth";
import { ToolError, HTTP_STATUS } from "../../../../lib/producer-api/registry";
import { publicOrigin } from "../../../../lib/producer-api/http";
import { getSupabaseAdmin } from "../../../../lib/auth-helpers";
import { jsonResponse } from "../../../../lib/supabaseServer";

export const prerender = false;

export const POST: APIRoute = async (context) => {
    const denied = adminGuard(context.request);
    if (denied) return denied;

    let body: any = {};
    try {
        body = await context.request.json();
    } catch {
        return jsonResponse({ ok: false, error: { code: "invalid_input", message: "Cuerpo JSON inválido." } }, 400);
    }
    const eventId = Number(body?.event_id);
    if (!Number.isInteger(eventId) || eventId <= 0) return jsonResponse({ ok: false, error: { code: "invalid_input", message: "event_id inválido." } }, 400);
    if (!(String(body?.reason_code) in DIRECT_REFUND_REASONS)) {
        return jsonResponse({ ok: false, error: { code: "invalid_input", message: `reason_code: ${Object.keys(DIRECT_REFUND_REASONS).join(" | ")}` } }, 400);
    }
    const requestUrl = new URL(context.request.url);
    try {
        const result = await directRefundEvent({
            supabase: getSupabaseAdmin(),
            eventId,
            reasonCode: body.reason_code,
            admin: String(body?.admin || "").slice(0, 120),
            detail: body?.detail ? String(body.detail).slice(0, 1000) : undefined,
            buyerMessage: body?.buyer_message ? String(body.buyer_message).slice(0, 1000) : undefined,
            notifyBuyers: body?.notify_buyers !== false,
            dryRun: body?.dry_run !== false,
            requestUrl,
            origin: publicOrigin(requestUrl),
        });
        return jsonResponse({ ok: true, data: result });
    } catch (err: any) {
        if (err instanceof ToolError) return jsonResponse({ ok: false, error: { code: err.code, message: err.message } }, HTTP_STATUS[err.code]);
        console.error("admin direct-refund:", err?.message);
        return jsonResponse({ ok: false, error: { code: "internal", message: "Error interno." } }, 500);
    }
};
