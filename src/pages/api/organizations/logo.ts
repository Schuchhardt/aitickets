// Logo de la organización (dueño y administradores). Ver src/lib/orgLogo.ts.
//   POST multipart (file) → sube el logo (JPG/PNG/WEBP/GIF, máx. 5 MB) → { url }
//   DELETE                → quita el logo (vuelven las iniciales)       → { url: null }
import type { APIRoute } from "astro";
import { getSessionContext, hasRole, jsonResponse, ORG_ADMIN_ROLES } from "../../../lib/supabaseServer";
import { clearOrgLogo, LOGO_MAX_BYTES, saveOrgLogo } from "../../../lib/orgLogo";

export const prerender = false;

async function adminOrg(context: Parameters<APIRoute>[0]) {
    const session = await getSessionContext(context);
    if (!session) return { error: jsonResponse({ message: "No autorizado" }, 401) };
    if (!hasRole(session.dbUser, ORG_ADMIN_ROLES) || !session.dbUser.organization_id) {
        return { error: jsonResponse({ message: "Solo los administradores pueden cambiar el logo de la organización" }, 403) };
    }
    return { orgId: Number(session.dbUser.organization_id) };
}

export const POST: APIRoute = async (context) => {
    const auth = await adminOrg(context);
    if ("error" in auth) return auth.error!;
    try {
        const formData = await context.request.formData().catch(() => null);
        const file = formData?.get("file");
        if (!file || typeof file === "string") return jsonResponse({ message: "No se proporcionó ningún archivo" }, 400);
        if (file.size > LOGO_MAX_BYTES) return jsonResponse({ message: "La imagen no debe superar los 5MB" }, 400);
        const result = await saveOrgLogo(auth.orgId, Buffer.from(await file.arrayBuffer()));
        if (!result.ok) return jsonResponse({ message: result.message }, result.status);
        return jsonResponse({ message: "Logo actualizado", url: result.url });
    } catch (error: any) {
        console.error("org logo upload:", error?.message || error);
        return jsonResponse({ message: "No pudimos guardar el logo. Intenta de nuevo." }, 500);
    }
};

export const DELETE: APIRoute = async (context) => {
    const auth = await adminOrg(context);
    if ("error" in auth) return auth.error!;
    const result = await clearOrgLogo(auth.orgId);
    if (!result.ok) return jsonResponse({ message: result.message }, result.status);
    return jsonResponse({ message: "Logo eliminado", url: null });
};
