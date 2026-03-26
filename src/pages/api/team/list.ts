import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionUser, createSupabaseServerClient } from "../../../lib/supabaseServer";

export const GET: APIRoute = async (context) => {
    const user = await getSessionUser(context);

    if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    try {
        const supabase = createSupabaseServerClient(context);

        // Get current user's organization_id
        const { data: currentUser, error: userError } = await supabase
            .from("users")
            .select("organization_id, role")
            .eq("auth_user_id", user.id)
            .single();

        if (userError || !currentUser) {
            return new Response(JSON.stringify({ error: "Usuario no encontrado" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
            });
        }

        if (!currentUser.organization_id) {
            return new Response(JSON.stringify({ error: "Usuario sin organización" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Fetch all team members from the organization
        const { data: teamMembers, error: teamError } = await supabase
            .from("users")
            .select("id, name, email, role, created_at, last_access_at, active")
            .eq("organization_id", currentUser.organization_id)
            .order("created_at", { ascending: true });

        if (teamError) {
            console.error("Team fetch error:", teamError);
            return new Response(JSON.stringify({ error: "Error al obtener el equipo" }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }

        return new Response(JSON.stringify({
            members: teamMembers || [],
            currentUserRole: currentUser.role
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });

    } catch (error) {
        console.error("Team list error:", error);
        return new Response(JSON.stringify({ error: "Internal Server Error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
};
