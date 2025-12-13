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
        const { name, email, role } = body;

        // Validate required fields
        if (!name || !email || !role) {
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
            .select("organization_id, role")
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
            return new Response(JSON.stringify({ error: "Solo los administradores pueden agregar miembros" }), {
                status: 403,
                headers: { "Content-Type": "application/json" },
            });
        }

        if (!currentUser.organization_id) {
            return new Response(JSON.stringify({ error: "Usuario sin organización" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Check if email already exists
        const { data: existingUser } = await supabaseAdmin
            .from("users")
            .select("id")
            .eq("email", email)
            .single();

        if (existingUser) {
            return new Response(JSON.stringify({ error: "Este correo electrónico ya está registrado" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Generate a temporary password
        const tempPassword = Math.random().toString(36).slice(-12) + "Aa1!";

        // Create auth user
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email: email,
            password: tempPassword,
            email_confirm: true, // Auto-confirm email
            user_metadata: {
                full_name: name,
            }
        });

        if (authError) {
            console.error("Auth user creation error:", authError);
            return new Response(JSON.stringify({ error: getFriendlyErrorMessage(authError) }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Create user in public.users table
        const { error: dbError } = await supabaseAdmin
            .from("users")
            .insert({
                name: name,
                email: email,
                role: role,
                organization_id: currentUser.organization_id,
                auth_user_id: authData.user.id,
                active: true
            });

        if (dbError) {
            console.error("Database insert error:", dbError);
            // Rollback: delete the auth user if DB insert fails
            await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
            return new Response(JSON.stringify({ error: getFriendlyErrorMessage(dbError) }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }

        // TODO: Send invitation email with temporary password
        // For now, we just return success

        return new Response(JSON.stringify({
            message: "Miembro agregado exitosamente",
            tempPassword: tempPassword // In production, send this via email instead
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });

    } catch (error) {
        console.error("Add team member error:", error);
        return new Response(JSON.stringify({ error: "Internal Server Error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
};
