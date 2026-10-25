// Reclamos y contracargos (uso interno, header x-admin-secret = ADMIN_API_SECRET). Uno abierto retiene lo vendido de
// su función (o del evento, sin event_date_id) hasta que se resuelve (ledger.ts). Flow avisa los contracargos por
// correo: se registran aquí a mano.
// GET  ?event_id=&status=open                                    → lista
// POST { order_id, kind?, amount?, source?, notes?, reviewer }   → registra uno abierto (función y evento desde la orden)
// POST { dispute_id, status: won|lost|closed, notes?, reviewer } → lo cierra
import type { APIRoute } from "astro";
import { adminGuard, readJson } from "./_auth";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { jsonResponse } from "../../../lib/supabaseServer";
import { notifySlack } from "../_lib/server-utils";

export const prerender = false;

export const GET: APIRoute = async (context) => {
    const denied = adminGuard(context.request);
    if (denied) return denied;
    const params = new URL(context.request.url).searchParams;
    let q = getSupabaseAdmin().from("aitickets_disputes").select("*").order("created_at", { ascending: false }).limit(200);
    if (params.get("event_id")) q = q.eq("event_id", Number(params.get("event_id")));
    if (params.get("status")) q = q.eq("status", String(params.get("status")));
    const { data, error } = await q;
    if (error) return jsonResponse({ ok: false, error: { code: "internal", message: error.message } }, 500);
    return jsonResponse({ ok: true, data: { disputes: data || [] } });
};

async function functionOfOrder(supabase: any, orderId: string): Promise<number | null> {
    const { data: attendees } = await supabase.from("event_attendees").select("event_ticket_id").eq("event_order_id", orderId).limit(50);
    const ticketIds = [...new Set((attendees || []).map((a: any) => a.event_ticket_id).filter(Boolean))];
    if (!ticketIds.length) return null;
    const { data: tickets } = await supabase.from("event_tickets").select("id, event_date_id").in("id", ticketIds);
    const dates = new Set((tickets || []).map((t: any) => t.event_date_id));
    if (dates.size !== 1) return null;
    const [only] = [...dates];
    return only == null ? null : Number(only);
}

export const POST: APIRoute = async (context) => {
    const denied = adminGuard(context.request);
    if (denied) return denied;
    const body = await readJson(context.request);
    const reviewer = String(body?.reviewer || "").trim().slice(0, 80);
    if (!reviewer) return jsonResponse({ ok: false, error: { code: "invalid_input", message: "reviewer es obligatorio." } }, 400);
    const supabase = getSupabaseAdmin();

    if (body?.dispute_id) {
        const status = String(body?.status || "");
        if (!["won", "lost", "closed"].includes(status)) return jsonResponse({ ok: false, error: { code: "invalid_input", message: "status: won | lost | closed." } }, 400);
        const { data, error } = await supabase
            .from("aitickets_disputes")
            .update({ status, resolved_at: new Date().toISOString(), notes: body?.notes ? String(body.notes).slice(0, 2000) : undefined })
            .eq("id", String(body.dispute_id))
            .select("*")
            .maybeSingle();
        if (error) return jsonResponse({ ok: false, error: { code: "internal", message: error.message } }, 500);
        if (!data) return jsonResponse({ ok: false, error: { code: "not_found", message: "Reclamo no encontrado." } }, 404);
        return jsonResponse({ ok: true, data });
    }

    const orderId = String(body?.order_id || "");
    const { data: order } = await supabase.from("event_orders").select("id, event_id, amount, total_payment").eq("id", orderId).maybeSingle();
    if (!order) return jsonResponse({ ok: false, error: { code: "not_found", message: "Orden no encontrada." } }, 404);
    const { data: ev } = await supabase.from("events").select("id, name, organization_id").eq("id", order.event_id).maybeSingle();
    const kind = ["chargeback", "complaint", "sernac", "other"].includes(String(body?.kind)) ? String(body.kind) : "chargeback";
    const { data, error } = await supabase
        .from("aitickets_disputes")
        .insert({
            organization_id: ev?.organization_id ?? null,
            event_id: order.event_id,
            event_date_id: await functionOfOrder(supabase, orderId),
            order_id: orderId,
            kind,
            status: "open",
            amount: body?.amount != null ? Math.round(Number(body.amount)) : Number(order.total_payment ?? order.amount) || null,
            source: body?.source ? String(body.source).slice(0, 80) : `admin:${reviewer}`,
            notes: body?.notes ? String(body.notes).slice(0, 2000) : null,
        })
        .select("*")
        .single();
    if (error) return jsonResponse({ ok: false, error: { code: "internal", message: error.message } }, 500);
    await notifySlack(`💳 *${kind === "chargeback" ? "Contracargo" : "Reclamo"} registrado*\n• *Evento:* ${ev?.name || order.event_id} (#${order.event_id})\n• *Orden:* ${orderId}\n• Lo vendido de la función queda retenido hasta resolverlo.`);
    return jsonResponse({ ok: true, data });
};
