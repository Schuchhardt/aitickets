import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionUser } from "../../../lib/supabaseServer";

export const POST: APIRoute = async (context) => {
    const user = await getSessionUser(context);

    if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    try {
        const body = await context.request.json();
        const { public_name, email, phone } = body;

        const supabaseAdmin = getSupabaseAdmin();

        // Get user's organization_id
        const { data: dbUser } = await supabaseAdmin
            .from('users')
            .select('organization_id')
            .eq('auth_user_id', user.id)
            .single();

        if (!dbUser?.organization_id) {
            return new Response(JSON.stringify({ message: "Organización no encontrada" }), { status: 404 });
        }

        const updateData: Record<string, string> = {};
        if (public_name !== undefined) updateData.public_name = public_name;
        if (email !== undefined) updateData.email = email;
        if (phone !== undefined) updateData.phone = phone;

        const { error } = await supabaseAdmin
            .from('organizations')
            .update(updateData)
            .eq('id', dbUser.organization_id);

        if (error) throw error;

        return new Response(JSON.stringify({ message: "Organización actualizada" }), { status: 200 });

    } catch (error: any) {
        console.error("Organization update error:", error);
        return new Response(JSON.stringify({ message: error.message || "Error al actualizar" }), { status: 500 });
    }
};
