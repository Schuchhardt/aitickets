// Confirmación del correo del formulario /web-gratis (doble opt-in).
// GET ?t=<token firmado> muestra un botón (no actúa: los escáneres de correo hacen GET a los enlaces).
// POST (form t) aplica la solicitud: crea/actualiza el lead con consentimiento y redirige al registro
// prellenado con el token del lead. Solo quien recibió el correo tiene el token, así que el consentimiento
// y el prellenado corresponden al dueño real de la dirección.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { signLeadToken, verifyInboundConfirmToken } from "../../../lib/lead-token";
import { escapeHtml } from "../../../../netlify/lib/supabase.mjs";
import { confirmInboundPending } from "../../../../netlify/lib/outreach/sources/inbound.mjs";
import { notifyOutreach } from "../../../../netlify/lib/outreach/notify.mjs";

export const prerender = false;

const REGISTER = "/organizadores/registro?utm_source=web-gratis";

const page = (title: string, inner: string, status = 200) =>
    new Response(
        `<!doctype html><html lang="es-CL"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#f9fafb;color:#111;margin:0;padding:24px}main{max-width:560px;margin:40px auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px}button,.btn{display:inline-block;padding:12px 20px;border-radius:8px;border:0;font-weight:600;cursor:pointer;background:#111;color:#fff;text-decoration:none;font-size:15px}</style></head><body><main>${inner}</main></body></html>`,
        { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "same-origin" } }
    );

const invalid = () =>
    page(
        "Enlace inválido",
        `<h1>Enlace inválido o vencido</h1><p>Vuelve a completar el formulario de <a href="/web-gratis">tu web gratis</a> o <a href="${REGISTER}">regístrate directamente</a>.</p>`,
        404
    );

export const GET: APIRoute = async ({ url }) => {
    const t = url.searchParams.get("t") || "";
    if (!verifyInboundConfirmToken(t)) return invalid();
    return page(
        "Confirma tu correo",
        `<h1>Confirma tu correo</h1><p>Confirma que quieres que AI Tickets te contacte sobre tu web de eventos gratis y seguir con tu registro.</p>
<form method="post"><input type="hidden" name="t" value="${escapeHtml(t)}"><button type="submit">Confirmar y continuar</button></form>`
    );
};

export const POST: APIRoute = async ({ request }) => {
    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        return invalid();
    }
    const v = verifyInboundConfirmToken(String(form.get("t") || ""));
    if (!v) return invalid();
    try {
        const r = await confirmInboundPending(getSupabaseAdmin(), v);
        if (!r) return invalid();
        if (!r.alreadyConfirmed) {
            const conflict = r.domainConflict ? " ⚠️ el sitio indicado ya pertenece a otro lead: revisar antes de unirlos" : "";
            await notifyOutreach(`🌱 Lead entrante confirmado (web gratis): <${v.email}>${r.created ? "" : " (ya existía)"}${conflict}`);
        }
        const token = signLeadToken(r.leadId);
        const params = new URLSearchParams({ utm_source: "web-gratis", ref: `lead_${r.leadId}` });
        if (token) params.set("lead", token);
        return new Response(null, { status: 303, headers: { Location: `/organizadores/registro?${params}`, "Cache-Control": "no-store" } });
    } catch (err: any) {
        console.error("[outreach/inbound-confirm] error:", err?.message);
        return page("Reintenta", `<h1>No pudimos confirmar tu correo</h1><p>Reintenta en unos minutos o <a href="${REGISTER}">regístrate directamente</a>.</p>`, 503);
    }
};
