// Aprobación/rechazo de un borrador de respuesta desde Slack.
// GET ?t=<token firmado> muestra el borrador con botones (no actúa: Slack y los escáneres hacen GET).
// POST (form t + action=approve|reject) ejecuta. El token está firmado con LEAD_TOKEN_SECRET y vence en 7 días.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { verifyApproveToken } from "../../../lib/lead-token";
import { escapeHtml } from "../../../../netlify/lib/supabase.mjs";
import { getOutreachConfig } from "../../../../netlify/lib/outreach/config.mjs";
import { canReply } from "../../../../netlify/lib/outreach/guardrails.mjs";
import { validateOutgoing } from "../../../../netlify/lib/outreach/compose.mjs";
import { selectProvider } from "../../../../netlify/lib/outreach/providers/index.mjs";

export const prerender = false;

const page = (title: string, inner: string, status = 200) =>
    new Response(
        `<!doctype html><html lang="es-CL"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#f9fafb;color:#111;margin:0;padding:24px}main{max-width:720px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px}pre{white-space:pre-wrap;background:#f3f4f6;padding:12px;border-radius:8px;font-size:14px}button{padding:10px 18px;border-radius:8px;border:0;font-weight:600;cursor:pointer;margin-right:8px}.ok{background:#16a34a;color:#fff}.no{background:#e5e7eb}</style></head><body><main>${inner}</main></body></html>`,
        { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } }
    );

async function loadDraft(token: string) {
    const v = verifyApproveToken(token);
    if (!v) return null;
    const supabase = getSupabaseAdmin();
    const { data: msg } = await supabase.from("aitickets_outreach_messages").select("*").eq("id", v.messageId).maybeSingle();
    if (!msg || msg.direction !== "out") return null;
    const { data: lead } = await supabase.from("aitickets_leads").select("*").eq("id", msg.lead_id).maybeSingle();
    return lead ? { msg, lead } : null;
}

export const GET: APIRoute = async ({ url }) => {
    const t = url.searchParams.get("t") || "";
    const found = await loadDraft(t).catch(() => null);
    if (!found) return page("Enlace inválido", "<h1>Enlace inválido o vencido</h1>", 404);
    const { msg, lead } = found;
    const done = msg.status !== "draft";
    return page(
        "Revisar respuesta",
        `<h1>Respuesta para ${escapeHtml(lead.org_name || lead.email)}</h1>
<p><strong>Para:</strong> ${escapeHtml(lead.email)}<br><strong>Asunto:</strong> ${escapeHtml(msg.subject || "")}<br><strong>Intención:</strong> ${escapeHtml(msg.ai_intent || "—")}</p>
<pre>${escapeHtml(msg.body_text || "")}</pre>
${done ? `<p>Estado: <strong>${escapeHtml(msg.status)}</strong>${msg.approved_by ? ` (${escapeHtml(msg.approved_by)})` : ""}.</p>`
            : `<form method="post"><input type="hidden" name="t" value="${escapeHtml(t)}">
<button class="ok" name="action" value="approve">Aprobar y enviar</button><button class="no" name="action" value="reject">Rechazar</button></form>`}`
    );
};

export const POST: APIRoute = async ({ request }) => {
    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        return page("Solicitud inválida", "<h1>Solicitud inválida</h1>", 400);
    }
    const t = String(form.get("t") || "");
    const action = String(form.get("action") || "");
    const found = await loadDraft(t).catch(() => null);
    if (!found) return page("Enlace inválido", "<h1>Enlace inválido o vencido</h1>", 404);
    const { msg, lead } = found;
    if (msg.status !== "draft") return page("Ya procesado", `<h1>Este borrador ya fue ${escapeHtml(msg.status)}</h1>`);
    const supabase = getSupabaseAdmin();

    if (action === "reject") {
        await supabase.from("aitickets_outreach_messages").update({ status: "rejected", approved_by: "slack" }).eq("id", msg.id).eq("status", "draft");
        return page("Rechazado", "<h1>Borrador rechazado</h1><p>No se envió nada.</p>");
    }
    if (action !== "approve") return page("Acción inválida", "<h1>Acción inválida</h1>", 400);

    const cfg = getOutreachConfig();
    const validation = validateOutgoing(msg.body_text || "", { cfg, maxWords: 160 });
    if (!validation.ok) return page("No válido", `<h1>El borrador no pasa la validación</h1><p>${escapeHtml(validation.errors.join("; "))}</p>`, 422);

    const { provider, dryRun, blockers } = selectProvider(cfg);
    const replyTo = msg.ai_payload?.reply_to || null;
    if (dryRun || !replyTo || !msg.mailbox) {
        await supabase.from("aitickets_outreach_messages").update({ status: "approved", approved_by: "slack" }).eq("id", msg.id).eq("status", "draft");
        return page("Aprobado (sin enviar)", `<h1>Aprobado, pero no enviado</h1><p>El envío real está deshabilitado (${escapeHtml(blockers.join(", ") || "sin hilo de respuesta")}). Copia el texto y respóndelo desde el buzón.</p><pre>${escapeHtml(msg.body_text || "")}</pre>`);
    }
    // Respuesta a una persona que escribió: no aplican la ventana ni los topes del envío en frío, pero
    // cualquier otro motivo (supresión, pausa, apagado, legal, cliente, error al consultar) bloquea: falla cerrado.
    const check = await canReply(supabase, lead, new Date(), { cfg });
    if (!check.ok) {
        if (check.reason === "guardrail_error") {
            return page("Reintenta", "<h1>No se pudo verificar la lista de supresión</h1><p>No se envió nada. Reintenta en unos minutos.</p>", 503);
        }
        return page("No enviado", `<h1>No se envió</h1><p>Motivo: ${escapeHtml(check.reason || "")}</p>`, 409);
    }
    // Reclamo atómico del borrador (draft → sending): dos POST simultáneos (doble clic, dos personas) no
    // envían dos veces. Solo envía la solicitud que logró el cambio.
    const { data: claimed, error: claimErr } = await supabase
        .from("aitickets_outreach_messages")
        .update({ status: "sending", approved_by: "slack" })
        .eq("id", msg.id)
        .eq("status", "draft")
        .select("id");
    if (claimErr) {
        console.error("[outreach/approve] claim:", claimErr.message);
        return page("Reintenta", "<h1>No se pudo tomar el borrador</h1><p>No se envió nada. Reintenta en unos minutos.</p>", 503);
    }
    if (!claimed?.length) return page("Ya procesado", "<h1>Este borrador ya está siendo procesado o fue procesado</h1>");
    try {
        const sent = await provider.reply({ lead, subject: msg.subject, text: msg.body_text, replyTo, mailbox: msg.mailbox });
        await supabase
            .from("aitickets_outreach_messages")
            .update({ status: "sent", approved_by: "slack", sent_at: new Date().toISOString(), provider_message_id: sent.providerMessageId })
            .eq("id", msg.id)
            .eq("status", "sending");
        return page("Enviado", "<h1>Respuesta enviada</h1>");
    } catch (err: any) {
        console.error("[outreach/approve] error:", err?.message);
        // Se devuelve a 'draft' para que se pueda reintentar.
        await supabase
            .from("aitickets_outreach_messages")
            .update({ status: "draft", approved_by: null, error: String(err?.message || err).slice(0, 1000) })
            .eq("id", msg.id)
            .eq("status", "sending");
        return page("Error", "<h1>No se pudo enviar</h1><p>Revisa el proveedor y vuelve a intentar.</p>", 502);
    }
};
