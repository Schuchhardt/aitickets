// POST /api/webhooks/resend — eventos de entrega de Resend (firmados con Svix) para aitickets_email_log:
// email.delivered, email.delivery_delayed, email.bounced y email.complained actualizan el estado del correo
// por su id de Resend (netlify/lib/resend-webhook.mjs). Un rebote o queja de un correo de entradas avisa a Slack.
//
// Configuración: RESEND_WEBHOOK_SECRET ("whsec_…", Resend > Webhooks > Signing secret), leída en runtime.
// Sin ella la ruta no existe (404). Solo en el host principal: el middleware devuelve 404 en hosts de productores.
// Respuestas: 200 aplicado o ignorado (evento desconocido, correo no registrado, repetido), 401 firma inválida,
// 400 JSON inválido, 413 cuerpo grande, 500 error de BD (Svix reintenta).
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { notifySlack, serverEnv } from "../_lib/server-utils";
import { verifyWebhookSignature, handleResendEvent } from "../../../../netlify/lib/resend-webhook.mjs";

export const prerender = false;

const MAX_BODY_BYTES = 256 * 1024;

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });

const notFound = () => new Response(null, { status: 404 });

export const GET: APIRoute = () => notFound();

export const POST: APIRoute = async ({ request }) => {
    const secret = serverEnv("RESEND_WEBHOOK_SECRET");
    if (!secret) return notFound();

    if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);

    const svixId = request.headers.get("svix-id");
    const verified = verifyWebhookSignature({
        secret,
        id: svixId,
        timestamp: request.headers.get("svix-timestamp"),
        signature: request.headers.get("svix-signature"),
        body,
    });
    if (!verified.ok) return json({ error: "invalid_signature" }, 401);

    let payload: any;
    try {
        payload = JSON.parse(body);
    } catch {
        return json({ error: "invalid_json" }, 400);
    }

    const result = await handleResendEvent(getSupabaseAdmin(), payload, svixId as string);
    if (!result.ok) {
        console.error("webhook resend:", result.reason);
        return json({ error: "storage_error" }, 500);
    }

    const row: any = result.row;
    const newlyFailed = result.updated && row?.kind === "tickets" && ["bounced", "complained"].includes(row?.status) && row?.status !== result.previousStatus;
    if (newlyFailed) {
        const what = row.status === "bounced" ? "rebotó" : "fue marcado como spam";
        await notifySlack(
            `📭 *Correo de entradas ${what}*\n• *Orden:* ${row.order_id || "—"}\n• *Evento:* ${row.event_id || "—"}` +
                (row.error ? `\n• *Motivo:* ${String(row.error).slice(0, 200)}` : "") +
                "\nEl productor lo ve en get_order (email_delivery); hay que pedirle al comprador otra dirección.",
        );
    }
    return json({ ok: true, applied: Boolean(result.updated), ...(result.updated ? {} : { reason: result.reason }) });
};
