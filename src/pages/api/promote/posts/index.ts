import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../../lib/auth-helpers";
import { getSessionUser } from "../../../../lib/supabaseServer";

export const GET: APIRoute = async (context) => {
    const user = await getSessionUser(context);
    if (!user) {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401 });
    }

    try {
        const supabaseAdmin = getSupabaseAdmin();

        const { data: dbUser } = await supabaseAdmin
            .from("users")
            .select("organization_id")
            .eq("auth_user_id", user.id)
            .single();

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
