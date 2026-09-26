import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../../lib/auth-helpers";
import { getSessionContext, hasRole, EVENT_MANAGER_ROLES } from "../../../../lib/supabaseServer";

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401 });
    }
    if (!hasRole(session.dbUser, EVENT_MANAGER_ROLES)) {
        return new Response(JSON.stringify({ message: "No tienes permisos para esta acción" }), { status: 403, headers: { "Content-Type": "application/json" } });
    }
    const user = session.authUser;

    try {
        const body = await context.request.json();
        const { eventId, content, imageUrls, platforms, scheduledFor } = body;

        if (!eventId || !content || !platforms?.length) {
            return new Response(JSON.stringify({ message: "Faltan datos requeridos (evento, contenido, plataformas)" }), { status: 400 });
        }

        const supabaseAdmin = getSupabaseAdmin();

        // Verify user's organization
        const dbUser = session.dbUser;

        if (!dbUser?.organization_id) {
            return new Response(JSON.stringify({ message: "Organización no encontrada" }), { status: 404 });
        }

        // Verify event belongs to organization
        const { data: event } = await supabaseAdmin
            .from("events")
            .select("id")
            .eq("id", eventId)
            .eq("organization_id", dbUser.organization_id)
            .single();

        if (!event) {
            return new Response(JSON.stringify({ message: "Evento no encontrado" }), { status: 404 });
        }

        const status = scheduledFor ? "scheduled" : "draft";

        const { data: post, error } = await supabaseAdmin
            .from("social_posts")
            .insert({
                organization_id: dbUser.organization_id,
                event_id: eventId,
                content,
                image_urls: imageUrls || [],
                platforms,
                status,
                scheduled_for: scheduledFor || null,
            })
            .select()
            .single();

        if (error) {
            console.error("Create post error:", error);
            return new Response(JSON.stringify({ message: "Error al crear el post" }), { status: 500 });
        }

        return new Response(JSON.stringify({ message: "Post creado exitosamente", id: post.id }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("Create post error:", error);
        return new Response(JSON.stringify({ message: "Error interno del servidor" }), { status: 500 });
    }
};
