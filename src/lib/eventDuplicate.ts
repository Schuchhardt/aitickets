// Duplicar un evento como borrador. Lo usan /api/events/duplicate (panel) y duplicate_event (API de productores).
// Copia datos generales, ubicaciones, tipos de entrada a la venta, categoría y FAQs. NO copia las funciones
// (fechas): el productor (o la API) agrega las nuevas.
import { slugify } from "../pages/api/_lib/server-utils";
import { sanitizeRichText } from "./sanitize";

export const DUPLICATE_SOURCE_COLUMNS = "id, name, description, image_url, accessibility, secret_location, capacity";

/**
 * Crea la copia. `source` debe venir ya verificado como de la organización.
 * Si falla a mitad, el error trae `newEventId` (el borrador parcial) para que el llamador lo informe.
 */
export async function duplicateEventAsDraft(
    supabase: any,
    source: { id: number; name: string | null; description?: string | null; image_url?: string | null; accessibility?: string | null; secret_location?: unknown; capacity?: number | null },
    opts: { organizationId: number; userId: number; name?: string | null },
): Promise<{ id: number; slug: string; name: string; locationIds: string[] }> {
    const name = (opts.name || `${source.name || "Evento"} (copia)`).slice(0, 200);
    const slug = `${slugify(name) || "evento"}-${Date.now().toString().slice(-4)}`;
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
            slug,
            created_by: opts.userId,
            organization_id: opts.organizationId,
        })
        .select("id")
        .single();
    if (createError) throw createError;
    const newEventId = created.id as number;

    try {
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

        let locationIds: string[] = [];
        if (locations?.length) {
            const { data: inserted, error } = await supabase
                .from("event_locations")
                .insert(locations.map((l: any) => ({ ...l, event_id: newEventId })))
                .select("id");
            if (error) throw error;
            locationIds = (inserted || []).map((l: any) => String(l.id));
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
        return { id: newEventId, slug, name, locationIds };
    } catch (err: any) {
        if (err && typeof err === "object") err.newEventId = newEventId;
        throw err;
    }
}
