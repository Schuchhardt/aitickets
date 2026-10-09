// Herramientas: ciclo de vida del evento (duplicar, archivar, eliminar borradores) y edición de lugares.
import { ToolError, type ToolContext, type ToolDef } from "../registry";
import { eventIdSchema, loadOwnedEvent, eventUrls, DATE_PATTERN, TIME_PATTERN } from "./common";
import { DUPLICATE_SOURCE_COLUMNS, duplicateEventAsDraft } from "../../eventDuplicate";
import { createPreviewLink } from "../../eventPreview";
import { refreshEventDenorm } from "../../../pages/api/_lib/events";
import { listOrgVenues, isVenueAllowed, isMissingColumnError } from "../../orgVenues";

// ---------------------------------------------------------------------------
// duplicate_event
// ---------------------------------------------------------------------------

const duplicateEvent: ToolDef = {
    name: "duplicate_event",
    title: "Duplicar evento",
    description:
        "Repite un evento (p. ej. uno recurrente) como BORRADOR nuevo: copia descripción, imagen, lugar, tipos de entrada a la venta, categoría y FAQs. " +
        "No copia funciones, ventas ni códigos. Con date + start_time crea la nueva función; si no, agrégala desde el panel antes de publicar. " +
        "Devuelve un link privado de vista previa.",
    scope: "write",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
        type: "object",
        required: ["event_id"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            name: { type: "string", minLength: 3, maxLength: 200, description: "Nombre del nuevo evento. Omitir = '<nombre> (copia)'." },
            date: { type: "string", pattern: DATE_PATTERN, description: "Fecha de la nueva función (YYYY-MM-DD, hora de Chile)." },
            start_time: { type: "string", pattern: TIME_PATTERN, description: "Hora de inicio HH:MM (requerida si envías date)." },
            end_time: { type: "string", pattern: TIME_PATTERN, description: "Hora de término HH:MM (opcional)." },
        },
    },
    async handler(args, ctx) {
        if (args.date && !args.start_time) throw new ToolError("invalid_input", "Para crear la función envía date y start_time.");
        if (!args.date && (args.start_time || args.end_time)) throw new ToolError("invalid_input", "start_time/end_time requieren date.");
        const source = await loadOwnedEvent<any>(ctx, args.event_id, DUPLICATE_SOURCE_COLUMNS);
        let created;
        try {
            created = await duplicateEventAsDraft(ctx.supabase, source, { organizationId: ctx.actor.orgId, userId: ctx.actor.userId, name: args.name || null });
        } catch (err: any) {
            if (err?.newEventId) throw new ToolError("internal", `La copia quedó incompleta (borrador ${err.newEventId}). Revísala en el panel o elimínala con delete_event.`);
            throw err;
        }

        let functionCreated = false;
        if (args.date) {
            const { error } = await ctx.supabase.from("event_dates").insert({
                event_id: created.id,
                date: args.date,
                start_time: args.start_time,
                end_time: args.end_time || null,
                event_location_id: created.locationIds[0] || null,
            });
            if (error) throw error;
            functionCreated = true;
            await refreshEventDenorm(created.id);
        }

        let previewUrl: string | null = null;
        try {
            const link = await createPreviewLink(
                { eventId: created.id, orgId: ctx.actor.orgId, userId: ctx.actor.userId, singleUse: false, label: "Duplicado", via: ctx.channel, origin: ctx.origin },
                ctx.supabase,
            );
            previewUrl = link.url;
        } catch (err: any) {
            console.warn("duplicate_event preview:", err?.message);
        }

        return {
            event_id: created.id,
            source_event_id: Number(source.id),
            name: created.name,
            status: "draft",
            function_created: functionCreated,
            preview_url: previewUrl,
            dashboard_url: `${ctx.origin}/dashboard/events/${created.id}/edit`,
            ...eventUrls(ctx, { slug: created.slug, status: "draft" }),
            next_steps: functionCreated
                ? "Revisa precios y ventanas de venta de las entradas y publica con set_event_status cuando el productor confirme."
                : "Falta la fecha: agrégala en el panel (o duplica de nuevo con date + start_time) antes de publicar.",
        };
    },
    audit: (_args, result: any) => ({ summary: `Duplicado del evento ${result.source_event_id}`, target: String(result.event_id) }),
};

// ---------------------------------------------------------------------------
// archive_event
// ---------------------------------------------------------------------------

const archiveEvent: ToolDef = {
    name: "archive_event",
    title: "Archivar evento",
    description:
        "Archiva un evento pasado o un borrador para limpiar la lista (deja de aparecer en list_events y en el panel; sus ventas y datos se conservan). " +
        "archived=false lo desarchiva. Un evento publicado que aún no termina no se puede archivar.",
    scope: "write",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id"],
        additionalProperties: false,
        properties: { event_id: eventIdSchema, archived: { type: "boolean", default: true } },
    },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, name, slug, status, end_date, archived_at");
        if (args.archived) {
            const ended = event.end_date && new Date(event.end_date).getTime() < Date.now();
            if (event.status === "published" && !ended) {
                throw new ToolError("conflict", "El evento está publicado y no ha terminado. Pásalo a borrador (set_event_status) o espera a que termine para archivarlo.");
            }
        }
        const archivedAt = args.archived ? event.archived_at || new Date().toISOString() : null;
        const { error } = await ctx.supabase.from("events").update({ archived_at: archivedAt }).eq("id", event.id).eq("organization_id", ctx.actor.orgId);
        if (error) throw error;
        return { event_id: Number(event.id), name: event.name, archived: Boolean(archivedAt), archived_at: archivedAt };
    },
    audit: (args) => ({ summary: args.archived ? "Evento archivado" : "Evento desarchivado" }),
};

// ---------------------------------------------------------------------------
// delete_event
// ---------------------------------------------------------------------------

async function deletionCheck(ctx: ToolContext, eventId: number) {
    const event = await loadOwnedEvent<any>(ctx, eventId, "id, name, status");
    if (event.status === "published") {
        throw new ToolError("conflict", "El evento está publicado: no se puede eliminar. Si nunca vendió, pásalo a borrador primero; si ya pasó, usa archive_event.");
    }
    const head = (table: string) => ctx.supabase.from(table).select("id", { count: "exact", head: true }).eq("event_id", event.id);
    const [orders, issued, withdrawals, tickets, dates] = await Promise.all([
        head("event_orders"),
        head("event_attendees"),
        head("event_withdrawals"),
        head("event_tickets"),
        head("event_dates"),
    ]);
    for (const r of [orders, issued, withdrawals]) if (r.error) throw r.error;
    if ((orders.count || 0) > 0 || (issued.count || 0) > 0 || (withdrawals.count || 0) > 0) {
        throw new ToolError(
            "conflict",
            `El evento tiene ${orders.count || 0} orden(es) y ${issued.count || 0} entrada(s) emitida(s): no se puede eliminar (se conserva para contabilidad). Usa archive_event para ocultarlo.`,
        );
    }
    return { event, ticketTypes: tickets.count || 0, functions: dates.count || 0 };
}

const deleteEvent: ToolDef = {
    name: "delete_event",
    title: "Eliminar borrador",
    description:
        "Elimina DEFINITIVAMENTE un evento en borrador que nunca tuvo órdenes ni entradas emitidas (con sus tipos de entrada, funciones, lugar, FAQs y links de vista previa). " +
        "No se puede deshacer. Para eventos con ventas usa archive_event.",
    scope: "write",
    permission: "events.write",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: { type: "object", required: ["event_id"], additionalProperties: false, properties: { event_id: eventIdSchema } },
    async confirm(args, ctx) {
        const { event, ticketTypes, functions } = await deletionCheck(ctx, args.event_id);
        return {
            message: `Se eliminará definitivamente el borrador "${event.name}" (ID ${event.id}) con ${ticketTypes} tipo(s) de entrada y ${functions} función(es). No se puede deshacer.`,
            details: { event_id: Number(event.id), name: event.name, ticket_types: ticketTypes, functions },
        };
    },
    async handler(args, ctx) {
        const { event } = await deletionCheck(ctx, args.event_id);
        // Hijos sin ON DELETE CASCADE, en orden de dependencias (event_tickets → event_dates → event_locations).
        // El resto (vista previa, visitas, códigos, posts, invitados, mensajes, etc.) cae por CASCADE.
        for (const table of ["event_tickets", "event_dates", "event_locations", "event_faqs", "event_tags", "questions"]) {
            const { error } = await ctx.supabase.from(table).delete().eq("event_id", event.id);
            if (error) throw error;
        }
        const { error } = await ctx.supabase.from("events").delete().eq("id", event.id).eq("organization_id", ctx.actor.orgId);
        if (error) throw error;
        return { event_id: Number(event.id), name: event.name, deleted: true };
    },
    audit: (_args, result: any) => ({ summary: `Borrador eliminado: ${String(result.name || "").slice(0, 120)}` }),
};

// ---------------------------------------------------------------------------
// update_venue
// ---------------------------------------------------------------------------

const VENUE_FIELDS: Record<string, string> = {
    name: "name",
    address: "address_line1",
    address_line2: "address_line2",
    city: "city",
    region: "state_province",
    capacity: "capacity",
    contact_email: "contact_email",
    contact_phone: "contact_phone",
    website_url: "website_url",
    notes: "notes",
};

const updateVenue: ToolDef = {
    name: "update_venue",
    title: "Editar lugar",
    description:
        "Corrige el nombre, la dirección u otros datos de un lugar de la organización (venue_id de list_venues). El cambio se ve en todos los eventos que lo usan. " +
        "Un lugar compartido con eventos de otra organización no se puede editar: crea uno nuevo desde el panel.",
    scope: "write",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
        type: "object",
        required: ["venue_id"],
        additionalProperties: false,
        properties: {
            venue_id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$", description: "ID del lugar (list_venues → venue_id)." },
            name: { type: "string", minLength: 2, maxLength: 150 },
            address: { type: "string", maxLength: 200, nullable: true, description: "Calle y número." },
            address_line2: { type: "string", maxLength: 200, nullable: true },
            city: { type: "string", maxLength: 100, nullable: true, description: "Comuna o ciudad." },
            region: { type: "string", maxLength: 100, nullable: true },
            capacity: { type: "integer", minimum: 1, maximum: 1_000_000, nullable: true },
            contact_email: { type: "string", maxLength: 200, nullable: true },
            contact_phone: { type: "string", maxLength: 40, nullable: true },
            website_url: { type: "string", maxLength: 300, pattern: "^https?://", nullable: true },
            notes: { type: "string", maxLength: 1000, nullable: true },
        },
    },
    async handler(args, ctx) {
        const { venues } = await listOrgVenues(ctx.supabase, ctx.actor.orgId);
        if (!isVenueAllowed(args.venue_id, venues)) throw new ToolError("not_found", "Ese lugar no es de tu organización. Usa list_venues para ver los IDs.");

        let { data: venue, error } = await ctx.supabase.from("venues").select("id, name, organization_id").eq("id", args.venue_id).maybeSingle();
        if (error && isMissingColumnError(error)) ({ data: venue, error } = await ctx.supabase.from("venues").select("id, name").eq("id", args.venue_id).maybeSingle());
        if (error) throw error;
        if (!venue) throw new ToolError("not_found", "Lugar no encontrado.");
        if (venue.organization_id != null && Number(venue.organization_id) !== ctx.actor.orgId) {
            throw new ToolError("forbidden", "Ese lugar pertenece a otra organización.");
        }

        // Sin dueño (legado): solo si ningún evento de OTRA organización lo usa
        const { data: uses, error: usesError } = await ctx.supabase
            .from("event_locations")
            .select("event_id, events!inner(organization_id)")
            .eq("venue_id", venue.id)
            .limit(5000);
        if (usesError) throw usesError;
        const usedBy = (uses || []).map((u: any) => ({ eventId: Number(u.event_id), orgId: Number((Array.isArray(u.events) ? u.events[0] : u.events)?.organization_id) }));
        if (usedBy.some((u: { orgId: number }) => u.orgId !== ctx.actor.orgId)) {
            throw new ToolError("conflict", "Este lugar también lo usan eventos de otra productora, así que no se puede editar. Crea un lugar nuevo desde el panel y asígnalo a tu evento.");
        }

        const patch: Record<string, unknown> = {};
        for (const [arg, column] of Object.entries(VENUE_FIELDS)) {
            if (args[arg] === undefined) continue;
            patch[column] = args[arg] === "" ? null : args[arg];
        }
        if (!Object.keys(patch).length) throw new ToolError("invalid_input", "No enviaste cambios.");
        patch.updated_at = new Date().toISOString();
        const { error: updError } = await ctx.supabase.from("venues").update(patch).eq("id", venue.id);
        if (updError) throw updError;

        // Campo denormalizado events.location de los eventos que lo usan
        const eventIds: number[] = [...new Set<number>(usedBy.map((u: { eventId: number }) => u.eventId))].slice(0, 100);
        for (const id of eventIds) await refreshEventDenorm(id);

        return {
            venue_id: String(venue.id),
            updated: Object.keys(patch).filter((k) => k !== "updated_at"),
            events_affected: eventIds.length,
            note: eventIds.length ? "Si el cambio afecta a asistentes (dirección), avísales con send_attendee_message." : undefined,
        };
    },
    audit: (args) => ({ summary: `Lugar editado`, target: args.venue_id }),
};

export const lifecycleTools: ToolDef[] = [duplicateEvent, archiveEvent, deleteEvent, updateVenue];
