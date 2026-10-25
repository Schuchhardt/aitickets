// Documentos del evento que sube el productor (Términos para productores §2 ter): autorización de la Delegación
// Presidencial (eventos masivos, Ley 21.659), contrato o permiso del lugar y póliza de responsabilidad civil.
//
// Archivos en el bucket PRIVADO "aitickets-event-documents" (migración 202610260200), rutas
// <organización>/<evento>/<aleatorio>-<nombre>. El panel pide una URL firmada de subida (createDocumentUpload), el
// navegador sube directo a Storage y luego confirma (/api/events/documents, acción confirm), que verifica que el
// archivo existe en la carpeta del evento. AI Tickets los revisa (/api/admin/events/documents) y el estado de la
// autorización (events.permit_status) se recalcula con recomputePermitStatus.
import { randomBytes } from "node:crypto";

export const DOCUMENTS_BUCKET = "aitickets-event-documents";
export const DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;
export const DOCUMENT_TYPES: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
};

export const DOCUMENT_KINDS = {
    delegacion_presidencial: "Autorización de la Delegación Presidencial Regional",
    venue_permit: "Contrato o permiso del lugar",
    rc_insurance: "Póliza de responsabilidad civil",
    other: "Otro documento",
} as const;
export type DocumentKind = keyof typeof DOCUMENT_KINDS;
export const isDocumentKind = (v: unknown): v is DocumentKind => typeof v === "string" && v in DOCUMENT_KINDS;

export const DOCUMENT_STATUS_LABELS = { pending: "En revisión", approved: "Aprobado", rejected: "Rechazado" } as const;
export const PERMIT_STATUS_LABELS = { none: "Sin documentos", pending: "Autorización en trámite", approved: "Autorización aprobada", rejected: "Autorización rechazada" } as const;
export type PermitStatus = keyof typeof PERMIT_STATUS_LABELS;

const MISSING = ["42P01", "PGRST205", "42703", "PGRST204"];
const isMissing = (err: any) => MISSING.includes(String(err?.code || ""));

/** Documentos que se piden al evento: todos si es masivo o exige documentos; si no, ninguno obligatorio. */
export function requiredDocumentKinds(event: { is_massive?: boolean | null; requires_documents?: boolean | null }): DocumentKind[] {
    if (event?.is_massive) return ["delegacion_presidencial", "venue_permit", "rc_insurance"];
    if (event?.requires_documents) return ["venue_permit", "rc_insurance"];
    return [];
}

/** Documento vigente por tipo: el más reciente. */
export function latestByKind(docs: any[]): Map<string, any> {
    const out = new Map<string, any>();
    for (const d of [...(docs || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))) {
        if (!out.has(d.kind)) out.set(d.kind, d);
    }
    return out;
}

/**
 * Estado de la autorización que muestra la página pública:
 *  - masivo: depende de la autorización de la Delegación Presidencial (sin ella o en revisión: "pending");
 *  - no masivo: depende del permiso del lugar o de una autorización, si se subió alguno (si no, "none").
 */
export function permitStatusFor(event: { is_massive?: boolean | null }, docs: any[]): PermitStatus {
    const latest = latestByKind(docs);
    const kinds: DocumentKind[] = event?.is_massive ? ["delegacion_presidencial"] : ["delegacion_presidencial", "venue_permit"];
    const relevant = kinds.map((k) => latest.get(k)).filter(Boolean);
    if (!relevant.length) return event?.is_massive ? "pending" : "none";
    if (relevant.some((d) => d.status === "approved")) return "approved";
    if (relevant.some((d) => d.status === "pending")) return "pending";
    return "rejected";
}

/** Tipos obligatorios sin un documento vigente pendiente o aprobado. */
export function missingDocumentKinds(event: { is_massive?: boolean | null; requires_documents?: boolean | null }, docs: any[]): DocumentKind[] {
    const latest = latestByKind(docs);
    return requiredDocumentKinds(event).filter((k) => {
        const d = latest.get(k);
        return !d || d.status === "rejected";
    });
}

export async function loadEventDocuments(supabase: any, eventId: number): Promise<{ available: boolean; documents: any[] }> {
    const { data, error } = await supabase
        .from("aitickets_event_documents")
        .select("id, event_id, organization_id, kind, status, file_name, mime_type, size_bytes, storage_path, notes, reviewed_at, created_at")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false })
        .limit(100);
    if (error) {
        if (isMissing(error)) return { available: false, documents: [] };
        throw error;
    }
    return { available: true, documents: data || [] };
}

/** Recalcula y guarda events.permit_status. Devuelve el estado o null si la migración no está aplicada. */
export async function recomputePermitStatus(supabase: any, eventId: number): Promise<PermitStatus | null> {
    const { data: event, error } = await supabase.from("events").select("id, is_massive").eq("id", eventId).maybeSingle();
    if (error) {
        if (isMissing(error)) return null;
        throw error;
    }
    if (!event) return null;
    const { available, documents } = await loadEventDocuments(supabase, eventId);
    if (!available) return null;
    const status = permitStatusFor(event, documents);
    const { error: upError } = await supabase.from("events").update({ permit_status: status }).eq("id", eventId);
    if (upError && !isMissing(upError)) throw upError;
    return status;
}

const safeFileName = (name: string) =>
    String(name || "documento")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(-80) || "documento";

export const documentFolder = (organizationId: number, eventId: number) => `${organizationId}/${eventId}/`;

/** URL firmada para subir un documento del evento (una sola ruta, dentro de la carpeta del evento). */
export async function createDocumentUpload(supabase: any, organizationId: number, eventId: number, contentType: string, fileName: string) {
    const ext = DOCUMENT_TYPES[contentType];
    if (!ext) throw new Error("Formato no soportado: usa PDF, JPG, PNG o WEBP.");
    const base = safeFileName(fileName).replace(/\.[a-z0-9]+$/i, "");
    const path = `${documentFolder(organizationId, eventId)}${Date.now()}-${randomBytes(4).toString("hex")}-${base}.${ext}`;
    const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(path);
    if (error || !data?.signedUrl) throw new Error(`createSignedUploadUrl: ${error?.message || "sin URL"}`);
    return { path, uploadUrl: data.signedUrl as string };
}

/** Verifica que el archivo subido existe en la carpeta del evento; devuelve su tamaño y tipo. */
export async function verifyUploadedDocument(supabase: any, organizationId: number, eventId: number, path: string) {
    const folder = documentFolder(organizationId, eventId);
    if (!path.startsWith(folder) || path.includes("..") || path.slice(folder.length).includes("/")) return null;
    const name = path.slice(folder.length);
    const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).list(folder.replace(/\/$/, ""), { search: name, limit: 5 });
    if (error) throw new Error(`storage list: ${error.message}`);
    const file = (data || []).find((f: any) => f.name === name);
    if (!file) return null;
    const size = Number(file.metadata?.size) || null;
    const mime = String(file.metadata?.mimetype || "");
    if (size != null && size > DOCUMENT_MAX_BYTES) return null;
    return { size, mime: mime || null };
}

/** URL firmada de descarga (5 min) para el productor o AI Tickets. */
export async function documentDownloadUrl(supabase: any, path: string): Promise<string | null> {
    const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, 300);
    if (error) return null;
    return data?.signedUrl || null;
}
