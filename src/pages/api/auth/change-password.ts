// POST /api/auth/change-password — RETIRADO. Ya no se pide la contraseña actual: el cambio se hace con
// un enlace al correo (POST /api/auth/magic-link { purpose: 'change-password' }) que abre /auth/link y
// luego el modal que llama a POST /api/auth/set-password.
import type { APIRoute } from "astro";
import { jsonResponse } from "../../../lib/supabaseServer";

export const prerender = false;

export const POST: APIRoute = async () =>
    jsonResponse({
        code: "moved",
        message: "Para cambiar tu contraseña, usa el botón \"Cambiar contraseña\" de Mi Perfil: te enviaremos un enlace a tu correo.",
        next: "/api/auth/magic-link",
    }, 410);
