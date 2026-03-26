import { getSupabaseAnon, getFriendlyErrorMessage } from "../../../lib/auth-helpers";
import type { APIRoute } from "astro";

export const POST: APIRoute = async ({ request, cookies }) => {
    try {
        const data = await request.json();
        const { email, password } = data;

        if (!email || !password) {
            return new Response(JSON.stringify({ message: "Email y contraseña son obligatorios" }), { status: 400 });
        }

        const supabase = getSupabaseAnon();

        const { data: authData, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            return new Response(JSON.stringify({ message: getFriendlyErrorMessage(error) }), { status: 401 });
        }

        if (!authData.session) {
            return new Response(JSON.stringify({ message: "No se pudo obtener la sesión" }), { status: 500 });
        }

        const { access_token, refresh_token } = authData.session;

        // Set cookies
        cookies.set("sb-access-token", access_token, {
            path: "/",
            httpOnly: true,
            secure: import.meta.env.PROD, // Secure in production
            sameSite: "lax",
            maxAge: 60 * 60 * 24 * 7, // 1 week
        });

        cookies.set("sb-refresh-token", refresh_token, {
            path: "/",
            httpOnly: true,
            secure: import.meta.env.PROD,
            sameSite: "lax",
            maxAge: 60 * 60 * 24 * 7,
        });

        return new Response(JSON.stringify({ message: "Login exitoso" }), { status: 200 });

    } catch (error) {
        console.error("Login error:", error);
        return new Response(JSON.stringify({ message: "Error interno del servidor" }), { status: 500 });
    }
};
