// Revisión de documentos del evento por AI Tickets (uso interno, header x-admin-secret = ADMIN_API_SECRET).
// GET  ?status=pending                                 → documentos por revisar, con URL firmada (5 min)
// POST { document_id, status: approved|rejected, notes?, reviewer } → recalcula events.permit_status
import type { APIRoute } from "astro";
import { adminGuard, readJson } from "../_auth";
import { getSupabaseAdmin } from "../../../../lib/auth-helpers";
import { jsonResponse } from "../../../../lib/supabaseServer";
import { documentDownloadUrl, recomputePermitStatus, DOCUMENT_KINDS } from "../../../../lib/eventDocuments";
import { purgeEventPages } from "../../../../lib/cdnCache";

export const prerender = false;

export const GET: APIRoute = async (context) => {
    const denied = adminGuard(context.request);
    if (denied) return denied;
    const status = new URL(context.request.url).searchParams.get("status") || "pending";
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
        .from("aitickets_event_documents")
        .select("id, event_id, organization_id, kind, status, file_name, storage_path, notes, created_at")
        .eq("status", status)
        .order("created_at", { ascending: true })
        .limit(100);
    if (error) return jsonResponse({ ok: false, error: { code: "internal", message: error.message } }, 500);
    const documents = await Promise.all(
        (data || []).map(async (d: any) => ({ ...d, kind_label: DOCUMENT_KINDS[d.kind as keyof typeof DOCUMENT_KINDS], url: await documentDownloadUrl(supabase, d.storage_path) })),
    );
    return jsonResponse({ ok: true, data: { documents } });
};

export const POST: APIRoute = async (context) => {
    const denied = adminGuard(context.request);
    if (denied) return denied;
    const body = await readJson(context.request);
    const status = String(body?.status || "");
    if (!body?.document_id || !["approved", "rejected"].includes(status) || !String(body?.reviewer || "").trim()) {
        return jsonResponse({ ok: false, error: { code: "invalid_input", message: "document_id, status (approved|rejected) y reviewer son obligatorios." } }, 400);
    }
    const supabase = getSupabaseAdmin();
    const { data: doc, error } = await supabase
        .from("aitickets_event_documents")
        .update({ status, notes: body?.notes ? String(body.notes).slice(0, 1000) : null, reviewed_at: new Date().toISOString(), reviewed_by: String(body.reviewer).slice(0, 120) })
        .eq("id", String(body.document_id))
        .select("id, event_id, organization_id, kind, status")
        .maybeSingle();
    if (error) return jsonResponse({ ok: false, error: { code: "internal", message: error.message } }, 500);
    if (!doc) return jsonResponse({ ok: false, error: { code: "not_found", message: "Documento no encontrado." } }, 404);
    const permit = await recomputePermitStatus(supabase, Number(doc.event_id));
    await supabase.from("aitickets_api_audit").insert({
        organization_id: doc.organization_id,
        api_key_id: null,
        user_id: null,
        tool: "admin_review_document",
        channel: "admin",
        ok: true,
        event_id: doc.event_id,
        summary: `${DOCUMENT_KINDS[doc.kind as keyof typeof DOCUMENT_KINDS]}: ${status} por ${String(body.reviewer).slice(0, 80)}`,
        target: `event:${doc.event_id}`,
    });
    await purgeEventPages();
    return jsonResponse({ ok: true, data: { document: doc, permit_status: permit } });
};
