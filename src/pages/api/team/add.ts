// POST /api/team/add { name, email, role } — suma un miembro al equipo desde el panel (Mi equipo).
// La lógica (fila del trigger handle_new_user, huérfanos, reversión) está en src/lib/team-add.ts.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, hasRole, ORG_ADMIN_ROLES } from "../../../lib/supabaseServer";
import { addTeamMember } from "../../../lib/team-add";
import { ASSIGNABLE_ROLES, EMAIL_RE, OWNER_ONLY_ROLES, json } from "./_team";

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return json({ error: "Unauthorized" }, 401);
    const { dbUser: currentUser } = session;

    // Productores (dueños) y administradores pueden sumar miembros
    if (!hasRole(currentUser, ORG_ADMIN_ROLES)) {
        return json({ error: "Solo los administradores pueden agregar miembros" }, 403);
    }

    try {
        const body = await context.request.json();
        const name = String(body?.name || "").trim().slice(0, 150);
        const email = String(body?.email || "").trim().toLowerCase().slice(0, 200);
        const role = String(body?.role || "");

        if (!name || !email || !role) {
            return json({ error: "Todos los campos son requeridos" }, 400);
        }
        if (!EMAIL_RE.test(email)) {
            return json({ error: "Email inválido" }, 400);
        }
        if (!ASSIGNABLE_ROLES.includes(role)) {
            return json({ error: "Rol no válido" }, 400);
        }
        if (OWNER_ONLY_ROLES.includes(role) && currentUser.role !== "producer") {
            return json({ error: "Solo el dueño de la cuenta puede agregar miembros de finanzas" }, 403);
        }

        const result = await addTeamMember(getSupabaseAdmin(), Number(currentUser.organization_id), { name, email, role });
        if (!result.ok) return json({ error: result.message, code: result.code }, result.status);
        // La contraseña temporal (null si ya tenía una cuenta en uso) se muestra una vez para que el administrador la comparta
        return json({ message: result.message, tempPassword: result.tempPassword, adopted: result.adopted, userId: result.userId });
    } catch (error) {
        console.error("Add team member error:", error);
        return json({ error: "Internal Server Error" }, 500);
    }
};
