import type { APIRoute } from "astro";
import { getSupabaseAdmin, getFriendlyErrorMessage } from "../../../lib/auth-helpers";
import { getSessionContext, hasRole, ORG_ADMIN_ROLES } from "../../../lib/supabaseServer";
import { ASSIGNABLE_ROLES, EMAIL_RE, OWNER_ONLY_ROLES, countActiveOrgAdmins, isAiticketsAuthUser, json } from "./_team";

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return json({ error: "Unauthorized" }, 401);
    const { dbUser: currentUser } = session;

    if (!hasRole(currentUser, ORG_ADMIN_ROLES)) {
        return json({ error: "Solo los administradores pueden editar miembros" }, 403);
    }

    try {
        const body = await context.request.json();
        const userId = body?.userId;
        const name = String(body?.name || "").trim().slice(0, 150);
        const email = String(body?.email || "").trim().toLowerCase().slice(0, 200);
        let role = String(body?.role || "");

        if (!userId || !name || !email || !role) {
            return json({ error: "Todos los campos son requeridos" }, 400);
        }
        if (!EMAIL_RE.test(email)) {
            return json({ error: "Email inválido" }, 400);
        }

        const supabaseAdmin = getSupabaseAdmin();

        // El usuario a editar debe ser de la misma organización
        const { data: targetUser } = await supabaseAdmin
            .from("users")
            .select("id, organization_id, auth_user_id, email, role, active")
            .eq("id", userId)
            .eq("organization_id", currentUser.organization_id)
            .maybeSingle();

        if (!targetUser) {
            return json({ error: "Usuario a editar no encontrado" }, 404);
        }

        // El dueño de la cuenta (producer) solo puede ser editado por un producer y conserva su rol
        if (targetUser.role === "producer") {
            if (currentUser.role !== "producer") {
                return json({ error: "No puedes editar al dueño de la cuenta" }, 403);
            }
            if (role !== "producer" && !ASSIGNABLE_ROLES.includes(role)) {
                return json({ error: "Rol no válido" }, 400);
            }
        } else if (!ASSIGNABLE_ROLES.includes(role)) {
            return json({ error: "Rol no válido" }, 400);
        }
        if ((OWNER_ONLY_ROLES.includes(role) || OWNER_ONLY_ROLES.includes(targetUser.role || "")) && role !== targetUser.role && currentUser.role !== "producer") {
            return json({ error: "Solo el dueño de la cuenta puede dar o quitar el rol de finanzas" }, 403);
        }
        // Si el formulario no ofrece 'producer', mantenerlo cuando el producer se edita a sí mismo como admin
        if (targetUser.role === "producer" && role === "admin" && targetUser.id === currentUser.id) {
            role = "producer";
        }

        // No dejar a la organización sin administradores activos
        const wasOrgAdmin = ORG_ADMIN_ROLES.includes(targetUser.role || "");
        const willBeOrgAdmin = ORG_ADMIN_ROLES.includes(role);
        if (wasOrgAdmin && !willBeOrgAdmin) {
            if (targetUser.id === currentUser.id) {
                return json({ error: "No puedes quitarte tu propio rol de administrador" }, 400);
            }
            if ((await countActiveOrgAdmins(currentUser.organization_id, targetUser.id)) < 1) {
                return json({ error: "La organización debe tener al menos un administrador activo" }, 400);
            }
        }

        const emailChanged = email !== (targetUser.email || "").toLowerCase();
        if (emailChanged) {
            const { data: existingUser } = await supabaseAdmin
                .from("users")
                .select("id")
                .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
                .neq("id", targetUser.id)
                .maybeSingle();
            if (existingUser) {
                return json({ error: "Este correo electrónico ya está en uso" }, 400);
            }
        }

        // La cuenta de Auth es compartida con otras apps: solo se modifica si la creó AI Tickets
        const ownsAuthUser = targetUser.auth_user_id ? await isAiticketsAuthUser(targetUser.auth_user_id) : false;
        if (emailChanged && !ownsAuthUser) {
            return json({
                error: "No es posible cambiar el email de este miembro porque su cuenta se usa también en otros servicios. Pídele que lo cambie él mismo o agrégalo nuevamente con el email correcto.",
            }, 400);
        }

        // Actualizar primero auth (el email puede fallar si ya existe en Auth)
        if (targetUser.auth_user_id && ownsAuthUser) {
            const authUpdatePayload: Record<string, unknown> = { user_metadata: { full_name: name } };
            if (emailChanged) authUpdatePayload.email = email;
            const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(targetUser.auth_user_id, authUpdatePayload);
            if (authError) {
                console.error("Auth update error:", authError);
                if (emailChanged) return json({ error: getFriendlyErrorMessage(authError) }, 400);
            }
        }

        const { error: updateDbError } = await supabaseAdmin
            .from("users")
            .update({ name, email, role, updated_at: new Date().toISOString() })
            .eq("id", targetUser.id)
            .eq("organization_id", currentUser.organization_id);

        if (updateDbError) {
            console.error("Database update error:", updateDbError);
            return json({ error: getFriendlyErrorMessage(updateDbError) }, 500);
        }

        return json({ message: "Usuario actualizado exitosamente" });
    } catch (error) {
        console.error("Update team member error:", error);
        return json({ error: "Internal Server Error" }, 500);
    }
};
