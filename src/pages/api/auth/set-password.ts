// POST /api/auth/set-password { password } — fija una contraseña nueva SIN pedir la actual.
// Requiere la sesión Y la cookie firmada aitickets_pw_reset del mismo usuario, que solo deja /auth/link
// al consumir un enlace de acceso (recuperar / cambiar contraseña) enviado a su correo. Solo identidades
// de AI Tickets (app_metadata.app === 'aitickets' o con fila en public.users; contrato R5).
// Al terminar borra la cookie y cierra las demás sesiones del usuario (best effort).
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionUser, jsonResponse } from "../../../lib/supabaseServer";
import { PW_RESET_COOKIE, getUsersRow, isAiticketsIdentity, verifyPwResetCookie } from "../../../lib/magic-link";

export const prerender = false;

const MIN_PASSWORD_LENGTH = 8;

export const POST: APIRoute = async (context) => {
    const authUser = await getSessionUser(context);
    if (!authUser) return jsonResponse({ message: "Tu sesión expiró. Pide un nuevo enlace." }, 401);

    const cookie = context.cookies.get(PW_RESET_COOKIE)?.value;
    if (!verifyPwResetCookie(cookie, authUser.id)) {
        return jsonResponse({
            code: "link_required",
            message: "Para cambiar tu contraseña abre el enlace que te enviamos por correo (dura 60 minutos). Puedes pedir uno nuevo desde Mi Perfil.",
        }, 403);
    }

    let password = "";
    try {
        const body = await context.request.json();
        password = typeof body?.password === "string" ? body.password : "";
    } catch {
        return jsonResponse({ message: "Solicitud inválida" }, 400);
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
        return jsonResponse({ message: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` }, 400);
    }
    if (password.length > 72) {
        return jsonResponse({ message: "La contraseña puede tener como máximo 72 caracteres." }, 400);
    }

    const profile = await getUsersRow(authUser.id);
    if (!profile || profile.active === false || !isAiticketsIdentity(authUser, !!profile)) {
        return jsonResponse({ message: "No se puede cambiar la contraseña de esta cuenta." }, 403);
    }

    const admin = getSupabaseAdmin();
    const { error } = await admin.auth.admin.updateUserById(authUser.id, { password });
    if (error) {
        console.error("set-password:", error.message);
        const weak = /weak|short|password should/i.test(error.message || "");
        return jsonResponse({
            message: weak ? "Esa contraseña es muy débil. Prueba con una más larga o con más variedad de caracteres." : "No pudimos guardar tu contraseña. Intenta de nuevo.",
        }, weak ? 400 : 500);
    }

    context.cookies.delete(PW_RESET_COOKIE, { path: "/" });

    // Cerrar las otras sesiones (p. ej. alguien con la contraseña anterior). La actual sigue activa.
    const accessToken = context.cookies.get("sb-access-token")?.value;
    if (accessToken) {
        try {
            const { error: signOutError } = await admin.auth.admin.signOut(accessToken, "others");
            if (signOutError) console.warn("set-password: no se pudieron cerrar las otras sesiones", signOutError.message);
        } catch (err: any) {
            console.warn("set-password: error cerrando las otras sesiones", err?.message || err);
        }
    }

    return jsonResponse({ ok: true, message: "¡Listo! Tu contraseña quedó actualizada." }, 200);
};
