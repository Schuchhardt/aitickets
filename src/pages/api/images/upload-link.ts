// POST /api/images/upload-link (multipart: t, file) → { url, use, event_id, warnings? }
// Subida de una imagen SIN sesión, autorizada por el link firmado que crea create_image_upload_link (MCP de
// productores y org_create_image_upload_link del MCP Admin). El token dice la organización, el evento y qué se hace
// con la imagen (netlify/lib/image-upload-token.mjs): portada, foto para celular de la portada ancha, o solo alojarla.
// JPG/PNG/WEBP/GIF con el tipo verificado por los bytes, máx. 5 MB, optimizada antes de guardarse. Máx. 20 subidas por
// hora por organización. Al aplicarla a un evento se vacía la caché de las páginas de eventos.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { jsonResponse } from "../../../lib/supabaseServer";
import { purgeEventPages } from "../../../lib/cdnCache";
import { applyEventImage, assertCanUseEventImage, EventImageUseError } from "../../../lib/eventImageUse";
import { MAX_IMAGE_BYTES, sniffImageType, storeImage } from "../../../lib/marketing";
import { IMAGE_EXT } from "../../../lib/imageOptimize";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";
import { verifyImageUploadToken } from "../../../../netlify/lib/image-upload-token.mjs";

export const prerender = false;

const UPLOADS_PER_HOUR = 20;
const noStore = { "Cache-Control": "no-store" };
const reply = (body: Record<string, unknown>, status = 200) => {
    const res = jsonResponse(body, status);
    for (const [k, v] of Object.entries(noStore)) res.headers.set(k, v);
    return res;
};

export const POST: APIRoute = async ({ request }) => {
    try {
        const formData = await request.formData().catch(() => null);
        const token = formData?.get("t");
        const link = typeof token === "string" ? verifyImageUploadToken(token) : null;
        if (!link) return reply({ message: "El link venció o no es válido. Pide uno nuevo." }, 401);

        const file = formData?.get("file");
        if (!file || typeof file === "string") return reply({ message: "No se proporcionó ningún archivo" }, 400);
        if (file.size > MAX_IMAGE_BYTES) return reply({ message: "La imagen no debe superar los 5MB" }, 400);
        const buffer = Buffer.from(await file.arrayBuffer());
        const contentType = sniffImageType(buffer);
        if (!contentType || !IMAGE_EXT[contentType]) return reply({ message: "Solo se permiten imágenes JPG, PNG, WEBP o GIF" }, 400);

        const supabase = getSupabaseAdmin();
        // El evento puede haber cambiado desde que se creó el link (borrado, sin portada): se revisa antes de guardar nada
        if (link.use !== "library") await assertCanUseEventImage(supabase, link.orgId, link.eventId!, link.use);

        const limit = await rateLimit("img:uplink", `org:${link.orgId}`, { windowSeconds: 3600, max: UPLOADS_PER_HOUR, supabase });
        if (!limit.allowed) return reply({ message: "Se subieron muchas imágenes con este link. Intenta de nuevo en una hora." }, 429);

        const url = await storeImage(link.orgId, buffer, contentType, "link");
        let warnings: string[] = [];
        if (link.use !== "library") {
            ({ warnings } = await applyEventImage(supabase, link.orgId, link.eventId!, link.use, url));
            await purgeEventPages();
        }
        return reply({ message: "Imagen subida correctamente", url, use: link.use, event_id: link.eventId, ...(warnings.length ? { warnings } : {}) });
    } catch (error: any) {
        if (error instanceof EventImageUseError) {
            return reply({ message: error.message }, error.kind === "not_found" ? 404 : error.kind === "unavailable" ? 503 : 400);
        }
        console.error("image upload link:", error?.message || error);
        return reply({ message: "Error al subir la imagen" }, 500);
    }
};
