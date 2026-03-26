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
        const { userId, active } = body;

        // Validate required fields
        if (!userId || typeof active !== "boolean") {
            return new Response(JSON.stringify({ error: "Datos inválidos" }), {
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
            return new Response(JSON.stringify({ error: "Solo los administradores pueden cambiar el estado de miembros" }), {
                status: 403,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Get the target user to verify they belong to same organization
        const { data: targetUser, error: targetError } = await supabaseAdmin
            .from("users")
            .select("id, organization_id, auth_user_id, role")
            .eq("id", userId)
            .single();

        if (targetError || !targetUser) {
            return new Response(JSON.stringify({ error: "Usuario no encontrado" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Verify target user belongs to same organization
        if (targetUser.organization_id !== currentUser.organization_id) {
            return new Response(JSON.stringify({ error: "No tienes permiso para modificar este usuario" }), {
                status: 403,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Prevent admin from deactivating themselves
        if (targetUser.id === currentUser.id && !active) {
            return new Response(JSON.stringify({ error: "No puedes desactivar tu propia cuenta" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Prevent deactivating the last admin
        if (targetUser.role === "admin" && !active) {
            const { data: admins } = await supabaseAdmin
                .from("users")
                .select("id")
                .eq("organization_id", currentUser.organization_id)
                .eq("role", "admin")
                .eq("active", true);

            if (admins && admins.length <= 1) {
                return new Response(JSON.stringify({ error: "No puedes desactivar al último administrador activo" }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                });
            }
        }

        // Update the user's active status in public.users table
        const { error: updateDbError } = await supabaseAdmin
            .from("users")
            .update({
                active: active,
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

        // Optionally: ban/unban the auth user (prevents login)
        if (targetUser.auth_user_id) {
            const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
                targetUser.auth_user_id,
                {
                    // Using ban_duration to prevent login when deactivated
                    // 'none' removes the ban, a large value effectively bans
                    ban_duration: active ? 'none' : '876000h' // ~100 years if deactivated
                }
            );

            if (authError) {
                console.error("Auth ban/unban error:", authError);
                // Don't fail the request, the DB update succeeded
            }
        }

        return new Response(JSON.stringify({
            message: active ? "Usuario reactivado exitosamente" : "Usuario desactivado exitosamente",
            active: active
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });

    } catch (error) {
        console.error("Toggle status error:", error);
        return new Response(JSON.stringify({ error: "Internal Server Error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
};
