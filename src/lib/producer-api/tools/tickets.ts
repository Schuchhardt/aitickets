// Herramientas: tipos de entrada y órdenes (compradores).
import { ToolError, type ToolDef } from "../registry";
import { eventIdSchema, loadOwnedEvent, ticketAvailability, presentTicket, TICKET_SELECT, isoOrNull, rejectCourtesyName, clp, ticketChainInfo } from "./common";
import { chainError, loadTicketChain } from "../../../../netlify/lib/tickets.mjs";
import { loadEntryDeadlines } from "../../../../netlify/lib/checkin.mjs";
import { normalizeEntryUntil } from "../../entryDeadline.mjs";
import { normalizeTicket } from "../../../pages/api/_lib/events";
import { isTransferOrder } from "../../orderKinds";
import { IDENTITY_REQUIRED_MESSAGE, identityApproved, loadCapacityTickets, loadOrgIdentity, ticketsRequireIdentity } from "../../producerIdentity";
import { formatRut, MAX_PEOPLE_PER_TICKET } from "../../checkoutFields.mjs";

/**
 * Evento publicado que con este cambio pasa a vender más de 10 cupos pagados: exige identidad verificada (igual que al publicar).
 * Los eventos que ya superaban el umbral antes de esta regla se pueden seguir editando.
 */
async function assertCanSellPaid(ctx: any, event: any, change: { id?: number; price?: number; total_quantity?: number | null }) {
    if (event.status !== "published") return;
    const current = await loadCapacityTickets(ctx.supabase, Number(event.id));
    if (ticketsRequireIdentity(current)) return;
    const next = change.id
        ? current.map((t) => (Number(t.id) === Number(change.id) ? { ...t, ...change } : t))
        : [...current, { ...change, is_gift: false }];
    if (!ticketsRequireIdentity(next)) return;
    if (!identityApproved(await loadOrgIdentity(ctx.supabase, ctx.actor.orgId))) throw new ToolError("conflict", IDENTITY_REQUIRED_MESSAGE);
}

const ticketIdSchema = { type: "integer" as const, minimum: 1, description: "ID del tipo de entrada (ver get_event → ticket_types)." };

async function loadTicket(ctx: any, eventId: number, ticketId: number, { allowSystem = false } = {}) {
    const { data } = await ctx.supabase.from("event_tickets").select(TICKET_SELECT).eq("id", ticketId).eq("event_id", eventId).maybeSingle();
    if (!data) throw new ToolError("not_found", `El tipo de entrada ${ticketId} no existe en el evento ${eventId}.`);
    if (data.is_gift === true && !allowSystem) {
        throw new ToolError("invalid_input", `El tipo ${ticketId} (${data.ticket_name}) es el de cortesías del sistema: no se edita ni se vende. Para cortesías usa issue_complimentary_tickets.`);
    }
    return data;
}

const FIELD_LABELS: Record<string, string> = {
    ticket_name: "Nombre", price: "Precio", total_quantity: "Capacidad", max_quantity: "Máximo por compra", status: "Venta", init_date: "Inicio de venta", end_date: "Fin de venta",
    opens_after_ticket_id: "Se abre tras", people_per_ticket: "Personas por entrada", entry_until: "Ingreso hasta",
};
const fmtField = (field: string, v: unknown) =>
    v == null ? "—" : field === "price" ? clp(Number(v)).replace(" CLP", "") : field === "status" ? (v === "available" ? "activa" : "pausada") : String(v);

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

// Tandas encadenadas (event_tickets.opens_after_ticket_id, migración 202610290100)
const opensAfterSchema = {
    type: "integer" as const,
    minimum: 1,
    nullable: true,
    description:
        "Tanda anterior (otro tipo de entrada del evento): este tipo se abre solo cuando esa se agota o cierra su venta. " +
        "La anterior necesita cupo o fecha de cierre. null = quitar el encadenamiento.",
};

// Mesa para N (event_tickets.people_per_ticket, migración 202610300110)
const peoplePerTicketSchema = {
    type: "integer" as const,
    minimum: 1,
    maximum: MAX_PEOPLE_PER_TICKET,
    description:
        "Personas por entrada (mesa para N): cada unidad vendida emite un QR por persona, que se validan uno por uno. Precio, capacidad y " +
        "máximo por compra siguen siendo por mesa. 1 = entrada normal. Un cambio aplica solo a compras nuevas.",
};

async function assertPeopleColumn(ctx: any) {
    const { error } = await ctx.supabase.from("event_tickets").select("people_per_ticket").limit(1);
    if (error) throw new ToolError("unavailable", "Las mesas para varias personas estarán disponibles después del próximo deploy.");
}

async function assertChainable(ctx: any, eventId: number, ticketId: number | null, prevId: number | null) {
    const { error: columnError } = await ctx.supabase.from("event_tickets").select("opens_after_ticket_id").limit(1);
    if (columnError) throw new ToolError("unavailable", "Las tandas que se abren solas estarán disponibles después del próximo deploy.");
    const [{ data: tickets }, chain] = await Promise.all([
        ctx.supabase.from("event_tickets").select(TICKET_SELECT).eq("event_id", eventId),
        loadTicketChain(ctx.supabase, eventId),
    ]);
    const reason = chainError(tickets || [], chain, ticketId ?? 0, prevId);
    if (reason) throw new ToolError("invalid_input", reason);
    return chain;
}

// Hora límite de ingreso (event_tickets.entry_until, migración 202610300300)
const entryUntilSchema = {
    type: "string" as const,
    pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
    nullable: true,
    description:
        "Hora límite de ingreso \"HH:MM\" (hora de Chile, p. ej. la lista hasta las 01:00). Si es anterior al inicio de la función, es de la " +
        "madrugada siguiente. Pasada esa hora el escáner marca la entrada \"fuera de horario\" y la puerta decide. null = entra a cualquier hora.",
};

/** Guarda la hora límite (columna aparte: sin la migración avisa en vez de fallar el resto del cambio). */
async function saveEntryUntil(ctx: any, eventId: number, ticketId: number, value: string | null) {
    const { error } = await ctx.supabase.from("event_tickets").update({ entry_until: normalizeEntryUntil(value) }).eq("id", ticketId).eq("event_id", eventId);
    if (error) {
        if (["42703", "PGRST204"].includes(String(error.code || ""))) throw new ToolError("unavailable", "La hora límite de ingreso estará disponible después del próximo deploy.");
        throw error;
    }
}

async function presentWithChain(ctx: any, event: any, row: any, availability?: Map<number, { sold: number; pending: number }>) {
    const { data: tickets } = await ctx.supabase.from("event_tickets").select(TICKET_SELECT).eq("event_id", event.id);
    const avail = availability || (await ticketAvailability(ctx, event.id, (tickets || []).map((t: any) => Number(t.id))));
    const chainOf = await ticketChainInfo(ctx, Number(event.id), tickets || [], avail);
    return presentTicket(row, avail.get(Number(row.id)), event, chainOf(row.id));
}

const createTicketType: ToolDef = {
    name: "create_ticket_type",
    title: "Crear tipo de entrada",
    description: "Agrega un tipo de entrada a un evento (ej: Preventa 2, VIP). Precio en CLP. No uses el nombre \"Cortesía\": ese tipo ya lo crea el sistema. " +
        "Para que una tanda se abra sola al agotarse la anterior, pasa opens_after_ticket_type_id. Para una mesa o pack para varias personas " +
        "(un QR por persona), pasa people_per_ticket. Para una lista con hora de ingreso (\"lista hasta las 01:00\"), pasa entry_until.",
    scope: "write",
    audit: (args, result) => ({ summary: `Nuevo tipo ${args.name}: ${clp(args.price).replace(" CLP", "")}`, target: `ticket_type:${(result as any).ticket_type?.id ?? ""}` }),
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
            opens_after_ticket_type_id: opensAfterSchema,
            people_per_ticket: peoplePerTicketSchema,
            entry_until: entryUntilSchema,
        },
    },
    async handler(args, ctx) {
        rejectCourtesyName(args.name);
        const people = args.people_per_ticket && args.people_per_ticket > 1 ? Math.min(args.people_per_ticket, MAX_PEOPLE_PER_TICKET) : null;
        if (people) await assertPeopleColumn(ctx);
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, status");
        const normalized = normalizeTicket({ name: args.name, price: args.price, quantity: args.quantity ?? null, initDate: args.sales_start, endDate: args.sales_end });
        if (!normalized) throw new ToolError("invalid_input", "Revisa nombre, precio y cantidad.");
        checkWindow(normalized.init_date, normalized.end_date);
        await assertCanSellPaid(ctx, event, { price: normalized.price, total_quantity: normalized.total_quantity });
        const functionId = await resolveFunctionId(ctx, event.id, args.function_id);
        const prevId = args.opens_after_ticket_type_id ?? null;
        if (prevId != null) await assertChainable(ctx, event.id, null, prevId);
        const { data, error } = await ctx.supabase
            .from("event_tickets")
            .insert({
                ...normalized,
                event_id: event.id,
                event_date_id: functionId ?? null,
                max_quantity: args.max_per_order,
                is_gift: false,
                status: "available",
                ...(prevId != null ? { opens_after_ticket_id: prevId } : {}),
                ...(people ? { people_per_ticket: people } : {}),
            })
            .select(TICKET_SELECT)
            .single();
        if (error) throw error;
        const entryUntil = normalizeEntryUntil(args.entry_until);
        if (entryUntil) await saveEntryUntil(ctx, Number(event.id), Number(data.id), entryUntil);
        const ticketType = prevId != null || entryUntil ? await presentWithChain(ctx, event, data) : presentTicket(data, undefined, event);
        return { event_id: Number(event.id), ticket_type: people ? { ...ticketType, people_per_ticket: people } : ticketType };
    },
};

const updateTicketType: ToolDef = {
    name: "update_ticket_type",
    title: "Editar tipo de entrada",
    description:
        "Cambia nombre, precio, capacidad, ventana de venta, pausa/reanuda la venta (on_sale), encadena la tanda a la anterior " +
        "(opens_after_ticket_type_id: se abre sola cuando esa se agota), las personas por entrada (people_per_ticket: mesa para N) " +
        "o la hora límite de ingreso (entry_until) de un tipo de entrada. " +
        "La capacidad no puede quedar bajo lo ya vendido. Un cambio de precio aplica solo a compras nuevas.",
    scope: "write",
    audit: (args, result) => {
        const changes: any[] = (result as any).changes || [];
        const name = (result as any).ticket_type?.name || `tipo ${args.ticket_type_id}`;
        return {
            summary: changes.length ? `${name}: ${changes.map((c) => `${FIELD_LABELS[c.field] || c.field} ${fmtField(c.field, c.from)} → ${fmtField(c.field, c.to)}`).join("; ")}` : `${name}: sin cambios`,
            target: `ticket_type:${args.ticket_type_id}`,
        };
    },
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
            opens_after_ticket_type_id: opensAfterSchema,
            people_per_ticket: peoplePerTicketSchema,
            entry_until: entryUntilSchema,
        },
    },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, status");
        const ticket = await loadTicket(ctx, event.id, args.ticket_type_id);
        if (args.people_per_ticket !== undefined) {
            await assertPeopleColumn(ctx);
            const { data: current } = await ctx.supabase.from("event_tickets").select("people_per_ticket").eq("id", ticket.id).maybeSingle();
            (ticket as any).people_per_ticket = Number(current?.people_per_ticket) || 1;
        }
        // La hora límite va aparte (columna nueva): sin migración el resto del cambio no se pierde
        let entryChange: { field: string; from: string | null; to: string | null } | null = null;
        if (args.entry_until !== undefined) {
            const before = (await loadEntryDeadlines(ctx.supabase, Number(event.id))).get(Number(ticket.id)) ?? null;
            const to = normalizeEntryUntil(args.entry_until);
            await saveEntryUntil(ctx, Number(event.id), Number(ticket.id), to);
            if (before !== to) entryChange = { field: "entry_until", from: before, to };
        }
        const patch: Record<string, unknown> = {};
        if (args.name !== undefined) {
            rejectCourtesyName(args.name);
            patch.ticket_name = args.name.slice(0, 120);
        }
        if (args.price !== undefined) {
            patch.price = Math.round(args.price);
        }
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
        if (args.opens_after_ticket_type_id !== undefined) {
            const chain = await assertChainable(ctx, event.id, Number(ticket.id), args.opens_after_ticket_type_id);
            (ticket as any).opens_after_ticket_id = chain.get(Number(ticket.id)) ?? null;
            patch.opens_after_ticket_id = args.opens_after_ticket_type_id;
        }
        if (args.people_per_ticket !== undefined) patch.people_per_ticket = Math.min(Math.max(1, args.people_per_ticket), MAX_PEOPLE_PER_TICKET);
        if (!Object.keys(patch).length) {
            if (args.entry_until === undefined) throw new ToolError("invalid_input", "No enviaste cambios.");
            return { event_id: Number(event.id), ticket_type: await presentWithChain(ctx, event, ticket), changes: entryChange ? [entryChange] : [] };
        }
        if (patch.price !== undefined || patch.total_quantity !== undefined) {
            const change: { id: number; price?: number; total_quantity?: number | null } = { id: Number(ticket.id) };
            if (patch.price !== undefined) change.price = patch.price as number;
            if (patch.total_quantity !== undefined) change.total_quantity = patch.total_quantity as number | null;
            await assertCanSellPaid(ctx, event, change);
        }
        const { data, error } = await ctx.supabase
            .from("event_tickets")
            .update(patch)
            .eq("id", ticket.id)
            .eq("event_id", event.id)
            .select(TICKET_SELECT)
            .single();
        if (error) throw error;
        const changes = Object.keys(patch)
            .filter((k) => String((ticket as any)[k] ?? "") !== String(patch[k] ?? ""))
            .map((k) => ({ field: k, from: (ticket as any)[k] ?? null, to: patch[k] ?? null }));
        if (entryChange) changes.push(entryChange);
        const presented = await presentWithChain(ctx, event, data);
        return {
            event_id: Number(event.id),
            ticket_type: patch.people_per_ticket !== undefined ? { ...presented, people_per_ticket: patch.people_per_ticket } : presented,
            changes,
        };
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
    audit: (args, result) => ({
        summary: `${(result as any).ticket_type_name || `Tipo ${args.ticket_type_id}`}: ${(result as any).result === "deleted" ? "eliminado" : "retirado de la venta (tenía entradas emitidas)"}`,
        target: `ticket_type:${args.ticket_type_id}`,
    }),
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
            return { event_id: Number(event.id), ticket_type_id: Number(ticket.id), ticket_type_name: ticket.ticket_name, result: "retired_from_sale", reason: "Tiene entradas emitidas u órdenes asociadas." };
        };
        if (sold) return retire();
        const { error } = await ctx.supabase.from("event_tickets").delete().eq("id", ticket.id).eq("event_id", event.id);
        if (error) return retire(); // p. ej. referenciada por una orden
        return { event_id: Number(event.id), ticket_type_id: Number(ticket.id), ticket_type_name: ticket.ticket_name, result: "deleted" };
    },
};

const ORDER_STATUSES = ["paid", "pending", "refunded", "expired", "failed", "all"] as const;

const listOrders: ToolDef = {
    name: "list_orders",
    title: "Listar órdenes",
    description:
        "Órdenes de un evento con datos del comprador (nombre, email, teléfono), entradas, monto, descuento, canal de origen, datos de empresa " +
        "(company: razón social y RUT, si los dio; no es boleta ni factura) y respuestas a las preguntas del evento (answers). " +
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
        const ORDER_COLUMNS = "id, created_at, status, amount, ticket_qty, ticket_fee, service_fee_tax, discount_code, discount_amount, ticket_details, buyer_first_name, buyer_last_name, buyer_email, buyer_phone, ref, utm_source, utm_medium, utm_campaign, payment_provider";
        const runQuery = (cols: string) => {
            let query = ctx.supabase
                .from("event_orders")
                .select(cols, { count: "exact" })
                .eq("event_id", event.id)
                .order("created_at", { ascending: false })
                .range(args.offset, args.offset + args.limit - 1);
            if (args.status !== "all") query = query.eq("status", args.status);
            if (args.search) query = query.ilike("buyer_email", `%${args.search.replace(/[%_\\]/g, (c: string) => `\\${c}`)}%`);
            return query;
        };
        // Datos de empresa y respuestas: columnas opcionales (migración 202610300100)
        let { data, error, count } = await runQuery(`${ORDER_COLUMNS}, registration_answers, company_rut, company_name`);
        if (error && ["42703", "PGRST204"].includes(String(error.code || ""))) ({ data, error, count } = await runQuery(ORDER_COLUMNS));
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
                // quantity = entradas que la orden tiene hoy; transferred_out = las que salieron a otro titular
                lines: Array.isArray(o.ticket_details)
                    ? o.ticket_details.map((l: any) => ({
                          name: l.name || l.ticket_name,
                          quantity: l.quantity,
                          price: l.price,
                          ...(Number(l.people) > 1 ? { people_per_ticket: Number(l.people) } : {}),
                          ...(Number(l.transferred_out) ? { transferred_out: Number(l.transferred_out) } : {}),
                          ...(l.complimentary ? { complimentary: true } : {}),
                      }))
                    : null,
                ...(isTransferOrder(o) ? { transferred_from_order_id: o.ticket_details[0].transferred_from_order } : {}),
                amount_clp: Number(o.amount) || 0,
                discount_code: o.discount_code || null,
                discount_clp: Number(o.discount_amount) || 0,
                payment: o.payment_provider || null,
                channel: o.ref ? `ref:${o.ref}` : [o.utm_source, o.utm_medium, o.utm_campaign].filter(Boolean).join(" / ") || "directo",
                ...(o.company_rut ? { company: { name: o.company_name || null, rut: formatRut(o.company_rut) } } : {}),
                ...(Array.isArray(o.registration_answers) && o.registration_answers.length
                    ? { answers: o.registration_answers.map((a: any) => ({ question: a.question, answer: a.answer })) }
                    : {}),
            })),
        };
    },
};

export const ticketTools: ToolDef[] = [createTicketType, updateTicketType, deleteTicketType, listOrders];
