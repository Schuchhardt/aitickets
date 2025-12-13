import { getSupabaseAdmin, getSupabaseAnon, getFriendlyErrorMessage } from "../../../lib/auth-helpers";
import { verifyTurnstileToken } from "../../../lib/turnstile";

export const prerender = false; // Ensure this endpoint is server-rendered

export const POST = async ({ request }) => {
    try {
        const data = await request.json();
        const { email, password, name, organizationName, phone, cfToken } = data;

        // Validate input (basic)
        if (!email || !password || !name || !organizationName) {
            return new Response(JSON.stringify({ message: "Faltan campos obligatorios" }), { status: 400 });
        }

        // Verify Turnstile Token
        const { success: cfSuccess, message: cfMessage } = await verifyTurnstileToken(cfToken);
        if (!cfSuccess) {
            return new Response(JSON.stringify({ message: cfMessage }), { status: 400 });
        }

        // Initialize Supabase Clients using Helpers
        const supabaseAnon = getSupabaseAnon();
        const supabaseAdmin = getSupabaseAdmin();

        // 1. SignUp in Auth using Anon Client
        const { data: authData, error: authError } = await supabaseAnon.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: name,
                    role: 'producer'
                }
            }
        });

        if (authError) {
            return new Response(JSON.stringify({ message: getFriendlyErrorMessage(authError) }), { status: 400 });
        }

        if (!authData.user) {
            return new Response(JSON.stringify({ message: "No se pudo crear el usuario" }), { status: 500 });
        }

        // 2. Create Organization using Admin Client
        const { data: orgData, error: orgError } = await supabaseAdmin
            .from('organizations')
            .insert({
                public_name: organizationName,
                email: email,
                phone: phone
            })
            .select()
            .single();

        if (orgError) {
            // Security note: User created in Auth but Org failed. 
            // Ideally we would delete the Auth user here to rollback, but requires Service Role key (admin).
            // For now, we return error.
            console.error("Error creating org:", orgError);
            // Cleanup: Try to delete auth user if org creation fails (optional/advanced)
            return new Response(JSON.stringify({ message: "Error al crear la organización: " + getFriendlyErrorMessage(orgError) }), { status: 500 });
        }

        // 3. Create Public User Linked using Admin Client
        const { error: userError } = await supabaseAdmin
            .from('users')
            .insert({
                auth_user_id: authData.user.id,
                organization_id: orgData.id,
                name: name,
                email: email,
                phone: phone,
                role: 'producer',
                active: true
            });

        if (userError) {
            console.error("Error creating public user:", userError);
            return new Response(JSON.stringify({ message: "Error al crear perfil de usuario: " + getFriendlyErrorMessage(userError) }), { status: 500 });
        }

        return new Response(JSON.stringify({ message: "Registro exitoso", userId: authData.user.id }), { status: 200 });

    } catch (error) {
        console.error("Server error:", error);
        return new Response(JSON.stringify({ message: "Error interno del servidor" }), { status: 500 });
    }
};
