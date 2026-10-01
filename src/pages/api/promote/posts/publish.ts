import type { APIRoute } from "astro";
import { getSessionContext, hasRole, EVENT_MANAGER_ROLES } from "../../../../lib/supabaseServer";
import { publishSocialPost } from "../../../../lib/marketing";

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401 });
    }
    if (!hasRole(session.dbUser, EVENT_MANAGER_ROLES)) {
        return new Response(JSON.stringify({ message: "No tienes permisos para esta acción" }), { status: 403, headers: { "Content-Type": "application/json" } });
    }

    try {
        const body = await context.request.json();
        const { postId } = body;

        if (!postId) {
            return new Response(JSON.stringify({ message: "ID de post requerido" }), { status: 400 });
        }

        const dbUser = session.dbUser;
        if (!dbUser?.organization_id) {
            return new Response(JSON.stringify({ message: "Organización no encontrada" }), { status: 404 });
        }

        const result = await publishSocialPost(dbUser.organization_id, postId);
        if (!result.ok) {
            return new Response(JSON.stringify({ message: result.message }), { status: result.httpStatus });
        }

        return new Response(JSON.stringify({
            message: result.status === "scheduled" ? "Post programado exitosamente" : "Post publicado exitosamente",
            zernio_post_id: result.zernioPostId,
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("Publish error:", error);
        return new Response(JSON.stringify({ message: "Error interno del servidor" }), { status: 500 });
    }
};
