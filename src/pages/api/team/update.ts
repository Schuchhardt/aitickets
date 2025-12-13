import type { APIRoute } from "astro";
import { getSupabaseAdmin, getFriendlyErrorMessage } from "../../../lib/auth-helpers";
import { getSessionUser, createSupabaseServerClient } from "../../../lib/supabaseServer";

export const POST: APIRoute = async (context) => {
    const user = await getSessionUser(context);

    if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    try {
        const body = await context.request.json();
        const { userId, name, email, role } = body;

        // Validate required fields
        if (!userId || !name || !email || !role) {
            return new Response(JSON.stringify({ error: "Todos los campos son requeridos" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Validate role
        const validRoles = ["admin", "editor", "validator"];
        if (!validRoles.includes(role)) {
            return new Response(JSON.stringify({ error: "Rol no válido" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        const supabase = createSupabaseServerClient(context);
        const supabaseAdmin = getSupabaseAdmin();

        // Get current user's organization_id and verify admin role
        const { data: currentUser, error: userError } = await supabase
            .from("users")
            .select("organization_id, role, id")
            .eq("auth_user_id", user.id)
            .single();

        if (userError || !currentUser) {
            return new Response(JSON.stringify({ error: "Usuario no encontrado" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Check if current user is admin
        if (currentUser.role !== "admin") {
            return new Response(JSON.stringify({ error: "Solo los administradores pueden editar miembros" }), {
                status: 403,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Get the target user to verify they belong to same organization
        const { data: targetUser, error: targetError } = await supabaseAdmin
            .from("users")
            .select("id, organization_id, auth_user_id, email")
            .eq("id", userId)
            .single();

        if (targetError || !targetUser) {
            return new Response(JSON.stringify({ error: "Usuario a editar no encontrado" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Verify target user belongs to same organization
        if (targetUser.organization_id !== currentUser.organization_id) {
            return new Response(JSON.stringify({ error: "No tienes permiso para editar este usuario" }), {
                status: 403,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Prevent admin from removing their own admin role (to avoid lockout)
        if (targetUser.id === currentUser.id && role !== "admin") {
            return new Response(JSON.stringify({ error: "No puedes remover tu propio rol de administrador" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Check if new email already exists (if email is being changed)
        if (email !== targetUser.email) {
            const { data: existingUser } = await supabaseAdmin
                .from("users")
                .select("id")
                .eq("email", email)
                .neq("id", userId)
                .single();

            if (existingUser) {
                return new Response(JSON.stringify({ error: "Este correo electrónico ya está en uso" }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                });
            }
        }

        // Update the user in public.users table
        const { error: updateDbError } = await supabaseAdmin
            .from("users")
            .update({
                name: name,
                email: email,
                role: role,
                updated_at: new Date().toISOString()
            })
            .eq("id", userId);

        if (updateDbError) {
            console.error("Database update error:", updateDbError);
            return new Response(JSON.stringify({ error: getFriendlyErrorMessage(updateDbError) }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Update auth user if they have an auth_user_id
        if (targetUser.auth_user_id) {
            const authUpdatePayload: any = {
                user_metadata: { full_name: name }
            };

            // Only update email in auth if it changed
            if (email !== targetUser.email) {
                authUpdatePayload.email = email;
            }

            const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
                targetUser.auth_user_id,
                authUpdatePayload
            );

            if (authError) {
                console.error("Auth update error:", authError);
                // Don't fail the whole request, but log it
            }
        }

        return new Response(JSON.stringify({
            message: "Usuario actualizado exitosamente"
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });

    } catch (error) {
        console.error("Update team member error:", error);
        return new Response(JSON.stringify({ error: "Internal Server Error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
};
