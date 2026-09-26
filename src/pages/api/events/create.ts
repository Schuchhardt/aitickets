import type { APIRoute } from "astro";
import { getSupabaseAdmin, getFriendlyErrorMessage } from "../../../lib/auth-helpers";
import { getSessionContext, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { notifySlack, slugify } from "../_lib/server-utils";
import { syncEventCategory, refreshEventDenorm, normalizeTicket, isValidDateInput, resolveTicketDateId } from "../_lib/events";
import { sanitizeRichText } from "../../../lib/sanitize";

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ error: "Unauthorized" }, 401);
    const { dbUser } = session;
    if (!hasRole(dbUser, EVENT_MANAGER_ROLES)) {
        return jsonResponse({ message: "No tienes permisos para crear eventos" }, 403);
    }

    let eventId: number | null = null;
    const supabaseAdmin = getSupabaseAdmin();

    try {
        const body = await context.request.json();
        const { general, locations, tickets } = body || {};

        // Validaciones básicas
        if (!general?.name || !Array.isArray(locations) || !locations.length || !Array.isArray(tickets) || !tickets.length) {
            return jsonResponse({ message: "Faltan datos requeridos" }, 400);
        }
        for (const loc of locations) {
            if (!Array.isArray(loc?.dates) || !loc.dates.length || !loc.dates.every(isValidDateInput)) {
                return jsonResponse({ message: "Cada ubicación debe tener al menos una función con fecha y hora válidas" }, 400);
            }
            if (!loc.isNewVenue && !loc.venueId) {
                return jsonResponse({ message: "Selecciona un lugar para cada ubicación" }, 400);
            }
            if (loc.isNewVenue && !String(loc.newVenueName || "").trim()) {
                return jsonResponse({ message: "El nuevo lugar debe tener nombre" }, 400);
            }
        }
        const ticketsPayload = tickets.map(normalizeTicket);
        if (ticketsPayload.some((t: any) => !t)) {
            return jsonResponse({ message: "Revisa las entradas: nombre, precio y cantidad deben ser válidos" }, 400);
        }

        // 1. Crear evento (siempre como borrador; se publica desde el dashboard)
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
                created_by: dbUser.id,
                organization_id: dbUser.organization_id,
            })
            .select("id")
            .single();

        if (eventError) {
            console.error("Event insert error:", eventError);
            throw eventError;
        }
        eventId = eventData.id as number;

        // 2. Ubicaciones y funciones (antes que las entradas, para mapear la función de cada entrada — R1)
        const dateIdMap = new Map<string, number>();
        for (const loc of locations) {
            let venueId = loc.venueId;

            if (loc.isNewVenue) {
                const { data: newVenue, error: venueError } = await supabaseAdmin
                    .from("venues")
                    .insert({
                        name: String(loc.newVenueName).trim(),
                        address_line1: loc.newVenueAddress || null,
                        city: loc.newVenueCity || null,
                        country_code: "CL",
                        timezone: "America/Santiago",
                    })
                    .select("id")
                    .single();
                if (venueError) throw venueError;
                venueId = newVenue.id;
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

        // Notificar en Slack
        const totalDates = locations.reduce((sum: number, loc: any) => sum + (loc.dates?.length || 0), 0);
        const ticketLines = ticketsPayload
            .map((t: any) => `  - ${t.ticket_name}: $${t.price} (${t.total_quantity ?? "sin límite"} disponibles)`)
            .join("\n");
        await notifySlack(
            `🎫 *Nuevo evento creado*\n• *Nombre:* ${name}\n• *Categoría:* ${general.category || "-"}\n• *Ubicaciones:* ${locations.length}\n• *Fechas:* ${totalDates}\n• *Tickets:*\n${ticketLines}\n• *Link:* /eventos/${slug}`,
        );

        return jsonResponse({ message: "Evento creado exitosamente", id: eventId }, 200);
    } catch (error) {
        console.error("Event creation error:", error);
        return jsonResponse({ message: getFriendlyErrorMessage(error), id: eventId }, 500);
    }
};
