// Riesgo y reserva de un evento (uso interno, header x-admin-secret = ADMIN_API_SECRET).
// GET  ?event_id=                                       → riesgo guardado y recalculado (sin guardar)
// POST { event_id, reviewer, reserve_pct?, risk_level?, requires_documents?, lock }
//   lock: true fija los valores enviados (el recálculo automático no los pisa); lock: false vuelve al cálculo automático.
import type { APIRoute } from "astro";
import { adminGuard, readJson } from "../_auth";
import { getSupabaseAdmin } from "../../../../lib/auth-helpers";
import { jsonResponse } from "../../../../lib/supabaseServer";
import { loadEventRiskInput, refreshEventRisk, scoreEventRisk } from "../../../../lib/eventRisk";

export const prerender = false;

export const GET: APIRoute = async (context) => {
    const denied = adminGuard(context.request);
    if (denied) return denied;
    const eventId = Number(new URL(context.request.url).searchParams.get("event_id"));
    if (!Number.isInteger(eventId) || eventId <= 0) return jsonResponse({ ok: false, error: { code: "invalid_input", message: "event_id inválido." } }, 400);
    const supabase = getSupabaseAdmin();
    const { data: stored } = await supabase
        .from("events")
        .select("id, name, risk_score, risk_level, risk_signals, reserve_pct, requires_documents, risk_locked, is_massive, permit_status")
        .eq("id", eventId)
        .maybeSingle();
    if (!stored) return jsonResponse({ ok: false, error: { code: "not_found", message: "Evento no encontrado." } }, 404);
    const input = await loadEventRiskInput(supabase, eventId);
    return jsonResponse({ ok: true, data: { stored, computed: input ? scoreEventRisk(input) : null, input } });
};

export const POST: APIRoute = async (context) => {
    const denied = adminGuard(context.request);
    if (denied) return denied;
    const body = await readJson(context.request);
    const eventId = Number(body?.event_id);
    if (!Number.isInteger(eventId) || eventId <= 0 || !String(body?.reviewer || "").trim()) {
        return jsonResponse({ ok: false, error: { code: "invalid_input", message: "event_id y reviewer son obligatorios." } }, 400);
    }
    const supabase = getSupabaseAdmin();
    const { data: ev } = await supabase.from("events").select("id, organization_id").eq("id", eventId).maybeSingle();
    if (!ev) return jsonResponse({ ok: false, error: { code: "not_found", message: "Evento no encontrado." } }, 404);

    let summary: string;
    if (body?.lock === false) {
        await supabase.from("events").update({ risk_locked: false }).eq("id", eventId);
        const risk = await refreshEventRisk(supabase, eventId);
        summary = `Riesgo vuelve a cálculo automático (${risk?.level}, reserva ${risk?.reserve_pct}%)`;
    } else {
        const patch: Record<string, unknown> = { risk_locked: true, risk_computed_at: new Date().toISOString() };
        if (body?.reserve_pct != null) {
            const pct = Math.round(Number(body.reserve_pct));
            if (!Number.isFinite(pct) || pct < 0 || pct > 100) return jsonResponse({ ok: false, error: { code: "invalid_input", message: "reserve_pct: 0 a 100." } }, 400);
            patch.reserve_pct = pct;
        }
        if (body?.risk_level != null) {
            if (!["low", "medium", "high"].includes(String(body.risk_level))) return jsonResponse({ ok: false, error: { code: "invalid_input", message: "risk_level: low | medium | high." } }, 400);
            patch.risk_level = String(body.risk_level);
        }
        if (body?.requires_documents != null) patch.requires_documents = body.requires_documents === true;
        const { error } = await supabase.from("events").update(patch).eq("id", eventId);
        if (error) return jsonResponse({ ok: false, error: { code: "internal", message: error.message } }, 500);
        summary = `Riesgo fijado a mano: ${JSON.stringify({ reserve_pct: patch.reserve_pct, risk_level: patch.risk_level, requires_documents: patch.requires_documents })}`;
    }
    await supabase.from("aitickets_api_audit").insert({
        organization_id: ev.organization_id,
        api_key_id: null,
        user_id: null,
        tool: "admin_set_event_risk",
        channel: "admin",
        ok: true,
        event_id: eventId,
        summary: `${summary} por ${String(body.reviewer).slice(0, 80)}`.slice(0, 300),
        target: `event:${eventId}`,
    });
    const { data: after } = await supabase.from("events").select("id, risk_level, reserve_pct, requires_documents, risk_locked").eq("id", eventId).maybeSingle();
    return jsonResponse({ ok: true, data: after });
};
