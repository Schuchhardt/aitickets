// POST /api/webhooks/sentry — webhooks de la Internal Integration de Sentry para la bandeja de errores
// (aitickets_error_issues; lógica en netlify/lib/sentry-issues.mjs). Recursos: `issue` (created, resolved,
// unresolved, ignored…) y `event_alert` (acción "Send a notification via <integración>" de una regla de alerta).
//
// Configuración: SENTRY_CLIENT_SECRET (Internal Integration > Credentials > Client Secret), leída en runtime. Sin ella
// la ruta no existe (404). Para `event_alert` además SENTRY_API_TOKEN (lee el issue de la API). El webhook de la
// integración trae issues de toda la organización: solo se guardan los del proyecto aitickets (SENTRY_PROJECT_ID).
// Respuestas: 200 aplicado o ignorado (recurso desconocido, repetido), 401 firma inválida, 400 JSON inválido,
// 413 cuerpo grande, 500 error de BD o de la API de Sentry (Sentry reintenta).
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { serverEnv } from "../_lib/server-utils";
import { handleSentryWebhook, sentryConfig, sentryProjectId, verifySentrySignature } from "../../../../netlify/lib/sentry-issues.mjs";

export const prerender = false;

const MAX_BODY_BYTES = 512 * 1024;

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });

const notFound = () => new Response(null, { status: 404 });

export const GET: APIRoute = () => notFound();

export const POST: APIRoute = async ({ request }) => {
    const secret = serverEnv("SENTRY_CLIENT_SECRET");
    if (!secret) return notFound();

    if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);

    if (!verifySentrySignature(secret, body, request.headers.get("sentry-hook-signature"))) return json({ error: "invalid_signature" }, 401);

    let payload: any;
    try {
        payload = JSON.parse(body);
    } catch {
        return json({ error: "invalid_json" }, 400);
    }

    const config = sentryConfig({
        SENTRY_API_TOKEN: serverEnv("SENTRY_API_TOKEN"),
        SENTRY_ORG: serverEnv("SENTRY_ORG"),
        SENTRY_PROJECT_ID: serverEnv("SENTRY_PROJECT_ID"),
        SENTRY_API_BASE: serverEnv("SENTRY_API_BASE"),
    });
    const result: any = await handleSentryWebhook(getSupabaseAdmin(), {
        resource: request.headers.get("sentry-hook-resource"),
        payload,
        config,
        projectId: sentryProjectId({ SENTRY_PROJECT_ID: serverEnv("SENTRY_PROJECT_ID") }),
    });
    if (!result.ok) {
        console.error("webhook sentry:", result.reason);
        return json({ error: "processing_error" }, 500);
    }
    return json({ ok: true, ...(result.ignored ? { ignored: result.ignored } : { created: result.created, regressed: result.regressed }) });
};
