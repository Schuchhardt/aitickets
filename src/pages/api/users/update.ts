import type { APIRoute } from "astro";
import { getSupabaseAdmin, getFriendlyErrorMessage } from "../../../lib/auth-helpers";
import { getSessionContext } from "../../../lib/supabaseServer";

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);

    if (!session) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    try {
        const body = await context.request.json();
        const full_name = typeof body?.full_name === "string" ? body.full_name.trim().slice(0, 150) : undefined;
        const phone = typeof body?.phone === "string" ? body.phone.trim().slice(0, 50) : undefined;
        const user = session.authUser;

        const supabaseAdmin = getSupabaseAdmin();

        // 1. Update public.users table
        const { error: dbError } = await supabaseAdmin
            .from("users")
            .update({
                name: full_name,
                phone: phone,
                updated_at: new Date().toISOString()
            })
            .eq("id", session.dbUser.id);

        if (dbError) {
            console.error("Database update error:", dbError);
            return new Response(JSON.stringify({ error: getFriendlyErrorMessage(dbError) }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }

        // 2. Update Supabase Auth metadata (so sidebar update reflects immediately without DB fetch if used)
        // Solo si la cuenta de Auth la creó AI Tickets (Auth es compartido con otras apps)
        const { error: authError } = user.app_metadata?.app === "aitickets"
            ? await supabaseAdmin.auth.admin.updateUserById(user.id, { user_metadata: { ...user.user_metadata, full_name, phone } })
            : { error: null };

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
