// Links privados de vista previa de un evento desde el panel (src/lib/eventPreview.ts).
//   GET    /api/events/preview-links?event_id=N   lista los links del evento (sin tokens: no se guardan)
//   POST   /api/events/preview-links              { eventId, expiresInHours: number | null, singleUse, label? }
//                                                 => { url, link }  (la URL con el token se muestra una sola vez)
//   DELETE /api/events/preview-links?id=<uuid>    revoca un link
// Roles: EVENT_MANAGER_ROLES. El evento debe ser de la organización de la sesión (getOwnedEvent).
import type { APIRoute } from "astro";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { createPreviewLink, listPreviewLinks, revokePreviewLink, PreviewLinkError } from "../../../lib/eventPreview";
import { siteUrl } from "../_lib/server-utils";

export const prerender = false;

async function requireManager(context: Parameters<APIRoute>[0]) {
    const session = await getSessionContext(context);
    if (!session) return { ok: false as const, response: jsonResponse({ error: "Unauthorized" }, 401) };
    if (!hasRole(session.dbUser, EVENT_MANAGER_ROLES)) {
        return { ok: false as const, response: jsonResponse({ message: "No tienes permisos para gestionar este evento" }, 403) };
    }
    return { ok: true as const, orgId: Number(session.dbUser.organization_id), userId: session.dbUser.id ?? null };
}

const errorResponse = (err: unknown) => {
    if (err instanceof PreviewLinkError) {
        return jsonResponse({ message: err.message }, err.code === "unavailable" ? 503 : err.code === "conflict" ? 409 : 400);
    }
    console.error("preview-links:", (err as any)?.message || err);
    return jsonResponse({ message: "No se pudo completar la acción. Intenta nuevamente." }, 500);
};

export const GET: APIRoute = async (context) => {
    const auth = await requireManager(context);
    if (!auth.ok) return auth.response;
    const eventId = Number(context.url.searchParams.get("event_id"));
    if (!Number.isInteger(eventId) || eventId <= 0) return jsonResponse({ message: "event_id inválido" }, 400);
    if (!(await getOwnedEvent(eventId, auth.orgId, "id"))) return jsonResponse({ message: "Evento no encontrado" }, 404);
    try {
        return jsonResponse({ links: await listPreviewLinks(eventId, auth.orgId) });
    } catch (err) {
        return errorResponse(err);
    }
};

export const POST: APIRoute = async (context) => {
    const auth = await requireManager(context);
    if (!auth.ok) return auth.response;
    const body = await context.request.json().catch(() => null);
    const eventId = Number(body?.eventId);
    if (!Number.isInteger(eventId) || eventId <= 0) return jsonResponse({ message: "eventId inválido" }, 400);
    if (!(await getOwnedEvent(eventId, auth.orgId, "id"))) return jsonResponse({ message: "Evento no encontrado" }, 404);
    const expiresInHours = body?.expiresInHours === null ? null : body?.expiresInHours === undefined ? undefined : Number(body.expiresInHours);
    try {
        const created = await createPreviewLink({
            eventId,
            orgId: auth.orgId,
            userId: auth.userId,
            expiresInHours,
            singleUse: body?.singleUse === true,
            label: typeof body?.label === "string" ? body.label : null,
            via: "dashboard",
            origin: siteUrl() || context.url.origin,
        });
        return jsonResponse(created, 201);
    } catch (err) {
        return errorResponse(err);
    }
};

export const DELETE: APIRoute = async (context) => {
    const auth = await requireManager(context);
    if (!auth.ok) return auth.response;
    const id = context.url.searchParams.get("id") || "";
    try {
        const ok = await revokePreviewLink(id, auth.orgId);
        return ok ? jsonResponse({ ok: true }) : jsonResponse({ message: "Link no encontrado" }, 404);
    } catch (err) {
        return errorResponse(err);
    }
};
