import type { APIRoute } from "astro";
import { getSupabaseAdmin, getFriendlyErrorMessage } from "../../../lib/auth-helpers";
import { getSessionUser } from "../../../lib/supabaseServer";

export const POST: APIRoute = async (context) => {
    const user = await getSessionUser(context);

    if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    try {
        const body = await context.request.json();
        const { eventId, general, locations, tickets } = body;

        if (!eventId) {
            return new Response(JSON.stringify({ message: "Event ID is required" }), { status: 400 });
        }

        const supabaseAdmin = getSupabaseAdmin();

        // 1. Verify Ownership
        const { data: dbUser } = await supabaseAdmin
            .from('users')
            .select('id')
            .eq('auth_user_id', user.id)
            .single();

        if (!dbUser) throw new Error("User not found");

        const { data: event, error: fetchError } = await supabaseAdmin
            .from('events')
            .select('id')
            .eq('id', eventId)
            .eq('created_by', dbUser.id)
            .single();

        if (fetchError || !event) {
            return new Response(JSON.stringify({ message: "Evento no encontrado o no autorizado" }), { status: 403 });
        }

        // 2. Update Event Details
        const { error: updateError } = await supabaseAdmin
            .from('events')
            .update({
                name: general.name,
                description: general.description,
                image_url: general.imageUrl,
                title: general.name
            })
            .eq('id', eventId);

        if (updateError) throw updateError;

        // 3. Update/Upsert Tickets
        // Strategy: We loop through tickets. If ID exists (and is numeric/bigint), update. If ID is timestamp-ish (from Date.now() on client), it's new -> insert.
        // Actually, client sends ID for existing ones.
        for (const t of tickets) {
            // Check if ID is a real DB ID (assuming standard integer IDs, or BigInt). 
            // New items from client have ID = Date.now(), which is very large but distinct. 
            // We can check if it exists in DB? Or relies on explicit "isNew" flag?
            // "Date.now()" IDs will fail if we try to update them in DB if they don't exist.
            // Better: If we can't find it, insert. Wait, `upsert` needs the PK.
            // If we send an ID that doesn't exist, Supabase Upsert attempts to insert it WITH that ID.
            // But we want DB to generate ID for new ones.
            // So: Separate New vs Existing.

            // Heuristic: If ID looks generated (from frontend we might not know), but we can trust if it came from `initialFormState` it's real.
            // Simple: If `t.id` is present in the `initialFormState` passed to frontend, it's real.
            // But API doesn't know `initialFormState`.

            // Let's assume we pass `id` only for existing. Frontend `id` for new items (Date.now()) should be stripped or ignored?
            // Actually, `EditEventForm` initializes with real IDs. New items get `Date.now()`.
            // Real IDs usually are small integers (1, 2, 100). `Date.now()` is 1700000000xxx.
            // DB IDs are BigInt... so they could be large.
            // Better: Try to Update. If 0 rows affected, Insert? No, that's heavy.

            // Let's just Upsert everything? No, autoincrement.
            // Let's try to pass `id` ONLY if it is a persistent ID.
            // Frontend: `addTicket` uses `Date.now()`.
            // We can just strip the ID if it's > 2000000000 (roughly). Or just handle inserts separately.

            // Simpler: The payload could separate `newTickets` vs `existingTickets`.
            // But for now, let's just attempt to Insert if it looks like a new item?
            // Actually, let's iterate. 
            // If we strip ID from insert, it creates new.
            // If we include ID for update, it updates.

            // Hacky check: Is ID > 1000000000000? -> It's a timestamp -> Treat as New (Undefined ID).
            const isNew = t.id > 1000000000000;

            const ticketPayload = {
                ticket_name: t.name,
                price: t.price,
                total_quantity: t.quantity,
                event_id: eventId
            };

            if (isNew) {
                // Insert
                await supabaseAdmin.from('event_tickets').insert(ticketPayload);
            } else {
                // Update
                await supabaseAdmin.from('event_tickets').update(ticketPayload).eq('id', t.id);
            }
        }

        // 4. Locations & Dates - Similar logic
        // This is nested and harder.
        // For existing location, update details. For new, insert.
        // Inside location, handle dates.

        for (const loc of locations) {
            const isLocNew = loc.id > 1000000000000;
            let locationId = loc.id;

            let venueId = loc.venueId;
            if (loc.isNewVenue && loc.newVenueName) {
                // Create Venue if needed (this logic reused from create)
                const { data: newVenue } = await supabaseAdmin.from('venues').insert({
                    name: loc.newVenueName,
                    address_line1: loc.newVenueAddress,
                    city: loc.newVenueCity,
                    country_code: 'CL'
                }).select().single();
                venueId = newVenue?.id;
            }

            if (isLocNew) {
                const { data: newLoc } = await supabaseAdmin.from('event_locations').insert({
                    event_id: eventId,
                    venue_id: venueId,
                    name: 'Main'
                }).select().single();
                locationId = newLoc?.id;
            } else {
                // Update Location (e.g. venue changed)
                if (venueId) {
                    await supabaseAdmin.from('event_locations').update({ venue_id: venueId }).eq('id', locationId);
                }
            }

            // Dates
            if (locationId && loc.dates) {
                for (const d of loc.dates) {
                    const isDateNew = d.id > 1000000000000;
                    const datePayload = {
                        date: d.date,
                        start_time: d.startTime,
                        end_time: d.endTime,
                        event_location_id: locationId,
                        event_id: eventId
                    };

                    if (isDateNew) {
                        await supabaseAdmin.from('event_dates').insert(datePayload);
                    } else {
                        await supabaseAdmin.from('event_dates').update(datePayload).eq('id', d.id);
                    }
                }
            }
        }


        return new Response(JSON.stringify({ message: "Evento actualizado", id: eventId }), { status: 200 });

    } catch (error) {
        console.error("Update error:", error);
        return new Response(JSON.stringify({ message: getFriendlyErrorMessage(error) }), { status: 500 });
    }
};
