import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, hasRole, EVENT_MANAGER_ROLES } from "../../../lib/supabaseServer";
import type { APIRoute } from "astro";

export const POST: APIRoute = async ({ request, cookies }) => {
    try {
        // Verificar autenticación
        const session = await getSessionContext({ cookies });
        if (!session) {
            return new Response(JSON.stringify({ message: "No autorizado" }), { 
                status: 401,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (!hasRole(session.dbUser, EVENT_MANAGER_ROLES)) {
            return new Response(JSON.stringify({ message: "No tienes permisos para subir imágenes" }), { status: 403, headers: { "Content-Type": "application/json" } });
        }

        // Obtener el archivo del FormData
        const formData = await request.formData();
        const file = formData.get("file") as File | null;

        if (!file) {
            return new Response(JSON.stringify({ message: "No se proporcionó ningún archivo" }), { 
                status: 400,
                headers: { "Content-Type": "application/json" }
            });
        }

        // Validar tipo de archivo
        // Solo formatos raster (sin SVG, que puede contener scripts)
        const ALLOWED_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
        if (!ALLOWED_TYPES[file.type]) {
            return new Response(JSON.stringify({ message: "Solo se permiten imágenes JPG, PNG, WEBP o GIF" }), { 
                status: 400,
                headers: { "Content-Type": "application/json" }
            });
        }

        // Validar tamaño (5MB máximo)
        if (file.size > 5 * 1024 * 1024) {
            return new Response(JSON.stringify({ message: "La imagen no debe superar los 5MB" }), { 
                status: 400,
                headers: { "Content-Type": "application/json" }
            });
        }

        const supabase = getSupabaseAdmin();

        // Generar nombre único para el archivo
        const fileExt = ALLOWED_TYPES[file.type];
        const fileName = `event-covers/${session.dbUser.organization_id}-${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

        // Convertir File a Buffer para Supabase
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Subir archivo
        const { data, error } = await supabase.storage
            .from("events")
            .upload(fileName, buffer, {
                contentType: file.type,
                upsert: false
            });

        if (error) {
            console.error("Upload error:", error);
            return new Response(JSON.stringify({ message: "Error al subir la imagen" }), { 
                status: 500,
                headers: { "Content-Type": "application/json" }
            });
        }

        // Obtener URL pública
        const { data: { publicUrl } } = supabase.storage
            .from("events")
            .getPublicUrl(fileName);

        return new Response(JSON.stringify({ 
            message: "Imagen subida correctamente",
            url: publicUrl 
        }), { 
            status: 200,
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        console.error("Upload error:", error);
        return new Response(JSON.stringify({ message: "Error interno del servidor" }), { 
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
};
