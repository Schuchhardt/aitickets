import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../../lib/auth-helpers";
import { getSessionUser } from "../../../../lib/supabaseServer";

export const POST: APIRoute = async (context) => {
    const user = await getSessionUser(context);
    if (!user) {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401 });
    }

    try {
        const body = await context.request.json();
        const { eventId, content, imageUrls, platforms, scheduledFor } = body;

        if (!eventId || !content || !platforms?.length) {
            return new Response(JSON.stringify({ message: "Faltan datos requeridos (evento, contenido, plataformas)" }), { status: 400 });
        }

        const supabaseAdmin = getSupabaseAdmin();

        // Verify user's organization
        const { data: dbUser } = await supabaseAdmin
            .from("users")
            .select("organization_id")
            .eq("auth_user_id", user.id)
            .single();

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
