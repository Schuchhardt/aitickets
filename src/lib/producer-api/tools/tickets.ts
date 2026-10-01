// Herramientas: tipos de entrada y órdenes (compradores).
import { ToolError, type ToolDef } from "../registry";
import { eventIdSchema, loadOwnedEvent, ticketAvailability, presentTicket, TICKET_SELECT, isoOrNull } from "./common";
import { normalizeTicket } from "../../../pages/api/_lib/events";

const ticketIdSchema = { type: "integer" as const, minimum: 1, description: "ID del tipo de entrada (ver get_event → ticket_types)." };

async function loadTicket(ctx: any, eventId: number, ticketId: number) {
    const { data } = await ctx.supabase.from("event_tickets").select(TICKET_SELECT).eq("id", ticketId).eq("event_id", eventId).maybeSingle();
    if (!data) throw new ToolError("not_found", `El tipo de entrada ${ticketId} no existe en el evento ${eventId}.`);
    return data;
}

async function resolveFunctionId(ctx: any, eventId: number, functionId: number | null | undefined) {
    if (functionId === undefined) return undefined;
    if (functionId === null) return null;
    const { data } = await ctx.supabase.from("event_dates").select("id").eq("id", functionId).eq("event_id", eventId).maybeSingle();
    if (!data) throw new ToolError("not_found", `La función ${functionId} no pertenece al evento ${eventId} (ver get_event → functions).`);
    return Number(data.id);
}

function checkWindow(start: string | null, end: string | null) {
    if (start && end && new Date(end) <= new Date(start)) throw new ToolError("invalid_input", "sales_end debe ser posterior a sales_start.");
}

const createTicketType: ToolDef = {
    name: "create_ticket_type",
    title: "Crear tipo de entrada",
    description: "Agrega un tipo de entrada a un evento (ej: Preventa 2, VIP). Precio en CLP.",
    scope: "write",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
        type: "object",
        required: ["event_id", "name", "price"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            name: { type: "string", minLength: 1, maxLength: 120 },
            price: { type: "integer", minimum: 0, maximum: 100_000_000, description: "CLP. 0 = gratis." },
            quantity: { type: "integer", minimum: 0, maximum: 1_000_000, nullable: true, description: "Capacidad. null/omitir = sin límite." },
            sales_start: { type: "string", format: "date-time", nullable: true },
            sales_end: { type: "string", format: "date-time", nullable: true },
            function_id: { type: "integer", minimum: 1, nullable: true, description: "Solo para esa función (get_event → functions). Omitir = todas." },
            max_per_order: { type: "integer", minimum: 1, maximum: 50, default: 10 },
        },
    },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id");
        const normalized = normalizeTicket({ name: args.name, price: args.price, quantity: args.quantity ?? null, initDate: args.sales_start, endDate: args.sales_end });
        if (!normalized) throw new ToolError("invalid_input", "Revisa nombre, precio y cantidad.");
        checkWindow(normalized.init_date, normalized.end_date);
        const functionId = await resolveFunctionId(ctx, event.id, args.function_id);
        const { data, error } = await ctx.supabase
            .from("event_tickets")
            .insert({ ...normalized, event_id: event.id, event_date_id: functionId ?? null, max_quantity: args.max_per_order, is_gift: false, status: "available" })
            .select(TICKET_SELECT)
            .single();
        if (error) throw error;
        return { event_id: Number(event.id), ticket_type: presentTicket(data) };
    },
};

const updateTicketType: ToolDef = {
    name: "update_ticket_type",
    title: "Editar tipo de entrada",
    description:
        "Cambia nombre, precio, capacidad, ventana de venta o pausa/reanuda la venta (on_sale) de un tipo de entrada. " +
        "La capacidad no puede quedar bajo lo ya vendido. Un cambio de precio aplica solo a compras nuevas.",
    scope: "write",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id", "ticket_type_id"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            ticket_type_id: ticketIdSchema,
            name: { type: "string", minLength: 1, maxLength: 120 },
            price: { type: "integer", minimum: 0, maximum: 100_000_000 },
            quantity: { type: "integer", minimum: 0, maximum: 1_000_000, nullable: true },
            sales_start: { type: "string", format: "date-time", nullable: true },
            sales_end: { type: "string", format: "date-time", nullable: true },
            on_sale: { type: "boolean", description: "false = retirar de la venta (pausar); true = volver a vender." },
            max_per_order: { type: "integer", minimum: 1, maximum: 50 },
        },
    },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id");
        const ticket = await loadTicket(ctx, event.id, args.ticket_type_id);
        const patch: Record<string, unknown> = {};
        if (args.name !== undefined) patch.ticket_name = args.name.slice(0, 120);
        if (args.price !== undefined) patch.price = Math.round(args.price);
        if (args.max_per_order !== undefined) patch.max_quantity = args.max_per_order;
        if (args.on_sale !== undefined) patch.status = args.on_sale ? "available" : "unavailable";
        if (args.sales_start !== undefined) patch.init_date = isoOrNull(args.sales_start);
        if (args.sales_end !== undefined) patch.end_date = isoOrNull(args.sales_end);
        checkWindow(
            (patch.init_date !== undefined ? patch.init_date : ticket.init_date) as string | null,
            (patch.end_date !== undefined ? patch.end_date : ticket.end_date) as string | null,
        );
        const availability = await ticketAvailability(ctx, event.id, [Number(ticket.id)]);
        if (args.quantity !== undefined) {
            const used = (availability.get(Number(ticket.id))?.sold || 0) + (availability.get(Number(ticket.id))?.pending || 0);
            if (args.quantity !== null && args.quantity < used) {
                throw new ToolError("conflict", `Ya hay ${used} entradas vendidas o en checkout: la capacidad no puede ser menor.`);
            }
            patch.total_quantity = args.quantity;
        }
        if (!Object.keys(patch).length) throw new ToolError("invalid_input", "No enviaste cambios.");
        const { data, error } = await ctx.supabase
            .from("event_tickets")
            .update(patch)
            .eq("id", ticket.id)
            .eq("event_id", event.id)
            .select(TICKET_SELECT)
            .single();
        if (error) throw error;
        return { event_id: Number(event.id), ticket_type: presentTicket(data, availability.get(Number(ticket.id))) };
    },
};

const deleteTicketType: ToolDef = {
    name: "delete_ticket_type",
    title: "Eliminar tipo de entrada",
    description:
        "Elimina un tipo de entrada. Si ya tiene ventas no se borra: se retira de la venta (las entradas vendidas siguen válidas).",
    scope: "write",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id", "ticket_type_id"],
        additionalProperties: false,
        properties: { event_id: eventIdSchema, ticket_type_id: ticketIdSchema },
    },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id");
        const ticket = await loadTicket(ctx, event.id, args.ticket_type_id);
        const { count: sold } = await ctx.supabase
            .from("event_attendees")
            .select("id", { count: "exact", head: true })
            .eq("event_ticket_id", ticket.id);
        const retire = async () => {
            const { error } = await ctx.supabase.from("event_tickets").update({ status: "unavailable" }).eq("id", ticket.id).eq("event_id", event.id);
            if (error) throw error;
            return { event_id: Number(event.id), ticket_type_id: Number(ticket.id), result: "retired_from_sale", reason: "Tiene entradas emitidas u órdenes asociadas." };
        };
        if (sold) return retire();
        const { error } = await ctx.supabase.from("event_tickets").delete().eq("id", ticket.id).eq("event_id", event.id);
        if (error) return retire(); // p. ej. referenciada por una orden
        return { event_id: Number(event.id), ticket_type_id: Number(ticket.id), result: "deleted" };
    },
};

const ORDER_STATUSES = ["paid", "pending", "refunded", "expired", "failed", "all"] as const;

const listOrders: ToolDef = {
    name: "list_orders",
    title: "Listar órdenes",
    description:
        "Órdenes de un evento con datos del comprador (nombre, email, teléfono), entradas, monto, descuento y canal de origen. " +
        "Contiene datos personales: úsalos solo para gestionar el evento.",
    scope: "attendees",
    annotations: { readOnlyHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            status: { type: "string", enum: ORDER_STATUSES, default: "paid" },
            search: { type: "string", maxLength: 120, description: "Filtra por email del comprador (contiene)." },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
            offset: { type: "integer", minimum: 0, maximum: 100000, default: 0 },
        },
    },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, name");
        let query = ctx.supabase
            .from("event_orders")
            .select("id, created_at, status, amount, ticket_qty, ticket_fee, service_fee_tax, discount_code, discount_amount, ticket_details, buyer_first_name, buyer_last_name, buyer_email, buyer_phone, ref, utm_source, utm_medium, utm_campaign, payment_provider", { count: "exact" })
            .eq("event_id", event.id)
            .order("created_at", { ascending: false })
            .range(args.offset, args.offset + args.limit - 1);
        if (args.status !== "all") query = query.eq("status", args.status);
        if (args.search) query = query.ilike("buyer_email", `%${args.search.replace(/[%_\\]/g, (c: string) => `\\${c}`)}%`);
        const { data, error, count } = await query;
        if (error) throw error;
        const rows = (data || []).slice(0, args.limit);
        return {
            event_id: Number(event.id),
            total: count ?? rows.length,
            offset: args.offset,
            orders: rows.map((o: any) => ({
                id: o.id,
                created_at: o.created_at,
                status: o.status,
                buyer: { name: [o.buyer_first_name, o.buyer_last_name].filter(Boolean).join(" ") || null, email: o.buyer_email, phone: o.buyer_phone },
                tickets: o.ticket_qty,
                lines: Array.isArray(o.ticket_details) ? o.ticket_details.map((l: any) => ({ name: l.name || l.ticket_name, quantity: l.quantity, price: l.price })) : null,
                amount_clp: Number(o.amount) || 0,
                discount_code: o.discount_code || null,
                discount_clp: Number(o.discount_amount) || 0,
                payment: o.payment_provider || null,
                channel: o.ref ? `ref:${o.ref}` : [o.utm_source, o.utm_medium, o.utm_campaign].filter(Boolean).join(" / ") || "directo",
            })),
        };
    },
};

export const ticketTools: ToolDef[] = [createTicketType, updateTicketType, deleteTicketType, listOrders];
