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
        const { newPassword } = body;

        if (!newPassword || newPassword.length < 6) {
            return new Response(
                JSON.stringify({ message: "La contraseña debe tener al menos 6 caracteres" }),
                { status: 400 }
            );
        }

        const supabaseAdmin = getSupabaseAdmin();

        const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
            password: newPassword,
        });

        if (error) throw error;

        return new Response(JSON.stringify({ message: "Contraseña actualizada" }), { status: 200 });

    } catch (error: any) {
        console.error("Password change error:", error);
        return new Response(
            JSON.stringify({ message: error.message || "Error al cambiar contraseña" }),
            { status: 500 }
        );
    }
};
