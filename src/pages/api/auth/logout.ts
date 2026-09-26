import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { clearSessionCookies, jsonResponse } from "../../../lib/supabaseServer";

export const POST: APIRoute = async (context) => {
    try {
        // Revocar la sesión en Supabase (best-effort): invalida el refresh token aunque la cookie se haya copiado
        const accessToken = context.cookies.get("sb-access-token")?.value;
        if (accessToken) {
            try {
                const { error } = await getSupabaseAdmin().auth.admin.signOut(accessToken);
                if (error) console.warn("Logout: no se pudo revocar la sesión:", error.message);
            } catch (e) {
                console.warn("Logout: error revocando la sesión:", e);
            }
        }
        clearSessionCookies(context);
        return jsonResponse({ message: "Sesión cerrada correctamente" }, 200);
    } catch (error) {
        console.error("Logout error:", error);
        clearSessionCookies(context);
        return jsonResponse({ message: "Error al cerrar sesión" }, 500);
    }
};
