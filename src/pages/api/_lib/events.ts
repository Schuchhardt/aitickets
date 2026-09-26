// Lógica compartida de escritura de eventos (contrato C1).
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { computeEventRange, formatLocation } from "./server-utils";

/** Guarda la categoría del evento vía category_tags(name) + event_tags (reemplaza las anteriores). */
export async function syncEventCategory(eventId: number, category: string | null | undefined) {
    const supabase = getSupabaseAdmin();
    const name = (category || "").trim().slice(0, 80);

    await supabase.from("event_tags").delete().eq("event_id", eventId);
    if (!name) return;

    let tagId: number | null = null;
    const { data: existing } = await supabase.from("category_tags").select("id").eq("name", name).maybeSingle();
    if (existing) {
        tagId = existing.id;
    } else {
        const { data: created, error } = await supabase.from("category_tags").insert({ name }).select("id").single();
        if (error) {
            // carrera con otro insert (name es UNIQUE): releer
            const { data: again } = await supabase.from("category_tags").select("id").eq("name", name).maybeSingle();
            tagId = again?.id ?? null;
        } else {
            tagId = created.id;
        }
    }
    if (tagId) {
        const { error } = await supabase.from("event_tags").insert({ event_id: eventId, tag_id: tagId });
        if (error) console.error("event_tags insert error:", error);
    }
}

/**
 * Recalcula los campos denormalizados en `events` (start_date, end_date, location) a partir de
 * event_dates + event_locations/venues. Devuelve los valores calculados.
 */
export async function refreshEventDenorm(eventId: number) {
    const supabase = getSupabaseAdmin();
    const [{ data: dates }, { data: locations }] = await Promise.all([
        supabase.from("event_dates").select("date, start_time, end_time, event_location_id").eq("event_id", eventId),
        supabase
            .from("event_locations")
            .select("id, created_at, venues ( name, address_line1, city )")
            .eq("event_id", eventId)
            .order("created_at", { ascending: true }),
    ]);

    const range = computeEventRange((dates || []).map((d: any) => ({
        date: d.date,
        start_time: d.start_time,
        end_time: d.end_time,
    })));

    const firstVenue: any = (locations || [])[0]?.venues;
    const venue = Array.isArray(firstVenue) ? firstVenue[0] : firstVenue;
    const location = formatLocation(venue ? { name: venue.name, address: venue.address_line1, city: venue.city } : null);

    const { error } = await supabase
        .from("events")
        .update({ start_date: range.start_date, end_date: range.end_date, location })
        .eq("id", eventId);
    if (error) console.error("refreshEventDenorm error:", error);

    return { ...range, location, datesCount: (dates || []).length };
}

export type TicketInput = {
    id?: number | string;
    name?: string;
    price?: number | string;
    quantity?: number | string | null;
    initDate?: string | null;
    endDate?: string | null;
    /** R1: id de la función (event_dates.id real o id temporal del cliente). ""/null = todas las funciones. */
    eventDateId?: number | string | null;
};

/** Normaliza un ticket del formulario. Devuelve null si es inválido. */
export function normalizeTicket(t: TicketInput) {
    const name = typeof t?.name === "string" ? t.name.trim().slice(0, 120) : "";
    const price = Math.round(Number(t?.price));
    const quantityRaw = t?.quantity === null || t?.quantity === undefined || t?.quantity === "" ? null : Math.floor(Number(t.quantity));
    if (!name || !Number.isFinite(price) || price < 0) return null;
    if (quantityRaw !== null && (!Number.isFinite(quantityRaw) || quantityRaw < 0)) return null;
    const toIso = (v: unknown) => {
        if (!v || typeof v !== "string") return null;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
    };
    return {
        ticket_name: name,
        price,
        total_quantity: quantityRaw,
        // Ventana de venta NULL = a la venta mientras el evento esté publicado (contrato C2)
        init_date: toIso(t?.initDate),
        end_date: toIso(t?.endDate),
    };
}

/** true si el id viene del cliente (Date.now()) y no de la base de datos. */
export const isClientTempId = (id: unknown) => id === undefined || id === null || id === "" || (typeof id === "number" && id > 1000000000000);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;
export function isValidDateInput(d: any) {
    return d && DATE_RE.test(d.date || "") && TIME_RE.test(d.startTime || "") && (!d.endTime || TIME_RE.test(d.endTime));
}

/**
 * R1: resuelve la función de una entrada. `dateIdMap` traduce ids del formulario (temporales o reales)
 * a ids reales de event_dates de ESTE evento. Cualquier valor desconocido => null (todas las funciones).
 */
export function resolveTicketDateId(raw: unknown, dateIdMap: Map<string, number>): number | null {
    if (raw === null || raw === undefined || raw === "") return null;
    return dateIdMap.get(String(raw)) ?? null;
}
