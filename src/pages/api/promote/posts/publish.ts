// POST /api/promote/posts/publish { postId } — publica (o programa) una publicación desde el panel (Promocionar).
// Aplica las mismas reglas que publish_social_post (checkPublishable en src/lib/producer-api/tools/marketing.ts): el
// evento debe ser de la organización y estar dentro del acceso del miembro (un miembro limitado a ciertos eventos no
// publica los de otros), publicado y no cancelado, con cuentas conectadas y texto e imágenes que cada red acepte.
import type { APIRoute } from "astro";
import { EVENT_MANAGER_ROLES } from "../../../../lib/supabaseServer";
import { publishSocialPost } from "../../../../lib/marketing";
import { dashboardToolContext } from "../../../../lib/producer-api/session";
import { HTTP_STATUS, ToolError } from "../../../../lib/producer-api/registry";
import { checkPublishable } from "../../../../lib/producer-api/tools/marketing";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const POST: APIRoute = async (context) => {
    const auth = await dashboardToolContext(context);
    if (!auth.ok) {
        return auth.status === 401 ? json({ error: "No autorizado" }, 401) : json({ message: "No tienes permisos para esta acción" }, 403);
    }
    const { ctx } = auth;
    if (!EVENT_MANAGER_ROLES.includes(ctx.actor.role)) {
        return json({ message: "No tienes permisos para esta acción" }, 403);
    }

    let postId: unknown;
    try {
        postId = (await context.request.json())?.postId;
    } catch {
        return json({ message: "Solicitud inválida" }, 400);
    }
    if (!postId) return json({ message: "ID de publicación requerido" }, 400);

    try {
        const { data: post } = await ctx.supabase
            .from("social_posts")
            .select("id, event_id, platforms, content, image_urls, status")
            .eq("id", postId)
            .eq("organization_id", ctx.actor.orgId)
            .maybeSingle();
        if (!post) return json({ message: "Publicación no encontrada" }, 404);
        try {
            await checkPublishable(ctx, post);
        } catch (err) {
            if (err instanceof ToolError) return json({ message: err.message }, HTTP_STATUS[err.code]);
            throw err;
        }

        const result = await publishSocialPost(ctx.actor.orgId, post.id);
        if (!result.ok) return json({ message: result.message }, result.httpStatus);
        return json({
            message: result.status === "scheduled" ? "Publicación programada" : "Publicación hecha",
            zernio_post_id: result.zernioPostId,
        });
    } catch (error) {
        console.error("Publish error:", error);
        return json({ message: "Error interno del servidor" }, 500);
    }
};
