// Autorización de las rutas internas /api/admin/* (header x-admin-secret = ADMIN_API_SECRET).
import { checkAdminSecret } from "../../../lib/adminDirectRefund";
import { jsonResponse } from "../../../lib/supabaseServer";

/** null si está autorizado; si no, la respuesta de error. */
export function adminGuard(request: Request): Response | null {
    const auth = checkAdminSecret(request);
    if (auth === "disabled") return jsonResponse({ ok: false, error: { code: "unavailable", message: "ADMIN_API_SECRET no configurado." } }, 503);
    if (auth !== "ok") return jsonResponse({ ok: false, error: { code: "forbidden", message: "No autorizado." } }, 403);
    return null;
}

export async function readJson(request: Request): Promise<any | null> {
    try {
        return await request.json();
    } catch {
        return null;
    }
}
