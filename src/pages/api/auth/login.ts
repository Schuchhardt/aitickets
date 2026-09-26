import { getFriendlyErrorMessage, getSupabaseAdmin } from "../../../lib/auth-helpers";
import { setSessionCookies, jsonResponse } from "../../../lib/supabaseServer";
import { createEphemeralAuthClient } from "../_lib/server-utils";
import { getOrgVerification, markOrgVerified } from "../../../lib/email-verification";
import type { APIRoute } from "astro";

// La verificación de correo se exige AQUÍ (WP7), leyendo organizations.email_verified_at: el proyecto
// Supabase es compartido y no se puede depender de su configuración "Confirm email".
const NOT_VERIFIED_MESSAGE =
    "Tu correo aún no está confirmado. Revisa tu bandeja de entrada (y la carpeta de spam) y haz clic en el enlace que te enviamos.";

const notVerified = () =>
    jsonResponse({ message: NOT_VERIFIED_MESSAGE, code: "email_not_verified", canResend: true }, 403);

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
            // Proyectos con "Confirm email" activo: Supabase rechaza antes de llegar a nuestro chequeo
            if ((error as any).code === "email_not_confirmed" || /email not confirmed/i.test(error.message || "")) {
                return notVerified();
            }
            return jsonResponse({ message: getFriendlyErrorMessage(error) }, 401);
        }

        if (!authData.session) {
            return jsonResponse({ message: "No se pudo obtener la sesión" }, 500);
        }

        // Organización del usuario: debe haber verificado su correo
        const admin = getSupabaseAdmin();
        const { data: profile } = await admin
            .from("users")
            .select("organization_id")
            .eq("auth_user_id", authData.user.id)
            .maybeSingle();
        if (profile?.organization_id) {
            const orgId = Number(profile.organization_id);
            const { verified, termsAcceptedAt } = await getOrgVerification(orgId);
            if (verified === false) {
                // Cuentas creadas por el código anterior (email_confirm:true, sin aceptación de términos)
                // justo entre la migración y el despliegue: ya estaban confirmadas en Auth.
                const legacyConfirmed = !termsAcceptedAt && !!authData.user.email_confirmed_at;
                if (legacyConfirmed) {
                    await markOrgVerified(orgId, authData.user.email);
                } else {
                    // No entregar la sesión: se revoca el token recién emitido (best effort)
                    await admin.auth.admin.signOut(authData.session.access_token).catch(() => {});
                    return notVerified();
                }
            }
            // verified === null (columna inexistente en una preview sin migrar): se permite el ingreso
        }

        setSessionCookies(context, authData.session.access_token, authData.session.refresh_token);

        return jsonResponse({ message: "Login exitoso" }, 200);
    } catch (error) {
        console.error("Login error:", error);
        return jsonResponse({ message: "Error interno del servidor" }, 500);
    }
};
