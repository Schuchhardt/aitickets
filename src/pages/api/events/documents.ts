// Documentos y estado de autorización del evento desde el panel (EventDocumentsManager.vue).
// GET  ?eventId=                                                   → { available, event, documents, missing, kinds }
// GET  ?eventId=&download=<id>                                     → 302 a una URL firmada (5 min) del documento
// POST { eventId, action: "upload_url", kind, contentType, size, fileName } → { uploadUrl, path }  (subida directa a Storage)
// POST { eventId, action: "confirm", kind, path, fileName }        → { document, permit_status }
// POST { eventId, action: "set_massive", is_massive }              → { is_massive, permit_status, risk }
// Los documentos los revisa AI Tickets (/api/admin/events/documents). Bucket privado: src/lib/eventDocuments.ts.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, jsonResponse, type SessionContext } from "../../../lib/supabaseServer";
import {
    DOCUMENT_KINDS,
    DOCUMENT_MAX_BYTES,
    DOCUMENT_TYPES,
    isDocumentKind,
    loadEventDocuments,
    missingDocumentKinds,
    recomputePermitStatus,
    createDocumentUpload,
    verifyUploadedDocument,
    documentDownloadUrl,
} from "../../../lib/eventDocuments";
import { refreshEventRisk } from "../../../lib/eventRisk";
import { notifySlack } from "../_lib/server-utils";

export const prerender = false;

const EVENT_COLUMNS = "id, name, organization_id, is_massive, requires_documents, permit_status, risk_level, reserve_pct";
const UNAVAILABLE = "Los documentos del evento aún no están disponibles. Intenta más tarde.";

async function authorize(context: Parameters<typeof getSessionContext>[0], eventId: number): Promise<{ session: SessionContext; event: any } | Response> {
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ message: "No autorizado" }, 401);
    if (!hasRole(session.dbUser, EVENT_MANAGER_ROLES)) return jsonResponse({ message: "No tienes permisos para editar eventos" }, 403);
    if (!Number.isSafeInteger(eventId) || eventId <= 0) return jsonResponse({ message: "eventId es obligatorio" }, 400);
    let event = await getOwnedEvent(eventId, session.dbUser.organization_id, EVENT_COLUMNS, session.dbUser.id).catch(() => null);
    if (!event) event = await getOwnedEvent(eventId, session.dbUser.organization_id, "id, name, organization_id", session.dbUser.id);
    if (!event) return jsonResponse({ message: "Evento no encontrado" }, 404);
    return { session, event };
}

async function audit(session: SessionContext, eventId: number, tool: string, summary: string) {
    const { error } = await getSupabaseAdmin()
        .from("aitickets_api_audit")
        .insert({
            organization_id: Number(session.dbUser.organization_id),
            api_key_id: null,
            user_id: Number(session.dbUser.id),
            tool,
            channel: "dashboard",
            ok: true,
            event_id: eventId,
            summary: summary.slice(0, 300),
            target: `event:${eventId}`,
        });
    if (error) console.warn("events/documents audit:", error.message);
}

const presentDoc = (d: any) => ({
    id: d.id,
    kind: d.kind,
    kind_label: DOCUMENT_KINDS[d.kind as keyof typeof DOCUMENT_KINDS] || d.kind,
    status: d.status,
    file_name: d.file_name,
    size_bytes: d.size_bytes,
    notes: d.status === "rejected" ? d.notes : null,
    reviewed_at: d.reviewed_at,
    created_at: d.created_at,
});

export const GET: APIRoute = async (context) => {
    const params = new URL(context.request.url).searchParams;
    const eventId = Number(params.get("eventId"));
    const auth = await authorize(context, eventId);
    if (auth instanceof Response) return auth;
    const supabase = getSupabaseAdmin();
    const { available, documents } = await loadEventDocuments(supabase, eventId).catch(() => ({ available: false, documents: [] as any[] }));

    const download = params.get("download");
    if (download) {
        const doc = documents.find((d) => String(d.id) === download);
        if (!doc) return jsonResponse({ message: "Documento no encontrado" }, 404);
        const url = await documentDownloadUrl(supabase, doc.storage_path);
        if (!url) return jsonResponse({ message: "No se pudo abrir el documento" }, 500);
        return context.redirect(url, 302);
    }

    return jsonResponse({
        available,
        event: {
            is_massive: Boolean(auth.event.is_massive),
            requires_documents: Boolean(auth.event.requires_documents),
            permit_status: auth.event.permit_status || "none",
            risk_level: auth.event.risk_level || null,
            reserve_pct: Number(auth.event.reserve_pct) || 0,
        },
        documents: documents.map(presentDoc),
        missing: missingDocumentKinds(auth.event, documents),
        kinds: DOCUMENT_KINDS,
        max_bytes: DOCUMENT_MAX_BYTES,
    });
};

export const POST: APIRoute = async (context) => {
    const body = await context.request.json().catch(() => null);
    const eventId = Number(body?.eventId);
    const auth = await authorize(context, eventId);
    if (auth instanceof Response) return auth;
    const orgId = Number(auth.session.dbUser.organization_id);
    const supabase = getSupabaseAdmin();

    switch (body?.action) {
        case "upload_url": {
            const contentType = String(body.contentType || "").toLowerCase();
            const size = Number(body.size);
            if (!isDocumentKind(body.kind)) return jsonResponse({ message: "Tipo de documento no válido" }, 400);
            if (!DOCUMENT_TYPES[contentType]) return jsonResponse({ message: "Formato no soportado: usa PDF, JPG, PNG o WEBP." }, 400);
            if (!Number.isFinite(size) || size <= 0) return jsonResponse({ message: "Archivo no válido" }, 400);
            if (size > DOCUMENT_MAX_BYTES) return jsonResponse({ message: "El archivo supera los 15 MB." }, 400);
            if (!(await loadEventDocuments(supabase, eventId).catch(() => ({ available: false }))).available) return jsonResponse({ message: UNAVAILABLE }, 503);
            try {
                const upload = await createDocumentUpload(supabase, orgId, eventId, contentType, String(body.fileName || ""));
                return jsonResponse({ uploadUrl: upload.uploadUrl, path: upload.path, maxBytes: DOCUMENT_MAX_BYTES });
            } catch (err: any) {
                console.error("events/documents (upload_url):", err?.message || err);
                return jsonResponse({ message: "No se pudo preparar la subida del documento" }, 500);
            }
        }

        case "confirm": {
            if (!isDocumentKind(body.kind)) return jsonResponse({ message: "Tipo de documento no válido" }, 400);
            const path = String(body.path || "");
            let verified;
            try {
                verified = await verifyUploadedDocument(supabase, orgId, eventId, path);
            } catch (err: any) {
                console.error("events/documents (confirm):", err?.message || err);
                return jsonResponse({ message: "No se pudo verificar el documento" }, 500);
            }
            if (!verified) return jsonResponse({ message: "No encontramos el archivo subido. Vuelve a intentarlo." }, 400);
            const { data: doc, error } = await supabase
                .from("aitickets_event_documents")
                .insert({
                    event_id: eventId,
                    organization_id: orgId,
                    kind: body.kind,
                    status: "pending",
                    storage_path: path,
                    file_name: String(body.fileName || "").slice(0, 200) || null,
                    mime_type: verified.mime,
                    size_bytes: verified.size,
                    uploaded_by: Number(auth.session.dbUser.id),
                })
                .select("id, event_id, kind, status, file_name, size_bytes, notes, reviewed_at, created_at")
                .single();
            if (error) {
                console.error("events/documents (insert):", error.message);
                return jsonResponse({ message: UNAVAILABLE }, 503);
            }
            const permit = await recomputePermitStatus(supabase, eventId).catch(() => null);
            await audit(auth.session, eventId, "upload_event_document", `Subió ${DOCUMENT_KINDS[body.kind as keyof typeof DOCUMENT_KINDS]}`);
            await notifySlack(
                `📄 *Documento del evento para revisar*\n• *Evento:* ${auth.event.name} (#${eventId}, org ${orgId})\n• *Tipo:* ${DOCUMENT_KINDS[body.kind as keyof typeof DOCUMENT_KINDS]}\n• *Doc:* ${doc.id}\n` +
                    "• Aprobar o rechazar con POST /api/admin/events/documents (docs/runbooks/devolucion-directa.md).",
            );
            return jsonResponse({ document: presentDoc(doc), permit_status: permit });
        }

        case "set_massive": {
            const isMassive = body.is_massive === true;
            const { error } = await supabase.from("events").update({ is_massive: isMassive }).eq("id", eventId).eq("organization_id", orgId);
            if (error) {
                console.error("events/documents (set_massive):", error.message);
                return jsonResponse({ message: UNAVAILABLE }, 503);
            }
            const [permit, risk] = await Promise.all([
                recomputePermitStatus(supabase, eventId).catch(() => null),
                refreshEventRisk(supabase, eventId).catch(() => null),
            ]);
            await audit(auth.session, eventId, "set_event_massive", isMassive ? "Marcó el evento como masivo" : "Desmarcó el evento como masivo");
            if (isMassive) await notifySlack(`🏟️ *Evento marcado como masivo*\n• *Evento:* ${auth.event.name} (#${eventId}, org ${orgId})\n• Requiere autorización de la Delegación Presidencial.`);
            return jsonResponse({ is_massive: isMassive, permit_status: permit, risk: risk ? { level: risk.level, reserve_pct: risk.reserve_pct, requires_documents: risk.requires_documents } : null });
        }

        default:
            return jsonResponse({ message: "Acción no válida" }, 400);
    }
};
