import type { APIRoute } from "astro";
import { getSupabaseAdmin, getFriendlyErrorMessage } from "../../../lib/auth-helpers";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { callInternalFunction, notifySlack, siteUrl } from "../_lib/server-utils";
import { syncEventCategory, refreshEventDenorm, normalizeTicket, isClientTempId, isValidDateInput, resolveTicketDateId, setEventStatus, EventInputError, saveCoverSettings } from "../_lib/events";
import { sanitizeRichText } from "../../../lib/sanitize";
import { listOrgVenues, isVenueAllowed, insertOrgVenue } from "../../../lib/orgVenues";

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ error: "Unauthorized" }, 401);
    const { dbUser } = session;
    if (!hasRole(dbUser, EVENT_MANAGER_ROLES)) {
        return jsonResponse({ message: "No tienes permisos para editar eventos" }, 403);
    }

    try {
        const body = await context.request.json();
        const { eventId, general, locations, tickets, statusOnly, status } = body || {};

        if (!eventId) {
            return jsonResponse({ message: "Event ID is required" }, 400);
        }

        const supabaseAdmin = getSupabaseAdmin();

        // 1. Verificar que el evento pertenece a la organización del usuario (cualquier miembro del equipo con rol de gestión)
        const event = await getOwnedEvent<{ id: number; name: string; slug: string; status: string; accessibility: string | null; start_date: string | null }>(
            eventId, dbUser.organization_id, "id, name, slug, status, accessibility, start_date", dbUser.id,
        );
        if (!event) {
            return jsonResponse({ message: "Evento no encontrado o no autorizado" }, 403);
        }

        // Cambio de estado (publicar / pausar)
        if (statusOnly && status) {
            let becamePublished = false;
            try {
                ({ becamePublished } = await setEventStatus(event, dbUser.organization_id, status));
            } catch (err) {
                if (err instanceof EventInputError) return jsonResponse({ message: err.message }, err.status);
                throw err;
            }

            if (becamePublished) {
                const { data: org } = await supabaseAdmin
                    .from("organizations")
                    .select("public_name")
                    .eq("id", dbUser.organization_id)
                    .single();
                const site = siteUrl() || new URL(context.request.url).origin;
                await notifySlack(
                    `🚀 *Evento publicado*\n• *Evento:* ${event.name}\n• *Organización:* ${org?.public_name || dbUser.organization_id}\n• *Publicado por:* ${dbUser.name || dbUser.email}\n• *Link:* ${site}/eventos/${event.slug}`,
                );
            }

            return jsonResponse({ message: "Estado actualizado", id: event.id }, 200);
        }

        if (!general?.name || !Array.isArray(locations) || !Array.isArray(tickets)) {
            return jsonResponse({ message: "Faltan datos requeridos" }, 400);
        }
        for (const loc of locations) {
            if (!Array.isArray(loc?.dates) || !loc.dates.every(isValidDateInput)) {
                return jsonResponse({ message: "Revisa las funciones: fecha y hora deben ser válidas" }, 400);
            }
        }
        // Lugares existentes: solo los de la organización o los que ya usan sus eventos
        const createsVenue = (loc: any) => Boolean(loc.isNewVenue && String(loc.newVenueName || "").trim());
        const { venues: allowedVenues, hasOrgColumn } = await listOrgVenues(supabaseAdmin, dbUser.organization_id);
        if (locations.some((loc: any) => !createsVenue(loc) && loc.venueId && !isVenueAllowed(loc.venueId, allowedVenues))) {
            return jsonResponse({ message: "El lugar seleccionado no pertenece a tu organización" }, 403);
        }
        const normalizedTickets = tickets.map((t: any) => ({ raw: t, data: normalizeTicket(t) }));
        if (normalizedTickets.some((t: any) => !t.data)) {
            return jsonResponse({ message: "Revisa las entradas: nombre, precio y cantidad deben ser válidos" }, 400);
        }
        const notifyAttendees = body?.notifyAttendees === true;
        const notifyMessage = typeof body?.notifyMessage === "string" ? body.notifyMessage.trim().slice(0, 1500) : "";

        // Foto "antes" de funciones y recintos, para decidir si hay que avisar a los asistentes
        const before = await loadSchedule(event.id);

        // 2. Datos generales
        const name = String(general.name).trim().slice(0, 200);
        const { error: updateError } = await supabaseAdmin
            .from("events")
            .update({
                name,
                title: name,
                description: sanitizeRichText(general.description),
                image_url: general.imageUrl || null,
                accessibility: general.isPrivate ? "private" : "public",
            })
            .eq("id", event.id)
            .eq("organization_id", dbUser.organization_id);
        if (updateError) throw updateError;

        await syncEventCategory(event.id, general.category);
        // Ajuste de portada (solo si el formulario lo envía: clientes antiguos no lo conocen)
        if (general.coverSettings !== undefined) {
            await saveCoverSettings(event.id, dbUser.organization_id, general.imageUrl ? general.coverSettings : null);
        }

        // 3. Ubicaciones y funciones (antes que las entradas: las entradas pueden apuntar a una función nueva — R1)
        const existingLocationIds = new Set(before.locations.map((l) => String(l.id)));
        const existingDateIds = new Set(before.dates.map((d) => String(d.id)));
        const keptLocationIds = new Set<string>();
        const keptDateIds = new Set<string>();
        // id del formulario (real o temporal) -> id real de event_dates de este evento
        const dateIdMap = new Map<string, number>();

        for (const loc of locations) {
            let venueId = loc.venueId;
            if (createsVenue(loc)) {
                venueId = await insertOrgVenue(
                    supabaseAdmin,
                    dbUser.organization_id,
                    { name: String(loc.newVenueName).trim(), address_line1: loc.newVenueAddress || null, city: loc.newVenueCity || null },
                    hasOrgColumn,
                );
            }

            let locationId: string | null = null;
            const isExistingLoc = !isClientTempId(loc.id) && existingLocationIds.has(String(loc.id));
            if (isExistingLoc) {
                locationId = String(loc.id);
                if (venueId) {
                    const { error } = await supabaseAdmin
                        .from("event_locations")
                        .update({ venue_id: venueId })
                        .eq("id", locationId)
                        .eq("event_id", event.id);
                    if (error) throw error;
                }
            } else {
                if (!venueId) continue;
                const { data: newLoc, error } = await supabaseAdmin
                    .from("event_locations")
                    .insert({ event_id: event.id, venue_id: venueId, name: "Main" })
                    .select("id")
                    .single();
                if (error) throw error;
                locationId = newLoc.id;
            }
            keptLocationIds.add(String(locationId));

            for (const d of loc.dates || []) {
                const datePayload = {
                    date: d.date,
                    start_time: d.startTime,
                    end_time: d.endTime || null,
                    event_location_id: locationId,
                    event_id: event.id,
                };
                if (!isClientTempId(d.id) && existingDateIds.has(String(d.id))) {
                    keptDateIds.add(String(d.id));
                    const { error } = await supabaseAdmin
                        .from("event_dates")
                        .update(datePayload)
                        .eq("id", d.id)
                        .eq("event_id", event.id);
                    if (error) throw error;
                    dateIdMap.set(String(d.id), Number(d.id));
                } else {
                    const { data: newDate, error } = await supabaseAdmin
                        .from("event_dates")
                        .insert(datePayload)
                        .select("id")
                        .single();
                    if (error) throw error;
                    if (d.id !== undefined && d.id !== null && d.id !== "") dateIdMap.set(String(d.id), newDate.id as number);
                }
            }
        }

        // Funciones y ubicaciones eliminadas en el formulario
        // (event_tickets.event_date_id tiene ON DELETE SET NULL: sus entradas pasan a "todas las funciones")
        const removedDateIds = [...existingDateIds].filter((id) => !keptDateIds.has(id));
        if (removedDateIds.length) {
            await supabaseAdmin.from("event_dates").delete().eq("event_id", event.id).in("id", removedDateIds);
        }
        const removedLocationIds = [...existingLocationIds].filter((id) => !keptLocationIds.has(id));
        if (removedLocationIds.length) {
            await supabaseAdmin.from("event_dates").delete().eq("event_id", event.id).in("event_location_id", removedLocationIds);
            const { error } = await supabaseAdmin.from("event_locations").delete().eq("event_id", event.id).in("id", removedLocationIds);
            if (error) console.error("No se pudieron borrar ubicaciones:", error);
        }

        // 4. Entradas: actualizar existentes (solo las de ESTE evento), insertar nuevas, retirar las eliminadas
        const { data: existingTickets } = await supabaseAdmin
            .from("event_tickets")
            .select("id")
            .eq("event_id", event.id);
        const existingTicketIds = new Set((existingTickets || []).map((t: any) => String(t.id)));
        const keptTicketIds = new Set<string>();

        for (const { raw, data } of normalizedTickets) {
            const eventDateId = resolveTicketDateId(raw.eventDateId, dateIdMap);
            if (!isClientTempId(raw.id) && existingTicketIds.has(String(raw.id))) {
                keptTicketIds.add(String(raw.id));
                const { error } = await supabaseAdmin
                    .from("event_tickets")
                    .update({
                        ticket_name: data!.ticket_name,
                        price: data!.price,
                        total_quantity: data!.total_quantity,
                        // solo tocar la función / ventana de venta si el formulario las envía
                        ...(raw.eventDateId !== undefined ? { event_date_id: eventDateId } : {}),
                        ...(raw.initDate !== undefined ? { init_date: data!.init_date } : {}),
                        ...(raw.endDate !== undefined ? { end_date: data!.end_date } : {}),
                    })
                    .eq("id", raw.id)
                    .eq("event_id", event.id);
                if (error) throw error;
            } else {
                const { error } = await supabaseAdmin.from("event_tickets").insert({
                    ...data,
                    event_date_id: eventDateId,
                    event_id: event.id,
                    max_quantity: 10,
                    is_gift: false,
                    status: "available",
                });
                if (error) throw error;
            }
        }

        // Entradas eliminadas en el formulario: se borran si no tienen ventas; si tienen, se retiran de la venta
        for (const ticketId of existingTicketIds) {
            if (keptTicketIds.has(ticketId)) continue;
            const { count: sold } = await supabaseAdmin
                .from("event_attendees")
                .select("id", { count: "exact", head: true })
                .eq("event_ticket_id", ticketId);
            if (sold) {
                await supabaseAdmin.from("event_tickets").update({ status: "unavailable" }).eq("id", ticketId).eq("event_id", event.id);
            } else {
                const { error } = await supabaseAdmin.from("event_tickets").delete().eq("id", ticketId).eq("event_id", event.id);
                if (error) {
                    // p. ej. referenciada por otra tabla: retirarla de la venta
                    await supabaseAdmin.from("event_tickets").update({ status: "unavailable" }).eq("id", ticketId).eq("event_id", event.id);
                }
            }
        }

        // 5. Recalcular start_date / end_date / location
        await refreshEventDenorm(event.id);

        // 6. Avisar a los asistentes SOLO si cambió algo relevante (contrato C8, server-to-server)
        let notified: string | null = null;
        if (event.status === "published") {
            const after = await loadSchedule(event.id);
            const change = describeScheduleChange(before, after);
            let payload: { changeType: string; changeDescription: string } | null = null;
            if (change) {
                const extra = notifyMessage ? `\n\nMensaje del organizador: ${notifyMessage}` : "";
                payload = { changeType: change.type, changeDescription: change.description + extra };
            } else if (notifyAttendees) {
                payload = {
                    changeType: "general_update",
                    changeDescription: notifyMessage || "El organizador actualizó la información del evento. Revisa los detalles actualizados.",
                };
            }
            if (payload) {
                notified = payload.changeType;
                // Se espera un máximo de 5s: en serverless un fetch no esperado puede cortarse al responder.
                const notification = callInternalFunction(new URL(context.request.url), "/api/send-event-notification", {
                    eventId: event.id,
                    ...payload,
                }).then((r) => {
                    if (!r.ok) console.error("Notification error:", r.status, r.data);
                });
                await Promise.race([notification, new Promise((resolve) => setTimeout(resolve, 5000))]);
            }
        }

        return jsonResponse({ message: "Evento actualizado", id: event.id, notified }, 200);
    } catch (error) {
        console.error("Update error:", error);
        return jsonResponse({ message: getFriendlyErrorMessage(error) }, 500);
    }
};

// ---------------------------------------------------------------------------
// Detección de cambios de funciones / recinto
// ---------------------------------------------------------------------------
type Schedule = {
    locations: { id: string; venue_id: string | null }[];
    dates: { id: number; date: string; start_time: string; end_time: string | null; event_location_id: string | null }[];
    venueNames: Map<string, string>;
};

async function loadSchedule(eventId: number): Promise<Schedule> {
    const supabase = getSupabaseAdmin();
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
function describeScheduleChange(before: Schedule, after: Schedule): { type: "date_change" | "venue_change"; description: string } | null {
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
