// Foto de perfil del usuario con sesión (cualquier rol). Ver src/lib/userAvatar.ts.
//   POST multipart (file)              → sube una foto (JPG/PNG/WEBP/GIF, máx. 5 MB) → { url }
//   POST JSON { source: "google" }     → copia la foto de su cuenta de Google        → { url }
//   DELETE                             → quita la foto (vuelve a la inicial)         → { url: null }
import type { APIRoute } from "astro";
import { forgetCachedSessionsOfUser, getSessionContext, jsonResponse } from "../../../lib/supabaseServer";
import { AVATAR_MAX_BYTES, clearAvatar, importGoogleAvatar, saveAvatarImage } from "../../../lib/userAvatar";

export const prerender = false;

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ message: "No autorizado" }, 401);
    const userId = Number(session.dbUser.id);

    try {
        const contentType = context.request.headers.get("content-type") || "";
        let result;
        if (contentType.includes("application/json")) {
            const body = await context.request.json().catch(() => null);
            if (body?.source !== "google") return jsonResponse({ message: "Solicitud inválida" }, 400);
            result = await importGoogleAvatar(userId, session.authUser);
        } else {
            const formData = await context.request.formData().catch(() => null);
            const file = formData?.get("file");
            if (!file || typeof file === "string") return jsonResponse({ message: "No se proporcionó ningún archivo" }, 400);
            if (file.size > AVATAR_MAX_BYTES) return jsonResponse({ message: "La imagen no debe superar los 5MB" }, 400);
            result = await saveAvatarImage(userId, Buffer.from(await file.arrayBuffer()));
        }
        if (!result.ok) return jsonResponse({ message: result.message }, result.status);
        forgetCachedSessionsOfUser(userId);
        return jsonResponse({ message: "Foto actualizada", url: result.url });
    } catch (error: any) {
        console.error("avatar upload:", error?.message || error);
        return jsonResponse({ message: "No pudimos guardar tu foto. Intenta de nuevo." }, 500);
    }
};

export const DELETE: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ message: "No autorizado" }, 401);
    const userId = Number(session.dbUser.id);
    const result = await clearAvatar(userId);
    if (!result.ok) return jsonResponse({ message: result.message }, result.status);
    forgetCachedSessionsOfUser(userId);
    return jsonResponse({ message: "Foto eliminada", url: null });
};
