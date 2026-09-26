import type { APIRoute } from "astro";
import { getSupabaseAdmin, getFriendlyErrorMessage } from "../../../lib/auth-helpers";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { slugify } from "../_lib/server-utils";
import { sanitizeRichText } from "../../../lib/sanitize";

/**
 * Duplica un evento como borrador: copia datos generales, categoría, ubicaciones, tipos de entrada y FAQs.
 * NO copia las funciones (fechas): el productor debe agregar las nuevas fechas antes de publicar.
 */
export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ error: "Unauthorized" }, 401);
    const { dbUser } = session;
    if (!hasRole(dbUser, EVENT_MANAGER_ROLES)) {
        return jsonResponse({ message: "No tienes permisos para duplicar eventos" }, 403);
    }

    const supabase = getSupabaseAdmin();
    let newEventId: number | null = null;

    try {
        const { eventId } = await context.request.json();
        if (!eventId) return jsonResponse({ message: "eventId es obligatorio" }, 400);

        const source = await getOwnedEvent<any>(
            eventId,
            dbUser.organization_id,
            "id, name, description, image_url, accessibility, secret_location, capacity",
        );
        if (!source) return jsonResponse({ message: "Evento no encontrado o no autorizado" }, 404);

        const name = `${source.name || "Evento"} (copia)`.slice(0, 200);
        const { data: created, error: createError } = await supabase
            .from("events")
            .insert({
                name,
                title: name,
                description: sanitizeRichText(source.description),
                image_url: source.image_url,
                accessibility: source.accessibility || "public",
                secret_location: source.secret_location,
                capacity: source.capacity,
                status: "draft",
                slug: `${slugify(name) || "evento"}-${Date.now().toString().slice(-4)}`,
                created_by: dbUser.id,
                organization_id: dbUser.organization_id,
            })
            .select("id")
            .single();
        if (createError) throw createError;
        newEventId = created.id as number;

        const [{ data: locations }, { data: tickets }, { data: tags }, { data: faqs }] = await Promise.all([
            supabase.from("event_locations").select("venue_id, name, display_name, entrance_instructions, access_notes").eq("event_id", source.id),
            supabase
                .from("event_tickets")
                .select("ticket_name, price, max_quantity, is_gift, status, total_quantity")
                .eq("event_id", source.id)
                .or("status.is.null,status.neq.unavailable"),
            supabase.from("event_tags").select("tag_id").eq("event_id", source.id),
            supabase.from("event_faqs").select("question, answer").eq("event_id", source.id),
        ]);

        if (locations?.length) {
            const { error } = await supabase.from("event_locations").insert(locations.map((l: any) => ({ ...l, event_id: newEventId })));
            if (error) throw error;
        }
        if (tickets?.length) {
            // Ventana de venta sin copiar (NULL = a la venta mientras esté publicado).
            // Las funciones no se copian => todas las entradas quedan para "todas las funciones" (R1).
            const { error } = await supabase.from("event_tickets").insert(
                tickets.map((t: any) => ({ ...t, status: "available", init_date: null, end_date: null, event_date_id: null, event_id: newEventId })),
            );
            if (error) throw error;
        }
        if (tags?.length) {
            await supabase.from("event_tags").insert(tags.map((t: any) => ({ tag_id: t.tag_id, event_id: newEventId })));
        }
        if (faqs?.length) {
            await supabase.from("event_faqs").insert(faqs.map((f: any) => ({ ...f, event_id: newEventId })));
        }

        return jsonResponse({ message: "Evento duplicado como borrador. Agrega las nuevas fechas antes de publicar.", id: newEventId }, 200);
    } catch (error) {
        console.error("Duplicate event error:", error);
        return jsonResponse({ message: getFriendlyErrorMessage(error), id: newEventId }, 500);
    }
};
