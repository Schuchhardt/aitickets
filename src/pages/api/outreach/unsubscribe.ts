// Baja del outreach (Ley 19.496 art. 28 B, CAN-SPAM, RFC 8058).
// - POST ?t=<token> (one-click de List-Unsubscribe, body "List-Unsubscribe=One-Click"): suprime y responde 200.
// - POST desde el botón de /outreach/baja (form con t): suprime y redirige a /outreach/baja?listo=1.
// - GET ?t=<token>: NO actúa (los escáneres de enlaces hacen GET); redirige a la página de confirmación.
// Funciona siempre, aunque OUTREACH_ENABLED=false.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { verifyUnsubToken } from "../../../lib/lead-token";
import { suppress } from "../../../../netlify/lib/outreach/guardrails.mjs";
import { blockAtProvider } from "../../../../netlify/lib/outreach/provider-block.mjs";

export const prerender = false;

const text = (body: string, status = 200) =>
    new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

async function doUnsubscribe(token: string): Promise<boolean> {
    const payload = verifyUnsubToken(token);
    if (!payload) return false;
    const supabase = getSupabaseAdmin();
    await suppress(supabase, { email: payload.email, reason: "unsubscribe", source: "unsubscribe_link" });
    if (payload.leadId) {
        await supabase.from("aitickets_outreach_events").insert({ lead_id: payload.leadId, type: "unsubscribe", payload: { via: "link" } });
    }
    // Que el proveedor tampoco envíe los seguimientos ya programados (blocklist + sacar el lead de la
    // campaña). Si falla, blockAtProvider avisa por Slack y deja un pendiente que outreach-tick reintenta.
    await blockAtProvider(supabase, { email: payload.email, leadId: payload.leadId || null, source: "unsubscribe_link" });
    return true;
}

export const GET: APIRoute = async ({ url, redirect }) => {
    const t = url.searchParams.get("t") || "";
    return redirect(`/outreach/baja${t ? `?t=${encodeURIComponent(t)}` : ""}`, 302);
};

export const POST: APIRoute = async ({ request, url, redirect }) => {
    let token = url.searchParams.get("t") || "";
    let fromPage = false;
    const type = request.headers.get("content-type") || "";
    if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
        try {
            const form = await request.formData();
            const t = form.get("t");
            if (typeof t === "string" && t) {
                token = t;
                fromPage = form.get("from") === "page";
            }
        } catch { /* body one-click "List-Unsubscribe=One-Click" */ }
    }
    try {
        const ok = token ? await doUnsubscribe(token) : false;
        if (fromPage) return redirect(ok ? "/outreach/baja?listo=1" : "/outreach/baja?error=1", 303);
        return ok ? text("Listo: no volverás a recibir correos comerciales de AI Tickets.") : text("Enlace de baja inválido.", 400);
    } catch (err: any) {
        console.error("[outreach/unsubscribe] error:", err?.message);
        if (fromPage) return redirect("/outreach/baja?error=1", 303);
        return text("No pudimos procesar la baja. Responde NO al correo y te daremos de baja manualmente.", 500);
    }
};
