// POST /api/outreach/bot-optout — formulario de /bot: el dueño de un sitio pide que AITicketsBot no lo
// visite ni le escribamos. Registra una supresión 'bot_optout' por dominio (nunca para correo gratuito)
// y, si se entrega, también por email. Además bloquea en el proveedor (Instantly) para cortar los
// seguimientos que ya tenga programados: el email entregado y los emails de los leads de ese dominio.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { jsonResponse } from "../../../lib/supabaseServer";
import { verifyTurnstile } from "../../../../netlify/lib/turnstile.mjs";
import { isFreeMailDomain, normalizeEmail, registrableDomain } from "../../../../netlify/lib/outreach/domains.mjs";
import { suppress } from "../../../../netlify/lib/outreach/guardrails.mjs";
import { blockAtProvider, blockDomainAtProvider } from "../../../../netlify/lib/outreach/provider-block.mjs";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
    let body: any;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ message: "Solicitud inválida" }, 400);
    }
    const domain = registrableDomain(typeof body?.domain === "string" ? body.domain : "");
    const email = normalizeEmail(body?.email);
    if (!domain && !email) return jsonResponse({ message: "Indica el dominio de tu sitio o tu correo." }, 400);
    if (domain && isFreeMailDomain(domain) && !email) {
        return jsonResponse({ message: "Para correos gratuitos (gmail, hotmail...) indica tu dirección exacta." }, 400);
    }
    const ip = request.headers.get("x-nf-client-connection-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
    const captcha = await verifyTurnstile(body?.cfToken, ip);
    if (!captcha.success) return jsonResponse({ message: captcha.message || "Verificación fallida." }, 400);
    try {
        const supabase = getSupabaseAdmin();
        if (domain && !isFreeMailDomain(domain)) await suppress(supabase, { domain, reason: "bot_optout", source: "bot_page" });
        if (email) await suppress(supabase, { email, reason: "bot_optout", source: "bot_page" });
        // Nunca lanzan: si Instantly falla avisan por Slack y dejan un pendiente que outreach-tick reintenta.
        if (email) await blockAtProvider(supabase, { email, source: "bot_page" });
        if (domain && !isFreeMailDomain(domain)) await blockDomainAtProvider(supabase, { domain, source: "bot_page" });
        return jsonResponse({ ok: true });
    } catch (err: any) {
        console.error("[outreach/bot-optout] error:", err?.message);
        return jsonResponse({ message: "No pudimos registrar la solicitud. Escríbenos a contacto@aitickets.cl." }, 500);
    }
};
