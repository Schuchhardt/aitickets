// Funciones y recintos de un evento: foto "antes/después" y descripción del cambio para avisar a los asistentes.
// Lo usan el panel (/api/events/update) y la API de productores (update_event_functions).
import { getSupabaseAdmin } from "../../../lib/auth-helpers";

export type Schedule = {
    locations: { id: string; venue_id: string | null }[];
    dates: { id: number; date: string; start_time: string; end_time: string | null; event_location_id: string | null }[];
    venueNames: Map<string, string>;
};

export async function loadSchedule(eventId: number, supabase: any = getSupabaseAdmin()): Promise<Schedule> {
    const [{ data: locs }, { data: dates }] = await Promise.all([
        supabase.from("event_locations").select("id, venue_id, venues ( id, name )").eq("event_id", eventId),
        supabase.from("event_dates").select("id, date, start_time, end_time, event_location_id").eq("event_id", eventId),
    ]);
    const venueNames = new Map<string, string>();
    for (const l of locs || []) {
        const v: any = Array.isArray((l as any).venues) ? (l as any).venues[0] : (l as any).venues;
        if (v?.id) venueNames.set(String(v.id), v.name || "");
    }
    return {
        locations: (locs || []).map((l: any) => ({ id: String(l.id), venue_id: l.venue_id ? String(l.venue_id) : null })),
        dates: (dates || []).map((d: any) => ({
            id: d.id,
            date: String(d.date).slice(0, 10),
            start_time: String(d.start_time || "").slice(0, 5),
            end_time: d.end_time ? String(d.end_time).slice(0, 5) : null,
            event_location_id: d.event_location_id ? String(d.event_location_id) : null,
        })),
        venueNames,
    };
}

const DAY_FMT = new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

function functionLabel(d: Schedule["dates"][number], s: Schedule): string {
    const [y, m, day] = d.date.split("-").map(Number);
    const dayLabel = DAY_FMT.format(new Date(Date.UTC(y, m - 1, day, 12)));
    const loc = s.locations.find((l) => l.id === d.event_location_id);
    const venue = loc?.venue_id ? s.venueNames.get(loc.venue_id) : "";
    return `${dayLabel} · ${d.start_time}${d.end_time ? `–${d.end_time}` : ""}${venue ? ` · ${venue}` : ""}`;
}

/** Devuelve null si no cambiaron fechas/horarios ni recintos. */
export function describeScheduleChange(before: Schedule, after: Schedule): { type: "date_change" | "venue_change"; description: string } | null {
    const timeKey = (d: Schedule["dates"][number]) => `${d.date}|${d.start_time}|${d.end_time || ""}`;
    const beforeTimes = new Map(before.dates.map((d) => [timeKey(d), d]));
    const afterTimes = new Map(after.dates.map((d) => [timeKey(d), d]));
    const removed = [...beforeTimes.keys()].filter((k) => !afterTimes.has(k)).map((k) => beforeTimes.get(k)!);
    const added = [...afterTimes.keys()].filter((k) => !beforeTimes.has(k)).map((k) => afterTimes.get(k)!);
    const datesChanged = removed.length > 0 || added.length > 0;

    const venueSet = (s: Schedule) => new Set(s.locations.map((l) => l.venue_id).filter(Boolean) as string[]);
    const beforeVenues = venueSet(before);
    const afterVenues = venueSet(after);
    // también cuenta como cambio de lugar si una función que se mantiene cambió de recinto
    const venueOf = (s: Schedule, d: Schedule["dates"][number]) => s.locations.find((l) => l.id === d.event_location_id)?.venue_id || null;
    const movedFunctions = [...afterTimes.entries()]
        .filter(([k, d]) => beforeTimes.has(k) && venueOf(before, beforeTimes.get(k)!) !== venueOf(after, d));
    const venuesChanged =
        beforeVenues.size !== afterVenues.size || [...afterVenues].some((v) => !beforeVenues.has(v)) || movedFunctions.length > 0;

    if (!datesChanged && !venuesChanged) return null;

    const lines: string[] = [];
    if (datesChanged) {
        if (removed.length) lines.push(`Funciones que ya no se realizan en ese horario:\n${removed.map((d) => `• ${functionLabel(d, before)}`).join("\n")}`);
        if (added.length) lines.push(`Nuevas fechas u horarios:\n${added.map((d) => `• ${functionLabel(d, after)}`).join("\n")}`);
    }
    if (venuesChanged) {
        const names = (s: Schedule, ids: Set<string>) => [...ids].map((id) => s.venueNames.get(id) || "").filter(Boolean);
        const beforeNames = names(before, beforeVenues);
        const afterNames = names(after, afterVenues);
        lines.push(
            `Cambio de lugar: ${beforeNames.join(", ") || "lugar anterior"} → ${afterNames.join(", ") || "nuevo lugar"}` +
            (movedFunctions.length ? `\n${movedFunctions.map(([, d]) => `• ${functionLabel(d, after)}`).join("\n")}` : ""),
        );
    }
    lines.push("Tu entrada sigue siendo válida. Revisa los detalles actualizados del evento.");

    return { type: datesChanged ? "date_change" : "venue_change", description: lines.join("\n\n") };
}
