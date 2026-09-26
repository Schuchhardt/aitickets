import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../../lib/auth-helpers";
import { getSessionContext, hasRole, EVENT_MANAGER_ROLES } from "../../../../lib/supabaseServer";

export const GET: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401 });
    }
    if (!hasRole(session.dbUser, EVENT_MANAGER_ROLES)) {
        return new Response(JSON.stringify({ message: "No tienes permisos para esta acción" }), { status: 403, headers: { "Content-Type": "application/json" } });
    }
    const user = session.authUser;

    try {
        const supabaseAdmin = getSupabaseAdmin();

        const dbUser = session.dbUser;

        if (!dbUser?.organization_id) {
            return new Response(JSON.stringify({ message: "Organización no encontrada" }), { status: 404 });
        }

        const status = context.url.searchParams.get("status");

        let query = supabaseAdmin
            .from("social_posts")
            .select("*, events(id, name, title, image_url)")
            .eq("organization_id", dbUser.organization_id)
            .order("created_at", { ascending: false });

        if (status && status !== "all") {
            query = query.eq("status", status);
        }

        const { data: posts, error } = await query;

        if (error) {
            console.error("Fetch posts error:", error);
            return new Response(JSON.stringify({ message: "Error al obtener posts" }), { status: 500 });
        }

        return new Response(JSON.stringify({ posts: posts || [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("List posts error:", error);
        return new Response(JSON.stringify({ message: "Error interno del servidor" }), { status: 500 });
    }
};
