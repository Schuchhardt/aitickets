import type { APIRoute } from "astro";
import { getSupabaseAdmin, getFriendlyErrorMessage } from "../../../lib/auth-helpers";
import { getSessionContext, hasRole, ORG_ADMIN_ROLES } from "../../../lib/supabaseServer";
import { countActiveOrgAdmins, isAiticketsAuthUser, json } from "./_team";

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return json({ error: "Unauthorized" }, 401);
    const { dbUser: currentUser } = session;

    if (!hasRole(currentUser, ORG_ADMIN_ROLES)) {
        return json({ error: "Solo los administradores pueden cambiar el estado de miembros" }, 403);
    }

    try {
        const body = await context.request.json();
        const { userId, active } = body || {};

        if (!userId || typeof active !== "boolean") {
            return json({ error: "Datos inválidos" }, 400);
        }

        const supabaseAdmin = getSupabaseAdmin();

        const { data: targetUser } = await supabaseAdmin
            .from("users")
            .select("id, organization_id, auth_user_id, role")
            .eq("id", userId)
            .eq("organization_id", currentUser.organization_id)
            .maybeSingle();

        if (!targetUser) {
            return json({ error: "Usuario no encontrado" }, 404);
        }

        if (targetUser.id === currentUser.id && !active) {
            return json({ error: "No puedes desactivar tu propia cuenta" }, 400);
        }

        if (targetUser.role === "producer" && currentUser.role !== "producer") {
            return json({ error: "No puedes cambiar el estado del dueño de la cuenta" }, 403);
        }

        if (!active && ORG_ADMIN_ROLES.includes(targetUser.role || "")) {
            if ((await countActiveOrgAdmins(currentUser.organization_id, targetUser.id)) < 1) {
                return json({ error: "No puedes desactivar al último administrador activo" }, 400);
            }
        }

        const { error: updateDbError } = await supabaseAdmin
            .from("users")
            .update({ active, updated_at: new Date().toISOString() })
            .eq("id", targetUser.id)
            .eq("organization_id", currentUser.organization_id);

        if (updateDbError) {
            console.error("Database update error:", updateDbError);
            return json({ error: getFriendlyErrorMessage(updateDbError) }, 500);
        }

        // Bloquear / desbloquear el login en Auth solo si la cuenta la creó AI Tickets (Auth es compartido con otras apps).
        // Para las demás basta con users.active: getSessionContext rechaza a los usuarios inactivos.
        if (targetUser.auth_user_id && (await isAiticketsAuthUser(targetUser.auth_user_id))) {
            const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(targetUser.auth_user_id, {
                ban_duration: active ? "none" : "876000h",
            });
            if (authError) console.error("Auth ban/unban error:", authError);
        }

        return json({
            message: active ? "Usuario reactivado exitosamente" : "Usuario desactivado exitosamente",
            active,
        });
    } catch (error) {
        console.error("Toggle status error:", error);
        return json({ error: "Internal Server Error" }, 500);
    }
};
