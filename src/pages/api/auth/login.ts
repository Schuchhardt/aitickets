import { getFriendlyErrorMessage } from "../../../lib/auth-helpers";
import { setSessionCookies, jsonResponse } from "../../../lib/supabaseServer";
import { createEphemeralAuthClient } from "../_lib/server-utils";
import type { APIRoute } from "astro";

export const POST: APIRoute = async (context) => {
    try {
        const data = await context.request.json();
        const { email, password } = data;

        if (!email || !password) {
            return jsonResponse({ message: "Email y contraseña son obligatorios" }, 400);
        }

        // Cliente efímero con service role: signInWithPassword guarda la sesión en memoria del cliente,
        // por eso no se usa el singleton getSupabaseAdmin().
        const supabase = createEphemeralAuthClient();

        const { data: authData, error } = await supabase.auth.signInWithPassword({
            email: String(email).trim(),
            password,
        });

        if (error) {
            return jsonResponse({ message: getFriendlyErrorMessage(error) }, 401);
        }

        if (!authData.session) {
            return jsonResponse({ message: "No se pudo obtener la sesión" }, 500);
        }

        setSessionCookies(context, authData.session.access_token, authData.session.refresh_token);

        return jsonResponse({ message: "Login exitoso" }, 200);
    } catch (error) {
        console.error("Login error:", error);
        return jsonResponse({ message: "Error interno del servidor" }, 500);
    }
};
