// Videos del evento (events.cover_video y events.gallery_video, src/lib/eventVideo.ts) en Supabase Storage.
//
// Los videos pesan demasiado para pasar por las funciones de Netlify (cuerpo máx. ~6 MB): el panel pide una URL
// firmada de un solo uso (createVideoUpload), el navegador sube el archivo directo a Storage y luego confirma
// (/api/events/video, acción set), que verifica con verifyUploadedVideo que el archivo existe, es un
// video y no supera el máximo. Las rutas son event-videos/<organización>/<evento>-<aleatorio>.<ext>: la
// confirmación solo acepta archivos de ese evento y esa organización (ownVideoLocation).
//
// La API de productores (set_event_video) descarga el video desde una URL y lo sube con storeVideoBuffer.
//
// Bucket propio "aitickets-event-videos" (público, máx. 50 MB, solo video; migración 202610240100). Si todavía no
// existe (deploy preview o la migración no pudo crearlo) se usa el bucket de imágenes "Events".
import { getSupabaseAdmin } from "./auth-helpers";
import { IMAGE_BUCKET } from "./imageStorage";
import { EVENT_VIDEO_MAX_BYTES, EVENT_VIDEO_TYPES } from "./eventVideo";

export const VIDEO_BUCKET = "aitickets-event-videos";
export const VIDEO_FOLDER = "event-videos";
const BUCKETS = [VIDEO_BUCKET, IMAGE_BUCKET];

export class VideoStorageError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}

const randomSuffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const isMissingBucket = (error: any) =>
    /bucket not found/i.test(String(error?.message || "")) || String(error?.statusCode || error?.status || "") === "404";

export const videoPathPrefix = (organizationId: number, eventId: number) => `${VIDEO_FOLDER}/${organizationId}/${eventId}-`;

const publicBase = (bucket: string) =>
    getSupabaseAdmin().storage.from(bucket).getPublicUrl("").data.publicUrl.replace(/\/?$/, "/");

/** URL firmada para subir un video del evento (válida 2 h, una sola ruta) y su URL pública. */
export async function createVideoUpload(organizationId: number, eventId: number, contentType: string) {
    const ext = EVENT_VIDEO_TYPES[contentType];
    if (!ext) throw new VideoStorageError(400, "Formato no soportado: usa MP4 (recomendado), WEBM o MOV.");
    const path = `${videoPathPrefix(organizationId, eventId)}${randomSuffix()}.${ext}`;
    const storage = getSupabaseAdmin().storage;
    for (const bucket of BUCKETS) {
        const { data, error } = await storage.from(bucket).createSignedUploadUrl(path);
        if (!error && data?.signedUrl) {
            return { bucket, path, uploadUrl: data.signedUrl, publicUrl: storage.from(bucket).getPublicUrl(path).data.publicUrl };
        }
        if (!isMissingBucket(error)) throw new Error(`createSignedUploadUrl (${bucket}): ${error?.message || "sin URL"}`);
    }
    throw new Error("No hay bucket de Storage para videos");
}

/**
 * Sube un video ya descargado por el servidor (API de productores, set_event_video) a la carpeta del evento.
 * `contentType` debe venir de sniffVideoType (src/lib/videoProbe.ts), nunca del servidor de origen.
 */
export async function storeVideoBuffer(organizationId: number, eventId: number, buffer: Buffer, contentType: string): Promise<{ url: string }> {
    const ext = EVENT_VIDEO_TYPES[contentType];
    if (!ext) throw new VideoStorageError(400, "Formato no soportado: usa MP4 (recomendado), WEBM o MOV.");
    if (buffer.length > EVENT_VIDEO_MAX_BYTES) throw new VideoStorageError(400, "El video supera los 50 MB.");
    const path = `${videoPathPrefix(organizationId, eventId)}${randomSuffix()}.${ext}`;
    const storage = getSupabaseAdmin().storage;
    for (const bucket of BUCKETS) {
        const { error } = await storage.from(bucket).upload(path, buffer, { contentType, cacheControl: "31536000", upsert: false });
        if (!error) return { url: storage.from(bucket).getPublicUrl(path).data.publicUrl };
        if (!isMissingBucket(error)) throw new Error(`upload (${bucket}): ${error.message}`);
    }
    throw new Error("No hay bucket de Storage para videos");
}

/** Bucket y ruta de una URL pública de video de ESTE evento y organización, o null. */
export function ownVideoLocation(url: unknown, organizationId: number, eventId: number): { bucket: string; path: string } | null {
    if (typeof url !== "string" || url.length > 1000 || url.includes("..")) return null;
    const prefix = videoPathPrefix(organizationId, eventId);
    const extensions = new Set(Object.values(EVENT_VIDEO_TYPES));
    for (const bucket of BUCKETS) {
        const base = publicBase(bucket);
        if (!url.startsWith(base)) continue;
        const path = url.slice(base.length);
        const ext = path.split(".").pop() || "";
        if (path.startsWith(prefix) && /^[a-z0-9/_.-]+$/i.test(path) && extensions.has(ext)) return { bucket, path };
    }
    return null;
}

/** Confirma que el archivo subido existe, es un video y no supera el máximo; si no, lo borra. */
export async function verifyUploadedVideo(location: { bucket: string; path: string }): Promise<{ mime: string; bytes: number | null }> {
    const file = getSupabaseAdmin().storage.from(location.bucket);
    const { data, error } = await file.info(location.path);
    if (error || !data) throw new VideoStorageError(400, "No encontramos el video subido. Vuelve a subirlo.");
    const mime = String((data as any).contentType || "").split(";")[0].trim().toLowerCase();
    const bytes = Number((data as any).size) || null;
    if (!EVENT_VIDEO_TYPES[mime] || (bytes !== null && bytes > EVENT_VIDEO_MAX_BYTES)) {
        await file.remove([location.path]).catch(() => {});
        throw new VideoStorageError(400, EVENT_VIDEO_TYPES[mime] ? "El video supera los 50 MB." : "El archivo subido no es un video MP4, WEBM o MOV.");
    }
    return { mime, bytes };
}

/** Borra un video anterior del evento (no se usa en otro lugar). Nunca lanza. */
export async function removeStoredVideo(url: unknown, organizationId: number, eventId: number): Promise<void> {
    const location = ownVideoLocation(url, organizationId, eventId);
    if (!location) return;
    try {
        const { error } = await getSupabaseAdmin().storage.from(location.bucket).remove([location.path]);
        if (error) console.error("removeStoredVideo:", error.message);
    } catch (err: any) {
        console.error("removeStoredVideo:", err?.message || err);
    }
}
