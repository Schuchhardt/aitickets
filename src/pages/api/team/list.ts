import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, hasRole, ORG_ADMIN_ROLES } from "../../../lib/supabaseServer";
import { json } from "./_team";

export const GET: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return json({ error: "Unauthorized" }, 401);
    const { dbUser } = session;
    if (!hasRole(dbUser, ORG_ADMIN_ROLES)) {
        return json({ error: "Solo los administradores pueden ver el equipo" }, 403);
    }

    try {
        const { data: teamMembers, error: teamError } = await getSupabaseAdmin()
            .from("users")
            .select("id, name, email, role, created_at, last_access_at, active")
            .eq("organization_id", dbUser.organization_id)
            .order("created_at", { ascending: true });

        if (teamError) {
            console.error("Team fetch error:", teamError);
            return json({ error: "Error al obtener el equipo" }, 500);
        }

        return json({ members: teamMembers || [], currentUserRole: dbUser.role });
    } catch (error) {
        console.error("Team list error:", error);
        return json({ error: "Internal Server Error" }, 500);
    }
};
