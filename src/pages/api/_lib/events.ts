// Lógica compartida de escritura de eventos (contrato C1).
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { computeEventRange, formatLocation, slugify } from "./server-utils";
import { listOrgVenues, isVenueAllowed, insertOrgVenue } from "../../../lib/orgVenues";
import { sanitizeRichText } from "../../../lib/sanitize";

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

// ---------------------------------------------------------------------------
// Creación de evento y cambio de estado (compartidos por el dashboard y la API de productores)
// ---------------------------------------------------------------------------

/** Error de validación de un evento: el mensaje se muestra tal cual al productor. */
export class EventInputError extends Error {
    status: number;
    constructor(message: string, status = 400) {
        super(message);
        this.status = status;
    }
}

export type EventGraphInput = {
    general: { name?: string; description?: string; imageUrl?: string | null; isPrivate?: boolean; category?: string | null };
    locations: Array<{
        venueId?: string | null;
        isNewVenue?: boolean;
        newVenueName?: string;
        newVenueAddress?: string | null;
        newVenueCity?: string | null;
        dates: Array<{ id?: string | number; date: string; startTime: string; endTime?: string | null }>;
    }>;
    tickets: TicketInput[];
};

/**
 * Valida y crea un evento en borrador con sus ubicaciones, funciones y entradas.
 * Lanza EventInputError si los datos no son válidos. `state.eventId` queda con el id apenas se inserta el
 * evento (para reportarlo aunque falle un paso posterior).
 */
export async function createEventGraph(
    actor: { userId: number; orgId: number },
    input: EventGraphInput,
    state: { eventId: number | null } = { eventId: null },
): Promise<{ id: number; slug: string; name: string; ticketsPayload: any[] }> {
    const supabaseAdmin = getSupabaseAdmin();
    const { general, locations, tickets } = input || ({} as EventGraphInput);

    if (!general?.name || !Array.isArray(locations) || !locations.length || !Array.isArray(tickets) || !tickets.length) {
        throw new EventInputError("Faltan datos requeridos");
    }
    for (const loc of locations) {
        if (!Array.isArray(loc?.dates) || !loc.dates.length || !loc.dates.every(isValidDateInput)) {
            throw new EventInputError("Cada ubicación debe tener al menos una función con fecha y hora válidas");
        }
        if (!loc.isNewVenue && !loc.venueId) throw new EventInputError("Selecciona un lugar para cada ubicación");
        if (loc.isNewVenue && !String(loc.newVenueName || "").trim()) throw new EventInputError("El nuevo lugar debe tener nombre");
    }
    // Lugares existentes: solo los de la organización o los que ya usan sus eventos
    const { venues: allowedVenues, hasOrgColumn } = await listOrgVenues(supabaseAdmin, actor.orgId);
    if (locations.some((loc) => !loc.isNewVenue && !isVenueAllowed(loc.venueId, allowedVenues))) {
        throw new EventInputError("El lugar seleccionado no pertenece a tu organización", 403);
    }
    const ticketsPayload = tickets.map(normalizeTicket);
    if (ticketsPayload.some((t) => !t)) throw new EventInputError("Revisa las entradas: nombre, precio y cantidad deben ser válidos");

    // 1. Crear evento (siempre como borrador; se publica aparte)
    const name = String(general.name).trim().slice(0, 200);
    const slug = `${slugify(name) || "evento"}-${Date.now().toString().slice(-4)}`;

    const { data: eventData, error: eventError } = await supabaseAdmin
        .from("events")
        .insert({
            name,
            title: name,
            description: sanitizeRichText(general.description),
            image_url: general.imageUrl || null,
            slug,
            status: "draft",
            accessibility: general.isPrivate ? "private" : "public",
            created_by: actor.userId,
            organization_id: actor.orgId,
        })
        .select("id")
        .single();
    if (eventError) {
        console.error("Event insert error:", eventError);
        throw eventError;
    }
    const eventId = eventData.id as number;
    state.eventId = eventId;

    // 2. Ubicaciones y funciones (antes que las entradas, para mapear la función de cada entrada — R1)
    const dateIdMap = new Map<string, number>();
    for (const loc of locations) {
        let venueId = loc.venueId;
        if (loc.isNewVenue) {
            venueId = await insertOrgVenue(
                supabaseAdmin,
                actor.orgId,
                { name: String(loc.newVenueName).trim(), address_line1: loc.newVenueAddress || null, city: loc.newVenueCity || null },
                hasOrgColumn,
            );
        }

        const { data: locationData, error: locError } = await supabaseAdmin
            .from("event_locations")
            .insert({ event_id: eventId, venue_id: venueId, name: "Main" })
            .select("id")
            .single();
        if (locError) throw locError;

        for (const d of loc.dates) {
            const { data: dateRow, error: dateError } = await supabaseAdmin
                .from("event_dates")
                .insert({
                    event_id: eventId,
                    event_location_id: locationData.id,
                    date: d.date,
                    start_time: d.startTime,
                    end_time: d.endTime || null,
                })
                .select("id")
                .single();
            if (dateError) throw dateError;
            if (d.id !== undefined && d.id !== null && d.id !== "") dateIdMap.set(String(d.id), dateRow.id as number);
        }
    }

    // 3. Entradas (ventana de venta NULL salvo que el productor la defina)
    const { error: ticketsError } = await supabaseAdmin.from("event_tickets").insert(
        ticketsPayload.map((t: any, i: number) => ({
            ...t,
            event_date_id: resolveTicketDateId(tickets[i]?.eventDateId, dateIdMap),
            event_id: eventId,
            max_quantity: 10,
            is_gift: false,
            status: "available",
        })),
    );
    if (ticketsError) throw ticketsError;

    // 4. Categoría + campos denormalizados (start_date, end_date, location)
    await syncEventCategory(eventId, general.category);
    await refreshEventDenorm(eventId);

    return { id: eventId, slug, name, ticketsPayload };
}

/**
 * Publica ("published") o pausa ("draft") un evento de la organización. Para publicar exige al menos una
 * función y un tipo de entrada. Devuelve true si el evento pasó a publicado en esta llamada.
 * Lanza EventInputError si no se puede.
 */
export async function setEventStatus(
    event: { id: number; status: string | null; accessibility: string | null; start_date: string | null },
    orgId: number,
    status: string,
): Promise<{ becamePublished: boolean }> {
    const supabaseAdmin = getSupabaseAdmin();
    if (!["published", "draft"].includes(status)) throw new EventInputError("Estado inválido");

    const update: Record<string, unknown> = { status };
    if (status === "published") {
        const [{ count: datesCount }, { count: ticketsCount }] = await Promise.all([
            supabaseAdmin.from("event_dates").select("id", { count: "exact", head: true }).eq("event_id", event.id),
            supabaseAdmin.from("event_tickets").select("id", { count: "exact", head: true }).eq("event_id", event.id),
        ]);
        if (!datesCount && !event.start_date) {
            throw new EventInputError("Para publicar, el evento debe tener al menos una función (fecha y hora).");
        }
        if (!ticketsCount) throw new EventInputError("Para publicar, el evento debe tener al menos un tipo de entrada.");
        if (!event.accessibility) update.accessibility = "public";
        if (datesCount) await refreshEventDenorm(event.id);
    }

    const { error } = await supabaseAdmin.from("events").update(update).eq("id", event.id).eq("organization_id", orgId);
    if (error) throw error;
    return { becamePublished: status === "published" && event.status !== "published" };
}
