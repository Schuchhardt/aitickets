import type { APIRoute } from "astro";
import { randomBytes } from "node:crypto";
import { getSupabaseAdmin, getFriendlyErrorMessage } from "../../../lib/auth-helpers";
import { getSessionContext, hasRole, ORG_ADMIN_ROLES } from "../../../lib/supabaseServer";
import { AITICKETS_APP_METADATA, ASSIGNABLE_ROLES, EMAIL_RE, OWNER_ONLY_ROLES, json } from "./_team";

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

        const supabaseAdmin = getSupabaseAdmin();

        const { data: existingUser } = await supabaseAdmin
            .from("users")
            .select("id")
            .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
            .maybeSingle();
        if (existingUser) {
            return json({ error: "Este correo electrónico ya está registrado" }, 400);
        }

        // Contraseña temporal aleatoria
        const tempPassword = randomBytes(9).toString("base64url") + "Aa1!";

        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password: tempPassword,
            email_confirm: true,
            user_metadata: { full_name: name },
            // Cuenta creada por AI Tickets: solo estas se pueden bloquear o cambiar de email desde el dashboard
            app_metadata: { ...AITICKETS_APP_METADATA },
        });

        if (authError) {
            console.error("Auth user creation error:", authError);
            return json({ error: getFriendlyErrorMessage(authError) }, 400);
        }

        const { error: dbError } = await supabaseAdmin.from("users").insert({
            name,
            email,
            role,
            organization_id: currentUser.organization_id,
            auth_user_id: authData.user.id,
            active: true,
        });

        if (dbError) {
            console.error("Database insert error:", dbError);
            await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
            return json({ error: getFriendlyErrorMessage(dbError) }, 500);
        }

        // TODO: enviar invitación por email. Por ahora se devuelve para que el administrador la comparta.
        return json({ message: "Miembro agregado exitosamente", tempPassword });
    } catch (error) {
        console.error("Add team member error:", error);
        return json({ error: "Internal Server Error" }, 500);
    }
};
