// Lista de espera de un evento para el panel (aitickets_event_waitlist): quiénes se anotaron, por qué, a qué
// función y si ya se les avisó (netlify/lib/waitlist.mjs). GET ?event_id=<id>[&format=csv].
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { csvCell, slugify } from "../_lib/server-utils";
import { listWaitlist } from "../../../../netlify/lib/waitlist.mjs";

const fmtDateTime = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("es-CL", { timeZone: "America/Santiago", dateStyle: "short", timeStyle: "short" }) : "";

export const GET: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ message: "No autorizado" }, 401);
    const { dbUser } = session;
    if (!hasRole(dbUser, EVENT_MANAGER_ROLES)) return jsonResponse({ message: "No tienes permisos para ver la lista de espera" }, 403);

    const event = await getOwnedEvent<{ id: number; name: string; slug: string }>(
        Number(context.url.searchParams.get("event_id")),
        dbUser.organization_id,
        "id, name, slug",
        dbUser.id,
    );
    if (!event) return jsonResponse({ message: "Evento no encontrado" }, 404);

    let list: Awaited<ReturnType<typeof listWaitlist>>;
    try {
        list = await listWaitlist(getSupabaseAdmin(), event.id);
    } catch (error: any) {
        console.error("waitlist-list:", error?.message);
        return jsonResponse({ message: "No se pudo cargar la lista de espera" }, 500);
    }
    const { rows } = list;

    if (context.url.searchParams.get("format") === "csv") {
        const header = ["Email", "Motivo", "Función", "Anotado", "Avisado"];
        const lines = rows.map((r: any) => [r.email, r.kind_label, r.function_label || "Todas", fmtDateTime(r.created_at), fmtDateTime(r.notified_at)].map(csvCell).join(";"));
        const csv = "﻿" + [header.map(csvCell).join(";"), ...lines].join("\r\n");
        return new Response(csv, {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="lista-de-espera-${slugify(event.slug || event.name || String(event.id))}.csv"`,
                "Cache-Control": "no-store",
            },
        });
    }

    return jsonResponse(list);
};
