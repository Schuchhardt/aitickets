// POST /api/events/upload-image (multipart: file, kind?) → { url, thumb_url, width, height }
// Portadas (kind=cover, por defecto) e imágenes de galería (kind=gallery, con miniatura WebP).
// JPG/PNG/WEBP/GIF (sin SVG, que puede contener scripts), tipo verificado por los bytes, máx. 5 MB.
// Toda imagen se optimiza antes de guardarse (src/lib/imageOptimize.ts): orientación, sin metadatos,
// lado mayor acotado y recomprimida.
import { getSessionContext, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { sniffImageType, IMAGE_EXT } from "../../../lib/imageOptimize";
import { storeOptimizedImage } from "../../../lib/imageStorage";
import type { APIRoute } from "astro";

export const prerender = false;

const MAX_BYTES = 5 * 1024 * 1024;
const KINDS = {
    cover: { folder: "event-covers", maxSize: 2000, thumbnail: false },
    gallery: { folder: "event-gallery", maxSize: 2000, thumbnail: true },
} as const;

export const POST: APIRoute = async ({ request, cookies }) => {
    try {
        const session = await getSessionContext({ cookies });
        if (!session) return jsonResponse({ message: "No autorizado" }, 401);
        if (!hasRole(session.dbUser, EVENT_MANAGER_ROLES)) {
            return jsonResponse({ message: "No tienes permisos para subir imágenes" }, 403);
        }

        const formData = await request.formData().catch(() => null);
        const file = formData?.get("file");
        if (!file || typeof file === "string") return jsonResponse({ message: "No se proporcionó ningún archivo" }, 400);
        if (file.size > MAX_BYTES) return jsonResponse({ message: "La imagen no debe superar los 5MB" }, 400);

        const buffer = Buffer.from(await file.arrayBuffer());
        const contentType = sniffImageType(buffer);
        if (!contentType || !IMAGE_EXT[contentType]) {
            return jsonResponse({ message: "Solo se permiten imágenes JPG, PNG, WEBP o GIF" }, 400);
        }

        const kindRaw = String(formData?.get("kind") || "cover");
        const kind = kindRaw === "gallery" ? KINDS.gallery : KINDS.cover;
        const stored = await storeOptimizedImage(buffer, contentType, {
            pathPrefix: `${kind.folder}/${session.dbUser.organization_id}`,
            maxSize: kind.maxSize,
            thumbnail: kind.thumbnail,
        });

        return jsonResponse({
            message: "Imagen subida correctamente",
            url: stored.url,
            thumb_url: stored.thumb_url,
            width: stored.width,
            height: stored.height,
        });
    } catch (error) {
        console.error("Upload error:", error);
        return jsonResponse({ message: "Error al subir la imagen" }, 500);
    }
};
