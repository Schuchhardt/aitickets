// Webhook de Didit: actualiza la identidad del productor (organizations.identity_*).
// Verifica la firma (X-Signature-V2 / X-Signature con DIDIT_WEBHOOK_SECRET) y responde rápido (Didit corta a los 5 s).
// Solo guarda estado, nombre y RUT: las imágenes quedan en Didit.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { jsonResponse } from "../../../lib/supabaseServer";
import { serverEnv } from "../_lib/server-utils";
import { applyDiditDecision } from "../../../lib/producerIdentity";
import { orgIdFromVendorData, verifyDiditWebhook } from "../../../../netlify/lib/identity.mjs";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
    const rawBody = await request.text();
    const check = verifyDiditWebhook({ rawBody, headers: request.headers, secret: serverEnv("DIDIT_WEBHOOK_SECRET") || "" });
    if (!check.ok) {
        console.warn("Didit webhook rechazado:", check.error);
        return jsonResponse({ error: check.error }, 401);
    }
    const payload: any = check.payload;
    const orgId = orgIdFromVendorData(payload?.vendor_data ?? payload?.decision?.vendor_data);
    if (!orgId) return jsonResponse({ ok: true, ignored: "vendor_data" }, 200);
    try {
        const status = await applyDiditDecision(getSupabaseAdmin(), orgId, {
            sessionId: payload?.session_id ? String(payload.session_id) : null,
            status: payload?.status ?? payload?.decision?.status ?? null,
            decision: payload?.decision,
        });
        return jsonResponse({ ok: true, status }, 200);
    } catch (err: any) {
        console.error("Didit webhook:", err?.message || err);
        // 5xx => Didit reintenta
        return jsonResponse({ error: "No se pudo procesar" }, 500);
    }
};
