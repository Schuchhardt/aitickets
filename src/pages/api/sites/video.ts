// Videos del sitio del productor (portada de fondo, sección Video, Imagen y texto). Mismo flujo y reglas que el video del
// evento (/api/events/video, src/lib/videoStorage.ts): el navegador sube el archivo directo a Supabase Storage con una
// URL firmada (no cabe en las funciones), saca un cuadro como póster y luego confirma.
// GET                                                        → { available, max_bytes, max_seconds, max_videos }
// POST { action: "upload_url", contentType, size, duration? } → { uploadUrl, publicUrl }
// POST { action: "confirm", url }                            → { url, mime, bytes }  (verifica que es un video y su peso)
// El video queda en el borrador del editor; se guarda con PUT /api/sites, que solo acepta videos de la carpeta de la
// productora (site-videos/<organización>/) y borra los que ya no usa ninguna sección.
import type { APIRoute } from "astro";
import { EVENT_VIDEO_TYPES } from "../../../lib/eventVideo";
import { MAX_SITE_VIDEOS, SITE_VIDEO_MAX_BYTES, SITE_VIDEO_MAX_SECONDS } from "../../../lib/siteTemplates";
import { createVideoUploadAt, ownVideoLocationAt, verifyUploadedVideo, VideoStorageError } from "../../../lib/videoStorage";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { json, requireSiteAdmin, siteVideoPrefix } from "../../dashboard/sitio/_lib/site-admin";

export const prerender = false;

const UPLOADS_PER_DAY = 30;
const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

export const GET: APIRoute = async ({ cookies }) => {
  const auth = await requireSiteAdmin({ cookies });
  if (!auth.ok) return auth.response;
  return json({ available: true, max_bytes: SITE_VIDEO_MAX_BYTES, max_seconds: SITE_VIDEO_MAX_SECONDS, max_videos: MAX_SITE_VIDEOS });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const auth = await requireSiteAdmin({ cookies });
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null);
  const prefix = siteVideoPrefix(auth.orgId);

  switch (body?.action) {
    case "upload_url": {
      const contentType = String(body.contentType || "").toLowerCase();
      const size = Number(body.size);
      const duration = Number(body.duration);
      if (!EVENT_VIDEO_TYPES[contentType]) return json({ message: "Formato no soportado: usa MP4 (recomendado), WEBM o MOV." }, 400);
      if (!Number.isFinite(size) || size <= 0) return json({ message: "Archivo de video no válido" }, 400);
      if (size > SITE_VIDEO_MAX_BYTES) {
        return json({ message: `El video supera los ${mb(SITE_VIDEO_MAX_BYTES)}. Recórtalo o comprímelo (1080p y menos de un minuto suele bastar).` }, 400);
      }
      if (Number.isFinite(duration) && duration > SITE_VIDEO_MAX_SECONDS) {
        return json({ message: `El video dura más de ${Math.round(SITE_VIDEO_MAX_SECONDS / 60)} minutos. Sube un fragmento más corto.` }, 400);
      }
      const limit = await rateLimit("dash:sitevideo", `org:${auth.orgId}`, { windowSeconds: 86400, max: UPLOADS_PER_DAY, supabase: getSupabaseAdmin() });
      if (!limit.allowed) return json({ message: "Alcanzaste el máximo de videos subidos por hoy. Vuelve a intentarlo mañana." }, 429);
      try {
        const upload = await createVideoUploadAt(prefix, contentType);
        return json({ uploadUrl: upload.uploadUrl, publicUrl: upload.publicUrl, maxBytes: SITE_VIDEO_MAX_BYTES });
      } catch (err: any) {
        if (err instanceof VideoStorageError) return json({ message: err.message }, err.status);
        console.error("sites/video (upload_url):", err?.message || err);
        return json({ message: "No se pudo preparar la subida del video" }, 500);
      }
    }

    case "confirm": {
      const location = ownVideoLocationAt(body.url, prefix);
      if (!location) return json({ message: "Video no válido" }, 400);
      try {
        const verified = await verifyUploadedVideo(location, { maxBytes: SITE_VIDEO_MAX_BYTES });
        return json({ url: String(body.url), mime: verified.mime, bytes: verified.bytes });
      } catch (err: any) {
        if (err instanceof VideoStorageError) return json({ message: err.message }, err.status);
        console.error("sites/video (confirm):", err?.message || err);
        return json({ message: "No se pudo verificar el video" }, 500);
      }
    }

    default:
      return json({ message: "Acción no válida" }, 400);
  }
};
