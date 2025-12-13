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
        const { general, locations, tickets } = body;

        // Validate basic data
        if (!general.name || !locations.length || !tickets.length) {
            return new Response(JSON.stringify({ message: "Faltan datos requeridos" }), { status: 400 });
        }

        const supabaseAdmin = getSupabaseAdmin();

        // 1. Create Event
        const slug = general.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now().toString().slice(-4);

        // We should look it up from 'users' table
        const { data: dbUser, error: userError } = await supabaseAdmin.from('users').select('organization_id, id').eq('auth_user_id', user.id).single();

        if (userError) console.error("User lookup error:", userError);
        if (!dbUser) {
            console.error("User not found in public.users");
            throw new Error("Usuario no encontrado en base de datos");
        }

        const eventPayload = {
            name: general.name,
            description: general.description,
            image_url: general.imageUrl,
            slug: slug,
            status: 'draft',
            created_by: dbUser.id, // Reference to public.users ID
            organization_id: dbUser.organization_id,
            title: general.name
        };

        const { data: eventData, error: eventError } = await supabaseAdmin
            .from('events')
            .insert(eventPayload)
            .select()
            .single();

        if (eventError) {
            console.error("Event insert error:", eventError);
            throw eventError;
        }
        const eventId = eventData.id;

        // 2. Process Locations & Dates
        for (const loc of locations) {
            let venueId = loc.venueId;

            // Create new Venue if needed
            if (loc.isNewVenue) {
                const { data: newVenue, error: venueError } = await supabaseAdmin
                    .from('venues')
                    .insert({
                        name: loc.newVenueName,
                        address_line1: loc.newVenueAddress,
                        city: loc.newVenueCity,
                        country_code: 'CL' // Default
                    })
                    .select()
                    .single();

                if (venueError) throw venueError;
                venueId = newVenue.id;
            }

            // Create Event Location (Link)
            const { data: locationData, error: locError } = await supabaseAdmin
                .from('event_locations')
                .insert({
                    event_id: eventId,
                    venue_id: venueId,
                    name: 'Main', // Default location name
                })
                .select()
                .single();

            if (locError) throw locError;

            // Create Dates (Functions)
            const datesPayload = loc.dates.map((d: any) => ({
                event_id: eventId,
                event_location_id: locationData.id,
                date: d.date,
                start_time: d.startTime,
                end_time: d.endTime
            }));

            const { error: datesError } = await supabaseAdmin.from('event_dates').insert(datesPayload);
            if (datesError) throw datesError;
        }

        // 3. Process Tickets
        const ticketsPayload = tickets.map((t: any) => ({
            event_id: eventId,
            ticket_name: t.name,
            price: t.price,
            total_quantity: t.quantity,
            max_quantity: 10, // Default purchase limit
            status: 'available'
        }));

        const { error: ticketsError } = await supabaseAdmin.from('event_tickets').insert(ticketsPayload);
        if (ticketsError) throw ticketsError;


        return new Response(JSON.stringify({ message: "Evento creado exitosamente", id: eventId }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });

    } catch (error) {
        console.error("Event creation error:", error);
        return new Response(JSON.stringify({ message: getFriendlyErrorMessage(error) }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
};
