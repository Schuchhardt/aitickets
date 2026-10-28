// Lista de espera de un evento para el panel (aitickets_event_waitlist): quiénes se anotaron, por qué, a qué
// función y si ya se les avisó (netlify/lib/waitlist.mjs). GET ?event_id=<id>[&format=csv].
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { csvCell, slugify } from "../_lib/server-utils";
import { WAITLIST_TABLE, WAITLIST_KIND_LABELS } from "../../../../netlify/lib/waitlist.mjs";

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

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
        .from(WAITLIST_TABLE)
        .select("id, email, kind, event_date_id, created_at, notified_at")
        .eq("event_id", event.id)
        .order("created_at", { ascending: false })
        .limit(5000);
    if (error) {
        console.error("waitlist-list:", error.message);
        return jsonResponse({ message: "No se pudo cargar la lista de espera" }, 500);
    }

    const dateIds = [...new Set((data || []).map((r: any) => r.event_date_id).filter((id: any) => id != null))];
    const { data: dates } = dateIds.length
        ? await supabase.from("event_dates").select("id, date, start_time").in("id", dateIds)
        : { data: [] as any[] };
    const fnLabel = new Map(
        (dates || []).map((d: any) => [
            String(d.id),
            [new Date(`${d.date}T12:00:00Z`).toLocaleDateString("es-CL", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }), d.start_time?.slice(0, 5)]
                .filter(Boolean)
                .join(" · "),
        ]),
    );
    const rows = (data || []).map((r: any) => ({
        id: r.id,
        email: r.email,
        kind: r.kind,
        kind_label: (WAITLIST_KIND_LABELS as Record<string, string>)[r.kind] || r.kind,
        function_label: r.event_date_id != null ? fnLabel.get(String(r.event_date_id)) || "Función eliminada" : null,
        created_at: r.created_at,
        notified_at: r.notified_at,
    }));

    if (context.url.searchParams.get("format") === "csv") {
        const header = ["Email", "Motivo", "Función", "Anotado", "Avisado"];
        const lines = rows.map((r) => [r.email, r.kind_label, r.function_label || "Todas", fmtDateTime(r.created_at), fmtDateTime(r.notified_at)].map(csvCell).join(";"));
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

    const notified = rows.filter((r) => r.notified_at).length;
    return jsonResponse({ total: rows.length, notified, pending: rows.length - notified, rows });
};
