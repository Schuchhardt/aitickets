// POST /api/webhooks/zernio — webhooks de Zernio para la difusión automática: estado de cada publicación
// (post.platform.published / failed / cancelled) y cuentas desconectadas (account.disconnected).
// Firma: X-Zernio-Signature = HMAC-SHA256 hex del cuerpo crudo con ZERNIO_WEBHOOK_SECRET (sin secreto: 404).
// Deduplica por X-Zernio-Event-Id (aitickets_zernio_webhook_events): Zernio reintenta y redelivera con el mismo id.
// Alta del webhook en Zernio: node scripts/zernio-webhook.mjs (docs/runbooks/historias-automaticas.md).
import type { APIRoute } from "astro";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { jsonResponse } from "../../../lib/supabaseServer";
import { handleZernioWebhook } from "../../../lib/socialSeries";
import { publicOrigin } from "../../../lib/producer-api/http";
import { serverEnv, siteUrl } from "../_lib/server-utils";

export const prerender = false;

const MAX_BODY = 512 * 1024;

export function validZernioSignature(rawBody: string, signature: string | null, secret: string): boolean {
    if (!signature || !/^[0-9a-f]{64}$/i.test(signature.trim())) return false;
    const expected = createHmac("sha256", secret).update(rawBody).digest();
    return timingSafeEqual(expected, Buffer.from(signature.trim().toLowerCase(), "hex"));
}

export const POST: APIRoute = async ({ request }) => {
    const secret = serverEnv("ZERNIO_WEBHOOK_SECRET");
    if (!secret) return new Response(null, { status: 404 });
    const raw = await request.text();
    if (raw.length > MAX_BODY) return jsonResponse({ error: "Cuerpo demasiado grande" }, 413);
    if (!validZernioSignature(raw, request.headers.get("x-zernio-signature") || request.headers.get("x-late-signature"), secret)) {
        return jsonResponse({ error: "Firma inválida" }, 401);
    }
    let payload: any;
    try {
        payload = JSON.parse(raw);
    } catch {
        return jsonResponse({ error: "JSON inválido" }, 400);
    }
    const eventId = String(request.headers.get("x-zernio-event-id") || payload?.id || "").slice(0, 120);
    const eventName = String(payload?.event || request.headers.get("x-zernio-event") || "").slice(0, 80);
    if (!eventId || !eventName) return jsonResponse({ error: "Evento sin id" }, 400);
    if (payload?.test) return jsonResponse({ ok: true, test: true });

    const supabase = getSupabaseAdmin();
    const { error: dupError } = await supabase.from("aitickets_zernio_webhook_events").insert({ event_id: eventId, event: eventName });
    if (dupError) {
        if (String(dupError.code) === "23505") return jsonResponse({ ok: true, duplicate: true });
        if (!["42P01", "PGRST205"].includes(String(dupError.code || ""))) console.warn("webhook zernio (dedupe):", dupError.message);
    }
    try {
        const result = await handleZernioWebhook(supabase, payload, siteUrl() || publicOrigin(new URL(request.url)));
        await supabase.from("aitickets_zernio_webhook_events").update({ result: result.slice(0, 200) }).eq("event_id", eventId);
        return jsonResponse({ ok: true, result });
    } catch (err: any) {
        console.error("webhook zernio:", err?.message || err);
        // Se libera el id para que el reintento de Zernio lo procese
        await supabase.from("aitickets_zernio_webhook_events").delete().eq("event_id", eventId);
        return jsonResponse({ ok: false, error: "Error interno" }, 500);
    }
};
