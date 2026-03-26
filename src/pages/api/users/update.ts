import type { APIRoute } from "astro";
import { getSupabaseAdmin, getFriendlyErrorMessage } from "../../../lib/auth-helpers";
import { getSessionUser } from "../../../lib/supabaseServer";

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
        const { full_name, phone } = body;

        const supabaseAdmin = getSupabaseAdmin();

        // 1. Update public.users table
        const { error: dbError } = await supabaseAdmin
            .from("users")
            .update({
                name: full_name,
                phone: phone,
                updated_at: new Date().toISOString()
            })
            .eq("auth_user_id", user.id);

        if (dbError) {
            console.error("Database update error:", dbError);
            return new Response(JSON.stringify({ error: getFriendlyErrorMessage(dbError) }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }

        // 2. Update Supabase Auth metadata (so sidebar update reflects immediately without DB fetch if used)
        const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
            user.id,
            { user_metadata: { full_name: full_name, phone: phone } }
        );

        if (authError) {
            console.error("Auth update error:", authError);
            // We don't fail the whole request if only auth metadata fails, but good to know
        }

        return new Response(JSON.stringify({ message: "Profile updated successfully" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });

    } catch (error) {
        console.error("Profile update error:", error);
        return new Response(JSON.stringify({ error: "Internal Server Error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
};
