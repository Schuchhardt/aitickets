// POST /api/promote/upload-image (multipart: file) → { url }
// Imágenes para posts de redes. Mismas reglas que /api/events/upload-image: JPG/PNG/WEBP/GIF (sin SVG),
// tipo verificado por los bytes, máx. 5 MB, optimizada antes de guardarse (storeImage).
import { getSessionContext, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { storeImage, sniffImageType, ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "../../../lib/marketing";
import type { APIRoute } from "astro";

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
    try {
        const session = await getSessionContext({ cookies });
        if (!session) return jsonResponse({ message: "No autorizado" }, 401);
        if (!hasRole(session.dbUser, EVENT_MANAGER_ROLES)) {
            return jsonResponse({ message: "No tienes permisos para esta acción" }, 403);
        }

        const formData = await request.formData().catch(() => null);
        const file = formData?.get("file");
        if (!file || typeof file === "string") return jsonResponse({ message: "No se proporcionó ningún archivo" }, 400);
        if (file.size > MAX_IMAGE_BYTES) return jsonResponse({ message: "La imagen no debe superar los 5MB" }, 400);

        const buffer = Buffer.from(await file.arrayBuffer());
        const contentType = sniffImageType(buffer);
        if (!contentType || !ALLOWED_IMAGE_TYPES[contentType]) {
            return jsonResponse({ message: "Solo se permiten imágenes JPG, PNG, WEBP o GIF" }, 400);
        }

        const url = await storeImage(session.dbUser.organization_id, buffer, contentType);
        return jsonResponse({ message: "Imagen subida correctamente", url });
    } catch (error) {
        console.error("Upload error:", error);
        return jsonResponse({ message: "Error interno del servidor" }, 500);
    }
};
