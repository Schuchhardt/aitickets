// POST /api/outreach/inbound-lead — formulario de /web-gratis ("Tu web de eventos gratis").
// Doble opt-in: el correo del formulario no está verificado (cualquiera puede escribir el de un tercero).
// Aquí NO se toca ningún lead ni se registra consentimiento ni se emite token de registro: solo se guarda
// la solicitud pendiente y se envía un enlace firmado al correo ingresado. Al confirmar
// (/api/outreach/inbound-confirm) se crea/actualiza el lead con consentimiento y se redirige al registro
// prellenado. La respuesta siempre lleva al registro SIN token de lead.
import type { APIRoute } from "astro";
import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { signInboundConfirmToken } from "../../../lib/lead-token";
import { jsonResponse } from "../../../lib/supabaseServer";
import { verifyTurnstile } from "../../../../netlify/lib/turnstile.mjs";
import { SITE_URL, legalFooterHtml, legalFooterText, sendEmail } from "../../../../netlify/lib/mailer.mjs";
import { escapeHtml } from "../../../../netlify/lib/supabase.mjs";
import { normalizeEmail } from "../../../../netlify/lib/outreach/domains.mjs";
import { createInboundPending } from "../../../../netlify/lib/outreach/sources/inbound.mjs";

export const prerender = false;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export const POST: APIRoute = async ({ request }) => {
    let body: any;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ message: "Solicitud inválida" }, 400);
    }
    if (str(body?.company_website_hp, 200)) return jsonResponse({ ok: true }); // honeypot
    const email = normalizeEmail(body?.email);
    const orgName = str(body?.orgName, 200);
    if (!email || !orgName) return jsonResponse({ message: "Ingresa el nombre de tu productora y un correo válido." }, 400);
    if (body?.acceptedPrivacy !== true) return jsonResponse({ message: "Debes aceptar la política de privacidad." }, 400);

    const ip = request.headers.get("x-nf-client-connection-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
    const captcha = await verifyTurnstile(body?.cfToken, ip || undefined);
    if (!captcha.success) return jsonResponse({ message: captcha.message || "Verificación fallida." }, 400);

    const registerUrl = "/organizadores/registro?utm_source=web-gratis";
    try {
        const supabase = getSupabaseAdmin();
        const pendingId = await createInboundPending(supabase, {
            orgName,
            contactName: str(body?.name, 120),
            email,
            phone: str(body?.phone, 40),
            website: str(body?.website, 300),
            city: str(body?.city, 120),
            eventName: str(body?.eventName, 200),
            message: str(body?.message, 1000),
            ip: ip ? createHash("sha256").update(ip).digest("hex").slice(0, 32) : null,
        });
        const token = signInboundConfirmToken(pendingId, email);
        if (!token) throw new Error("LEAD_TOKEN_SECRET no configurado");
        // Nunca el Host de la request (un dominio propio de un productor es alias del mismo sitio).
        const confirmUrl = `${SITE_URL}/api/outreach/inbound-confirm?t=${encodeURIComponent(token)}`;
        const reason = "Recibes este correo porque alguien ingresó esta dirección en el formulario de aitickets.cl/web-gratis. Si no fuiste tú, ignóralo: no guardaremos tu correo para contactarte.";
        await sendEmail({
            to: email,
            subject: "Confirma tu correo para tu web de eventos gratis",
            html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">
<p>Hola,</p>
<p>Recibimos una solicitud para crear la web de eventos gratis de <strong>${escapeHtml(orgName)}</strong> en AI Tickets.</p>
<p>Para continuar, confirma que este correo es tuyo:</p>
<p><a href="${escapeHtml(confirmUrl)}" style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Confirmar mi correo</a></p>
<p style="font-size:13px;color:#555">El enlace vence en 72 horas.</p>
</div>${legalFooterHtml({ reason })}`,
            text: `Hola,\n\nRecibimos una solicitud para crear la web de eventos gratis de ${orgName} en AI Tickets.\nPara continuar, confirma que este correo es tuyo (el enlace vence en 72 horas):\n${confirmUrl}\n\n${legalFooterText({ reason })}`,
            tags: ["web-gratis-confirm"],
        });
        return jsonResponse({
            ok: true,
            confirmationSent: true,
            message: `Te enviamos un correo a ${email}. Ábrelo y confirma tu dirección para seguir con tu web gratis.`,
            redirectUrl: registerUrl,
        });
    } catch (err: any) {
        console.error("[outreach/inbound-lead] error:", err?.message);
        // Aunque falle (p. ej. preview sin migración o sin correo), la persona puede registrarse igual,
        // pero sin prellenado ni consentimiento registrado.
        return jsonResponse({ ok: true, redirectUrl: registerUrl });
    }
};
