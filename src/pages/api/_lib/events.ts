// Lógica compartida de escritura de eventos (contrato C1).
import { MAX_FUNCTIONS } from "../../../lib/functionPattern.mjs";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { computeEventRange, formatLocation, slugify, notifySlack } from "./server-utils";
import { listOrgVenues, isVenueAllowed, insertOrgVenue } from "../../../lib/orgVenues";
import { sanitizeRichText } from "../../../lib/sanitize";
import { isDefaultCoverSettings, normalizeCoverSettings } from "../../../lib/eventCover";
import { isDefaultPageSettings, normalizePageSettings } from "../../../lib/eventPageSettings";
import { identityPublishBlocker } from "../../../lib/producerIdentity";
import { refreshEventRisk } from "../../../lib/eventRisk";
import { chainError } from "../../../../netlify/lib/tickets.mjs";
import { normalizeCheckoutFields, isDefaultCheckoutFields, normalizePeoplePerTicket } from "../../../lib/checkoutFields.mjs";
import { performersForDb } from "../../../lib/eventPerformers.mjs";
import { normalizeEntryUntil } from "../../../lib/entryDeadline.mjs";
import { hasSecretLocation, saveSecretLocation, SECRET_PLACE_NAME } from "../../../../netlify/lib/secret-location.mjs";
import { normalizeSeatMap, normalizeSeatSections, seatedTicketCapacity, missingSeats } from "../../../lib/seatMap.mjs";
import { takenSeats } from "../../../../netlify/lib/seats.mjs";

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
 * event_dates + event_locations/venues. Devuelve los valores calculados. Con dirección privada
 * (secret_location), location queda como "Lugar secreto, comuna": la leen los listados y sitios públicos.
 */
export async function refreshEventDenorm(eventId: number) {
    const supabase = getSupabaseAdmin();
    const [{ data: dates }, { data: locations }, secret] = await Promise.all([
        supabase.from("event_dates").select("date, start_time, end_time, event_location_id").eq("event_id", eventId),
        supabase
            .from("event_locations")
            .select("id, created_at, venues ( name, address_line1, city )")
            .eq("event_id", eventId)
            .order("created_at", { ascending: true }),
        hasSecretLocation(supabase, eventId),
    ]);

    const range = computeEventRange((dates || []).map((d: any) => ({
        date: d.date,
        start_time: d.start_time,
        end_time: d.end_time,
    })));

    const firstVenue: any = (locations || [])[0]?.venues;
    const venue = Array.isArray(firstVenue) ? firstVenue[0] : firstVenue;
    const location = formatLocation(venue ? { name: secret ? SECRET_PLACE_NAME : venue.name, address: secret ? null : venue.address_line1, city: venue.city } : null);

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
    /** Máximo de entradas de este tipo por compra (por defecto 10). */
    maxPerOrder?: number | null;
    /** Tanda anterior: id (real o temporal) de otra entrada del formulario. ""/null = se vende desde ya. */
    opensAfterId?: number | string | null;
    /** Personas por entrada (mesa para N, migración 202610300110). 1/omitido = entrada normal. */
    peoplePerTicket?: number | string | null;
    /** Hora límite de ingreso ("01:00", hora de Chile, relativa a la función). ""/null = entra a cualquier hora. */
    entryUntil?: string | null;
    /** Entradas numeradas: secciones del mapa donde vale (null/[] = todas). */
    seatSections?: string[] | null;
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

// ---------------------------------------------------------------------------------------------------------
// Tandas encadenadas desde el formulario (event_tickets.opens_after_ticket_id, migración 202610290100)
// ---------------------------------------------------------------------------------------------------------

const hasOpensAfter = (t: TicketInput) => t?.opensAfterId !== undefined && t?.opensAfterId !== null && t?.opensAfterId !== "";

/** Valida el encadenamiento del formulario antes de guardar (ids del formulario, reales o temporales). */
export function validateFormTicketChain(tickets: TicketInput[]) {
    const rows = tickets.map((t) => {
        const n = normalizeTicket(t);
        return { id: Number(t.id), ticket_name: n?.ticket_name || "", total_quantity: n?.total_quantity ?? null, end_date: n?.end_date ?? null, is_gift: false };
    });
    const chain = new Map(tickets.filter(hasOpensAfter).map((t) => [Number(t.id), Number(t.opensAfterId)]));
    for (const [id, prevId] of chain) {
        const others = new Map(chain);
        others.delete(id);
        const reason = chainError(rows, others, id, prevId);
        if (reason) throw new EventInputError(`Revisa las tandas: ${reason}`);
    }
}

/**
 * Guarda a qué tanda espera cada entrada. `idOf` traduce el id del formulario al id real. Solo toca las entradas
 * que traen opensAfterId (formularios anteriores no lo mandan). Sin la columna aún (deploy preview) no hace nada.
 */
export async function saveFormTicketChain(eventId: number, tickets: TicketInput[], idOf: (formId: unknown) => number | undefined) {
    const supabaseAdmin = getSupabaseAdmin();
    for (const t of tickets) {
        if (t?.opensAfterId === undefined) continue;
        const id = idOf(t.id);
        if (!id) continue;
        const prev = hasOpensAfter(t) ? idOf(t.opensAfterId) ?? null : null;
        const { error } = await supabaseAdmin.from("event_tickets").update({ opens_after_ticket_id: prev }).eq("id", id).eq("event_id", eventId);
        if (error) {
            if (["42703", "PGRST204"].includes(String(error.code || ""))) return;
            throw error;
        }
    }
}

/**
 * Guarda las personas por entrada (mesa para N) de las entradas que lo traen. Formularios anteriores no lo mandan.
 * Sin la columna aún (deploy preview) no hace nada, salvo que se pida una mesa: ahí avisa.
 */
export async function saveFormTicketPeople(eventId: number, tickets: TicketInput[], idOf: (formId: unknown) => number | undefined) {
    const supabaseAdmin = getSupabaseAdmin();
    for (const t of tickets) {
        if (t?.peoplePerTicket === undefined) continue;
        const id = idOf(t.id);
        if (!id) continue;
        const people = normalizePeoplePerTicket(t.peoplePerTicket);
        const { error } = await supabaseAdmin.from("event_tickets").update({ people_per_ticket: people }).eq("id", id).eq("event_id", eventId);
        if (error) {
            if (["42703", "PGRST204"].includes(String(error.code || ""))) {
                if (people > 1) throw new EventInputError("Las mesas para varias personas estarán disponibles después del próximo deploy.");
                return;
            }
            throw error;
        }
    }
}

// ---------------------------------------------------------------------------------------------------------
// Hora límite de ingreso desde el formulario (event_tickets.entry_until, migración 202610300300)
// ---------------------------------------------------------------------------------------------------------

/**
 * Guarda la hora límite de ingreso de cada entrada que la trae (formularios anteriores no mandan entryUntil). Sin la
 * columna aún (deploy preview) no hace nada. Una hora inválida se guarda como "sin hora límite".
 */
export async function saveFormEntryDeadlines(eventId: number, tickets: TicketInput[], idOf: (formId: unknown) => number | undefined) {
    const supabaseAdmin = getSupabaseAdmin();
    for (const t of tickets) {
        if (t?.entryUntil === undefined) continue;
        const id = idOf(t.id);
        if (!id) continue;
        const { error } = await supabaseAdmin.from("event_tickets").update({ entry_until: normalizeEntryUntil(t.entryUntil) }).eq("id", id).eq("event_id", eventId);
        if (error) {
            if (["42703", "PGRST204"].includes(String(error.code || ""))) return;
            throw error;
        }
    }
}

/** Guarda los datos extra del checkout (events.checkout_fields). Tolera que la columna aún no exista. */
export async function saveCheckoutFields(eventId: number, orgId: number, raw: unknown): Promise<void> {
    const fields = normalizeCheckoutFields(raw);
    const { error } = await getSupabaseAdmin()
        .from("events")
        .update({ checkout_fields: isDefaultCheckoutFields(fields) ? null : fields })
        .eq("id", eventId)
        .eq("organization_id", orgId);
    if (error && error.code !== "42703" && error.code !== "PGRST204") throw error;
    if (error) console.warn("checkout_fields no disponible todavía:", error.message);
}

/**
 * Artistas, elenco o expositores (events.performers, src/lib/eventPerformers.mjs): "Participan" en la página y
 * performer en el JSON-LD. Reemplaza la lista completa. Tolera que la migración 202611090100 aún no esté aplicada.
 */
export async function savePerformers(eventId: number, orgId: number, raw: unknown): Promise<void> {
    const { error } = await getSupabaseAdmin()
        .from("events")
        .update({ performers: performersForDb(raw) })
        .eq("id", eventId)
        .eq("organization_id", orgId);
    if (error && error.code !== "42703" && error.code !== "PGRST204") throw error;
    if (error) console.warn("performers no disponible todavía:", error.message);
}

/** true si el id viene del cliente (Date.now()) y no de la base de datos. */
export const isClientTempId = (id: unknown) => id === undefined || id === null || id === "" || (typeof id === "number" && id > 1000000000000);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;
export function isValidDateInput(d: any) {
    return d && DATE_RE.test(d.date || "") && TIME_RE.test(d.startTime || "") && (!d.endTime || TIME_RE.test(d.endTime));
}

/** Tope de funciones por evento (el mismo de "Repetir" en el formulario y de update_event_functions). */
export function assertFunctionCount(locations: Array<{ dates?: unknown[] }>) {
    const total = (locations || []).reduce((n, loc) => n + (Array.isArray(loc?.dates) ? loc.dates.length : 0), 0);
    if (total > MAX_FUNCTIONS) throw new EventInputError(`Máximo ${MAX_FUNCTIONS} funciones por evento (enviaste ${total}).`);
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

/**
 * Guarda el ajuste de portada (events.cover_settings) normalizado; los valores por defecto se guardan como NULL.
 * No falla si la columna todavía no existe (deploy previews sobre la BD de producción antes de migrar).
 */
export async function saveCoverSettings(eventId: number, orgId: number, raw: unknown): Promise<void> {
    const settings = normalizeCoverSettings(raw);
    const { error } = await getSupabaseAdmin()
        .from("events")
        .update({ cover_settings: isDefaultCoverSettings(settings) ? null : settings })
        .eq("id", eventId)
        .eq("organization_id", orgId);
    if (error && error.code !== "42703" && error.code !== "PGRST204") throw error;
    if (error) console.warn("cover_settings no disponible todavía:", error.message);
}

/** Guarda el diseño de la página pública (events.page_settings). Tolera que la columna aún no exista. */
export async function savePageSettings(eventId: number, orgId: number, raw: unknown): Promise<void> {
    const settings = normalizePageSettings(raw);
    const { error } = await getSupabaseAdmin()
        .from("events")
        .update({ page_settings: isDefaultPageSettings(settings) ? null : settings })
        .eq("id", eventId)
        .eq("organization_id", orgId);
    if (error && error.code !== "42703" && error.code !== "PGRST204") throw error;
    if (error) console.warn("page_settings no disponible todavía:", error.message);
}

export type EventGraphInput = {
    general: {
        name?: string;
        description?: string;
        /** Entradas numeradas (mapa de asientos por ubicación). */
        seated?: boolean;
        imageUrl?: string | null;
        isPrivate?: boolean;
        category?: string | null;
        coverSettings?: unknown;
        /** Datos extra del checkout (src/lib/checkoutFields.mjs). */
        checkoutFields?: unknown;
        /** Artistas, elenco o expositores: [{ name, type: person|group }] (src/lib/eventPerformers.mjs). */
        performers?: unknown;
        /** Dirección que solo ven quienes compran (events.secret_location). ""/null = sin dirección privada. */
        secretLocation?: string | null;
        /** Horas antes de la función en que se revela (null = apenas compran). */
        secretLocationRevealHours?: number | string | null;
    };
    locations: Array<{
        venueId?: string | null;
        isNewVenue?: boolean;
        newVenueName?: string;
        newVenueAddress?: string | null;
        newVenueCity?: string | null;
        dates: Array<{ id?: string | number; date: string; startTime: string; endTime?: string | null }>;
        /** Entradas numeradas: mapa de asientos de esta ubicación (src/lib/seatMap.mjs). */
        seatMap?: unknown;
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
    // Borrador guardado solo desde el formulario (saveFormDraft): se completa ese evento en vez de crear otro
    opts: { draftId?: number | null } = {},
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
    assertFunctionCount(locations);
    // Lugares existentes: solo los de la organización o los que ya usan sus eventos
    const { venues: allowedVenues, hasOrgColumn } = await listOrgVenues(supabaseAdmin, actor.orgId);
    if (locations.some((loc) => !loc.isNewVenue && !isVenueAllowed(loc.venueId, allowedVenues))) {
        throw new EventInputError("El lugar seleccionado no pertenece a tu organización", 403);
    }
    const ticketsPayload = tickets.map(normalizeTicket);
    if (ticketsPayload.some((t) => !t)) throw new EventInputError("Revisa las entradas: nombre, precio y cantidad deben ser válidos");
    validateFormTicketChain(tickets);
    const seatMaps = formSeatMaps(general, locations);

    // 1. Crear evento (siempre como borrador; se publica aparte) o completar el borrador guardado solo
    const name = String(general.name).trim().slice(0, 200);
    let slug = `${slugify(name) || "evento"}-${Date.now().toString().slice(-4)}`;
    let eventId: number;
    if (opts.draftId) {
        const draft = await loadAutosavedDraft(actor.orgId, opts.draftId);
        slug = draftSlug(name, draft.slug);
        const { error } = await supabaseAdmin
            .from("events")
            .update({
                name,
                title: name,
                description: sanitizeRichText(general.description),
                image_url: general.imageUrl || null,
                slug,
                accessibility: general.isPrivate ? "private" : "public",
            })
            .eq("id", draft.id)
            .eq("organization_id", actor.orgId);
        if (error) throw error;
        eventId = draft.id;
    } else {
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
        eventId = eventData.id as number;
    }
    state.eventId = eventId;
    // Dirección privada antes de refreshEventDenorm (la ubicación pública queda sin la calle)
    if (general.secretLocation) {
        await saveSecretLocation(supabaseAdmin, eventId, { address: general.secretLocation, revealHours: general.secretLocationRevealHours ?? null });
    }
    if (general.coverSettings) await saveCoverSettings(eventId, actor.orgId, general.coverSettings);
    if (general.checkoutFields) await saveCheckoutFields(eventId, actor.orgId, general.checkoutFields);
    if (general.performers !== undefined) await savePerformers(eventId, actor.orgId, general.performers);

    // 2. Ubicaciones y funciones (antes que las entradas, para mapear la función de cada entrada — R1)
    const dateIdMap = new Map<string, number>();
    const seatLocations: Array<{ locationId: string | null; venueId: string | null; map: any }> = [];
    for (const [locIndex, loc] of locations.entries()) {
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
        seatLocations.push({ locationId: String(locationData.id), venueId: venueId ? String(venueId) : null, map: seatMaps[locIndex] });

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
    const { data: insertedTickets, error: ticketsError } = await supabaseAdmin
        .from("event_tickets")
        .insert(
            ticketsPayload.map((t: any, i: number) => ({
                ...t,
                event_date_id: resolveTicketDateId(tickets[i]?.eventDateId, dateIdMap),
                event_id: eventId,
                max_quantity: Number(tickets[i]?.maxPerOrder) > 0 ? Math.floor(Number(tickets[i]?.maxPerOrder)) : 10,
                is_gift: false,
                status: "available",
            })),
        )
        .select("id");
    if (ticketsError) throw ticketsError;
    // Tandas encadenadas y hora límite de ingreso: el insert devuelve las filas en el mismo orden del formulario
    const ticketIdMap = new Map(tickets.map((t, i) => [String(t.id), Number((insertedTickets as any[])?.[i]?.id)]));
    if (tickets.some(hasOpensAfter)) await saveFormTicketChain(eventId, tickets, (formId) => ticketIdMap.get(String(formId)) || undefined);
    if (tickets.some((t) => normalizeEntryUntil(t?.entryUntil))) await saveFormEntryDeadlines(eventId, tickets, (formId) => ticketIdMap.get(String(formId)) || undefined);
    // Mesas para N (solo las que piden más de una persona: el resto queda con el valor por defecto)
    const tables = tickets.filter((t) => normalizePeoplePerTicket(t?.peoplePerTicket) > 1);
    if (tables.length) await saveFormTicketPeople(eventId, tables, (formId) => ticketIdMap.get(String(formId)) || undefined);
    // Entradas numeradas: mapa por ubicación, secciones y cupo de cada entrada
    if (general.seated === true) {
        await saveEventSeating(
            eventId,
            true,
            seatLocations,
            tickets.map((t) => ({ id: ticketIdMap.get(String(t.id))!, seatSections: t.seatSections })).filter((t) => t.id),
        );
    }

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
        // Términos para productores §2 bis: entradas pagadas => identidad verificada con Didit
        // Solo al pasar a publicado: los eventos ya publicados antes de esta regla siguen a la venta
        const identityBlocker = event.status === "published" ? null : await identityPublishBlocker(supabaseAdmin, orgId, event.id);
        if (identityBlocker) throw new EventInputError(identityBlocker);
        if (!event.accessibility) update.accessibility = "public";
        if (datesCount) await refreshEventDenorm(event.id);
    }

    const { error } = await supabaseAdmin.from("events").update(update).eq("id", event.id).eq("organization_id", orgId);
    if (error) throw error;
    const becamePublished = status === "published" && event.status !== "published";
    if (becamePublished) await onEventPublished(supabaseAdmin, event.id);
    return { becamePublished };
}

/** Al publicar: recalcula el riesgo (reserva y documentos exigidos) y avisa a Slack si es alto. Nunca lanza. */
async function onEventPublished(supabaseAdmin: any, eventId: number): Promise<void> {
    try {
        const risk = await refreshEventRisk(supabaseAdmin, eventId);
        if (risk?.level === "high") {
            const { data: ev } = await supabaseAdmin.from("events").select("id, name, slug, organization_id").eq("id", eventId).maybeSingle();
            await notifySlack(
                `⚠️ *Evento de riesgo ALTO publicado*\n• *Evento:* ${ev?.name || eventId} (#${eventId}, org ${ev?.organization_id ?? "?"})\n` +
                    `• *Score:* ${risk.score} · reserva ${risk.reserve_pct}%${risk.requires_documents ? " · exige documentos" : ""}\n` +
                    `• *Señales:* ${risk.signals.map((s) => s.label).join(", ") || "—"}\n• *Link:* https://aitickets.cl/eventos/${ev?.slug || ""}`,
            );
        }
    } catch (err: any) {
        console.error("riesgo del evento al publicar:", err?.message);
    }
}

// ---------------------------------------------------------------------------------------------------------
// Entradas numeradas desde el formulario (mapa de asientos, migración 202611020100, src/lib/seatMap.mjs)
//   general.seated: true = las entradas son numeradas; locations[].seatMap: mapa de cada ubicación;
//   tickets[].seatSections: secciones donde vale cada entrada (null = todas).
// ---------------------------------------------------------------------------------------------------------

const MISSING_SEAT_SCHEMA = ["42703", "PGRST204", "42P01", "PGRST205"];

/** Mapas del formulario normalizados (por índice de ubicación). Lanza EventInputError si falta alguno. */
export function formSeatMaps(general: any, locations: any[]): Array<ReturnType<typeof normalizeSeatMap>> {
    if (general?.seated !== true) return locations.map(() => null);
    return locations.map((loc, i) => {
        const map = normalizeSeatMap(loc?.seatMap);
        if (!map) throw new EventInputError(`Arma el mapa de asientos de la ubicación ${i + 1} o desmarca "Entradas numeradas".`);
        return map;
    });
}

/**
 * Antes de guardar un evento existente: un asiento vendido o reservado no puede desaparecer del mapa (ni el mapa
 * entero). Revisa las ubicaciones que ya existen; las funciones nuevas no tienen asientos tomados.
 */
export async function assertSeatChangesKeepSold(eventId: number, locations: any[], maps: Array<any>): Promise<void> {
    const supabaseAdmin = getSupabaseAdmin();
    const { data: dates, error } = await supabaseAdmin.from("event_dates").select("id, event_location_id").eq("event_id", eventId);
    if (error) throw error;
    const mapOfLocation = new Map(locations.map((loc, i) => [String(loc?.id), maps[i]]));
    for (const d of dates || []) {
        const locKey = String((d as any).event_location_id);
        if (!mapOfLocation.has(locKey)) continue; // ubicación eliminada: sus funciones se borran
        const keys = await takenSeats(supabaseAdmin, Number((d as any).id)).catch(() => []);
        if (!keys.length) continue;
        const map = mapOfLocation.get(locKey);
        const lost = missingSeats(map, keys);
        if (lost.length) {
            const sample = lost.slice(0, 3).map((k: string) => k.split(":").slice(1).join("-")).join(", ");
            throw new EventInputError(
                map
                    ? `No puedes quitar asientos que ya están vendidos o reservados (${sample}${lost.length > 3 ? "…" : ""}).`
                    : "Ya hay asientos vendidos o reservados: no puedes desmarcar las entradas numeradas.",
            );
        }
    }
}

/**
 * Guarda el mapa de cada ubicación (y lo deja como el último de su sala), las secciones de cada entrada y su cupo
 * (asientos de sus secciones en las funciones donde vale; una entrada numerada es para una persona). Sin entradas
 * numeradas limpia los mapas. Sin la migración: avisa si se pidieron asientos, si no no hace nada.
 */
export async function saveEventSeating(
    eventId: number,
    seated: boolean,
    locations: Array<{ locationId: string | null; venueId: string | null; map: any }>,
    tickets: Array<{ id: number; seatSections?: unknown }>,
): Promise<void> {
    const supabaseAdmin = getSupabaseAdmin();
    const missing = (error: any) => MISSING_SEAT_SCHEMA.includes(String(error?.code || ""));
    const fail = (error: any) => {
        if (missing(error)) {
            if (seated) throw new EventInputError("Las entradas numeradas estarán disponibles después del próximo deploy.");
            return true;
        }
        throw error;
    };

    for (const loc of locations) {
        if (!loc.locationId) continue;
        const { error } = await supabaseAdmin.from("event_locations").update({ seat_map: seated ? loc.map : null }).eq("id", loc.locationId).eq("event_id", eventId);
        if (error && fail(error)) return;
        if (seated && loc.venueId) {
            const { error: venueError } = await supabaseAdmin.from("venues").update({ seat_map: loc.map }).eq("id", loc.venueId);
            if (venueError) console.warn("No se pudo guardar el mapa en la sala:", venueError.message);
        }
    }

    if (!seated) {
        const ids = tickets.map((t) => t.id).filter(Boolean);
        if (ids.length) {
            const { error } = await supabaseAdmin.from("event_tickets").update({ seat_sections: null }).eq("event_id", eventId).in("id", ids);
            if (error) fail(error);
        }
        return;
    }

    // Mapa de cada función según su ubicación
    const { data: dates, error: datesError } = await supabaseAdmin.from("event_dates").select("id, event_location_id").eq("event_id", eventId);
    if (datesError) throw datesError;
    const mapOfLocation = new Map(locations.filter((l) => l.locationId).map((l) => [String(l.locationId), l.map]));
    const mapsByDate = new Map<string, any>();
    for (const d of dates || []) {
        const map = mapOfLocation.get(String((d as any).event_location_id));
        if (map) mapsByDate.set(String((d as any).id), map);
    }
    const allSections = { sections: locations.flatMap((l) => l.map?.sections || []) };

    const { data: rows, error: rowsError } = await supabaseAdmin.from("event_tickets").select("id, event_date_id").eq("event_id", eventId).in("id", tickets.map((t) => t.id));
    if (rowsError) throw rowsError;
    const dateOf = new Map((rows || []).map((r: any) => [Number(r.id), r.event_date_id]));
    for (const t of tickets) {
        const seat_sections = normalizeSeatSections(t.seatSections, allSections);
        const capacity = seatedTicketCapacity({ event_date_id: dateOf.get(Number(t.id)) ?? null, seat_sections }, mapsByDate);
        if (!capacity) throw new EventInputError("Cada entrada numerada debe valer en al menos una sección con asientos.");
        const { error } = await supabaseAdmin
            .from("event_tickets")
            .update({ seat_sections, total_quantity: capacity, people_per_ticket: 1 })
            .eq("id", t.id)
            .eq("event_id", eventId);
        if (error && fail(error)) return;
    }
}

/** Para el formulario de edición: mapa por ubicación y secciones por entrada (vacíos sin la migración). */
export async function loadEventSeatingForForm(eventId: number): Promise<{ maps: Map<string, any>; sections: Map<number, string[] | null> }> {
    const supabaseAdmin = getSupabaseAdmin();
    const [locs, tickets] = await Promise.all([
        supabaseAdmin.from("event_locations").select("id, seat_map").eq("event_id", eventId),
        supabaseAdmin.from("event_tickets").select("id, seat_sections").eq("event_id", eventId),
    ]);
    const maps = new Map<string, any>();
    for (const l of (locs.error ? [] : locs.data) || []) {
        const map = normalizeSeatMap((l as any).seat_map);
        if (map) maps.set(String((l as any).id), map);
    }
    const sections = new Map<number, string[] | null>();
    for (const t of (tickets.error ? [] : tickets.data) || []) sections.set(Number((t as any).id), (t as any).seat_sections || null);
    return { maps, sections };
}


// ---------------------------------------------------------------------------------------------------------
// Borrador automático del formulario "Crear evento" (/api/events/draft)
//   Apenas el primer paso tiene nombre y algo más (categoría, descripción o imagen), el evento se guarda como
//   borrador y cada cambio del primer paso lo actualiza. "Crear evento" completa ese mismo borrador
//   (createEventGraph con draftId): nunca quedan dos eventos.
// ---------------------------------------------------------------------------------------------------------

/** Lo mínimo del primer paso para guardar el borrador: nombre (más de 3 letras) y categoría, descripción o imagen. */
export function draftIsSavable(general: any): boolean {
    const name = typeof general?.name === "string" ? general.name.trim() : "";
    if (name.length <= 3) return false;
    const hasDescription = typeof general?.description === "string" && general.description.replace(/<[^>]*>/g, "").trim().length > 0;
    return Boolean((typeof general?.category === "string" && general.category.trim()) || hasDescription || general?.imageUrl);
}

/** Slug del borrador según su nombre actual, con el mismo sufijo (un borrador no tiene link público que cuidar). */
export function draftSlug(name: string, currentSlug: string | null | undefined): string {
    const suffix = /-(\d{4})$/.exec(String(currentSlug || ""))?.[1] || Date.now().toString().slice(-4);
    return `${slugify(name) || "evento"}-${suffix}`;
}

/**
 * Borrador de la organización que el formulario de creación puede seguir completando: en borrador y todavía sin
 * funciones ni entradas a la venta (el tipo Cortesía, si lo creó la base, no cuenta). Si ya se completó o se editó
 * en otra pestaña, EventInputError.
 */
export async function loadAutosavedDraft(orgId: number, draftId: number): Promise<{ id: number; slug: string | null }> {
    const supabaseAdmin = getSupabaseAdmin();
    const { data: event, error } = await supabaseAdmin.from("events").select("id, slug, status").eq("id", draftId).eq("organization_id", orgId).maybeSingle();
    if (error) throw error;
    if (!event) throw new EventInputError("No encontramos ese borrador.", 404);
    const [{ count: locations }, { count: tickets }] = await Promise.all([
        supabaseAdmin.from("event_locations").select("id", { count: "exact", head: true }).eq("event_id", draftId),
        supabaseAdmin.from("event_tickets").select("id", { count: "exact", head: true }).eq("event_id", draftId).not("is_gift", "is", true),
    ]);
    if ((event as any).status !== "draft" || (locations || 0) > 0 || (tickets || 0) > 0) {
        throw new EventInputError("Este borrador ya se completó o se editó en otra pestaña. Ábrelo desde Mis eventos.", 409);
    }
    return { id: Number((event as any).id), slug: (event as any).slug ?? null };
}

/** Crea o actualiza el borrador con los datos del primer paso. Devuelve su id. */
export async function saveFormDraft(actor: { userId: number; orgId: number }, general: any, draftId?: number | null): Promise<{ id: number }> {
    if (!draftIsSavable(general)) throw new EventInputError("Escribe el nombre y al menos la categoría, la descripción o la imagen.");
    const supabaseAdmin = getSupabaseAdmin();
    const name = String(general.name).trim().slice(0, 200);
    const fields = {
        name,
        title: name,
        description: sanitizeRichText(general.description || ""),
        image_url: general.imageUrl || null,
        accessibility: general.isPrivate ? "private" : "public",
    };
    let id: number;
    if (draftId) {
        const draft = await loadAutosavedDraft(actor.orgId, draftId);
        const { error } = await supabaseAdmin.from("events").update({ ...fields, slug: draftSlug(name, draft.slug) }).eq("id", draft.id).eq("organization_id", actor.orgId);
        if (error) throw error;
        id = draft.id;
    } else {
        const { data, error } = await supabaseAdmin
            .from("events")
            .insert({ ...fields, slug: draftSlug(name, null), status: "draft", created_by: actor.userId, organization_id: actor.orgId })
            .select("id")
            .single();
        if (error) throw error;
        id = Number((data as any).id);
    }
    await syncEventCategory(id, general.category || null);
    if (general.coverSettings !== undefined) await saveCoverSettings(id, actor.orgId, general.imageUrl ? general.coverSettings : null);
    return { id };
}
