// Links privados de promotor / RRPP desde el panel del evento (src/lib/promoterLinks.ts).
//   GET    /api/events/promoter-links?event_id=N   links que cubren el evento (los de ese evento y los de todos)
//   POST   /api/events/promoter-links              { eventId, name, allEvents? } => { url, link } (la URL se muestra una vez)
//   DELETE /api/events/promoter-links?id=<uuid>    revoca un link
// Roles: EVENT_MANAGER_ROLES. Un miembro con acceso solo a algunos eventos (aitickets_event_staff) crea links de un
// evento, no de todos, y solo ve y revoca los de sus eventos.
import type { APIRoute } from "astro";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { createPromoterLink, listPromoterLinks, revokePromoterLink, promoterRef, PROMOTER_REF_RE } from "../../../lib/promoterLinks";
import { getStaffEventIds } from "../../../../netlify/lib/event-staff.mjs";
import { siteUrl } from "../_lib/server-utils";

export const prerender = false;

const isMissingTable = (err: any) => ["42P01", "PGRST205"].includes(String(err?.code || ""));

async function requireManager(context: Parameters<APIRoute>[0]) {
    const session = await getSessionContext(context);
    if (!session) return { ok: false as const, response: jsonResponse({ error: "Unauthorized" }, 401) };
    if (!hasRole(session.dbUser, EVENT_MANAGER_ROLES)) {
        return { ok: false as const, response: jsonResponse({ message: "No tienes permisos para gestionar este evento" }, 403) };
    }
    const userId = session.dbUser.id ?? null;
    return {
        ok: true as const,
        orgId: Number(session.dbUser.organization_id),
        userId,
        eventIds: (await getStaffEventIds(getSupabaseAdmin(), userId)) as number[] | null,
    };
}

const errorResponse = (err: any) => {
    if (isMissingTable(err)) return jsonResponse({ message: "Los links de promotor aún no están disponibles. Intenta más tarde." }, 503);
    console.error("promoter-links:", err?.message || err);
    return jsonResponse({ message: "No se pudo completar la acción. Intenta nuevamente." }, 500);
};

export const GET: APIRoute = async (context) => {
    const auth = await requireManager(context);
    if (!auth.ok) return auth.response;
    const eventId = Number(context.url.searchParams.get("event_id"));
    if (!Number.isInteger(eventId) || eventId <= 0) return jsonResponse({ message: "event_id inválido" }, 400);
    if (!(await getOwnedEvent(eventId, auth.orgId, "id", auth.userId))) return jsonResponse({ message: "Evento no encontrado" }, 404);
    try {
        const links = await listPromoterLinks(getSupabaseAdmin(), auth.orgId, { eventId, eventIds: auth.eventIds });
        return jsonResponse({ links, can_create_all: !auth.eventIds });
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
    if (!(await getOwnedEvent(eventId, auth.orgId, "id", auth.userId))) return jsonResponse({ message: "Evento no encontrado" }, 404);
    const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
    if (!name || !PROMOTER_REF_RE.test(promoterRef(name))) return jsonResponse({ message: "Escribe el nombre del promotor." }, 400);
    const allEvents = body?.allEvents === true;
    if (allEvents && auth.eventIds) return jsonResponse({ message: "Tu acceso está limitado a ciertos eventos: crea el link solo para este evento." }, 403);
    try {
        const created = await createPromoterLink(getSupabaseAdmin(), {
            orgId: auth.orgId,
            eventId: allEvents ? null : eventId,
            name,
            userId: auth.userId,
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
    if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonResponse({ message: "id inválido" }, 400);
    try {
        const link = await revokePromoterLink(getSupabaseAdmin(), id, auth.orgId, auth.eventIds);
        return link ? jsonResponse({ ok: true }) : jsonResponse({ message: "Link no encontrado" }, 404);
    } catch (err) {
        return errorResponse(err);
    }
};
