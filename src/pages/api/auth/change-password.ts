import type { APIRoute } from "astro";
import { getSupabaseAdmin, createEphemeralAuthClient } from "../../../lib/auth-helpers";
import { getSessionContext, jsonResponse } from "../../../lib/supabaseServer";

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    const user = session?.authUser;

    if (!user || !user.email) {
        return jsonResponse({ error: "Unauthorized" }, 401);
    }

    try {
        const body = await context.request.json().catch(() => ({}));
        const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
        const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

        if (!currentPassword) {
            return jsonResponse({ message: "Ingresa tu contraseña actual" }, 400);
        }
        if (newPassword.length < 6) {
            return jsonResponse({ message: "La contraseña debe tener al menos 6 caracteres" }, 400);
        }
        if (newPassword === currentPassword) {
            return jsonResponse({ message: "La nueva contraseña debe ser distinta a la actual" }, 400);
        }

        // Verificar la contraseña actual (cliente efímero: no toca la sesión del servidor)
        const { error: verifyError } = await createEphemeralAuthClient().auth.signInWithPassword({
            email: user.email,
            password: currentPassword,
        });
        if (verifyError) {
            return jsonResponse({ message: "La contraseña actual no es correcta" }, 400);
        }

        const { error } = await getSupabaseAdmin().auth.admin.updateUserById(user.id, {
            password: newPassword,
        });
        if (error) throw error;

        return jsonResponse({ message: "Contraseña actualizada" }, 200);
    } catch (error: any) {
        console.error("Password change error:", error);
        return jsonResponse({ message: "Error al cambiar contraseña" }, 500);
    }
};
