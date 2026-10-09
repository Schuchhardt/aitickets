// Herramientas de postventa: detalle de una orden, reenvío y transferencia de entradas, reembolsos y
// cancelación de un evento.
//
// Reembolsos: aquí se anulan las entradas y queda la solicitud en aitickets_refunds (status 'requested');
// AI Tickets devuelve el dinero con el medio de pago original (Flow) y la marca 'completed'. El precio de las
// entradas reembolsadas es de cargo del productor (términos de productores): se descuenta de lo que aún no
// se le ha transferido de ese evento, por eso no se permite reembolsar más que eso desde la API.
//
// Cargo absorbido (event_orders.fee_absorbed): el comprador pagó un solo precio (total_payment = amount +
// cargo + IVA). Al reembolsar se le devuelve lo que pagó (proporcional en parciales): el productor devuelve
// su neto (ticket_amount, de su saldo) y AI Tickets devuelve el cargo (fee_amount), igual que en una
// cancelación. Por eso refund_service_fee no aplica a esas órdenes.
//
// Concurrencia: las entradas se anulan con un UPDATE condicionado a que sigan vigentes y con conteo exacto;
// si otra operación ya anuló alguna, esta revierte lo suyo y aborta. El registro del reembolso se inserta
// solo después de anular con éxito.
import { ToolError, type ToolDef, type ToolContext } from "../registry";
import { eventIdSchema, loadOwnedEvent, fetchAll, clp } from "./common";
import { isActiveRefund } from "../ledger";
import { findOrCreateAttendee, newQrCode } from "../../courtesy";
import { sendTicketsEmail, notifySlack, callInternalFunction } from "../../../pages/api/_lib/server-utils";
import { sendEmail, formatRecipient, isValidEmail, legalFooterHtml, legalFooterText } from "../../../../netlify/lib/mailer.mjs";

const UUID_PATTERN = "^[0-9a-fA-F-]{36}$";
const orderIdSchema = { type: "string" as const, pattern: UUID_PATTERN, description: "ID de la orden (uuid; ver list_orders o get_order)." };

const ACTIVE_REFUND = isActiveRefund;
const isMissingTable = (error: any) => ["42P01", "PGRST205", "42703", "PGRST204"].includes(String(error?.code || ""));
const esc = (v: unknown) =>
    String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const buyerName = (o: any) => [o.buyer_first_name, o.buyer_last_name].filter(Boolean).join(" ") || null;
const ticketStatus = (s: string | null | undefined) => s || "active";

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------

/** Orden de un evento accesible para el actor (verifica organización y acceso por evento). */
async function loadOrder(ctx: ToolContext, orderId: string) {
    const { data: order, error } = await ctx.supabase.from("event_orders").select("*").eq("id", orderId).maybeSingle();
    if (error) throw error;
    if (!order) throw new ToolError("not_found", "Orden no encontrada (ver list_orders).");
    const event = await loadOwnedEvent<any>(ctx, Number(order.event_id), "id, name, slug, status, organization_id, cancelled_at").catch(() => {
        throw new ToolError("not_found", "Orden no encontrada en tu organización.");
    });
    return { order, event };
}

async function loadOrderTickets(ctx: ToolContext, orderId: string) {
    const { data, error } = await ctx.supabase
        .from("event_attendees")
        .select("id, event_ticket_id, attendee_id, status, validated_at, is_complimentary")
        .eq("event_order_id", orderId);
    if (error) throw error;
    const rows = (data || []) as any[];
    const typeIds = [...new Set(rows.map((r) => Number(r.event_ticket_id)).filter(Boolean))];
    const names = new Map<number, string>();
    if (typeIds.length) {
        const { data: types } = await ctx.supabase.from("event_tickets").select("id, ticket_name").in("id", typeIds);
        for (const t of types || []) names.set(Number(t.id), t.ticket_name);
    }
    return rows.map((r) => ({ ...r, ticket_name: names.get(Number(r.event_ticket_id)) || "Entrada" }));
}

async function loadRefunds(ctx: ToolContext, filter: { orderId?: string; eventId?: number }) {
    let q = ctx.supabase.from("aitickets_refunds").select("*");
    if (filter.orderId) q = q.eq("order_id", filter.orderId);
    if (filter.eventId) q = q.eq("event_id", filter.eventId);
    const { data, error } = await q;
    if (error) {
        if (isMissingTable(error)) return [];
        throw error;
    }
    return (data || []) as any[];
}

function presentOrder(o: any, tickets: any[], refunds: any[]) {
    return {
        id: o.id,
        event_id: Number(o.event_id),
        created_at: o.created_at,
        status: o.status,
        buyer: { name: buyerName(o), email: o.buyer_email || null, phone: o.buyer_phone || null },
        amounts: {
            tickets_clp: Number(o.amount) || 0,
            service_fee_clp: (Number(o.ticket_fee) || 0) + (Number(o.service_fee_tax) || 0),
            paid_by_buyer_clp: o.total_payment != null ? Number(o.total_payment) : null,
            discount_code: o.discount_code || null,
            discount_clp: Number(o.discount_amount) || 0,
            fee_absorbed_by_producer: Boolean(o.fee_absorbed),
        },
        payment: { provider: o.payment_provider || null, reference: o.payment_external_id || null },
        channel: o.ref ? `ref:${o.ref}` : [o.utm_source, o.utm_medium, o.utm_campaign].filter(Boolean).join(" / ") || "directo",
        tickets_email_sent_at: o.email_sent_at || null,
        refunded_at: o.refunded_at || null,
        tickets: tickets.map((t) => ({
            ticket_id: t.id,
            type: t.ticket_name,
            ticket_type_id: Number(t.event_ticket_id) || null,
            status: ticketStatus(t.status),
            checked_in_at: t.validated_at || null,
            complimentary: Boolean(t.is_complimentary),
        })),
        refunds: refunds.map((r) => ({
            id: r.id,
            kind: r.kind,
            status: r.status,
            tickets_clp: Number(r.ticket_amount) || 0,
            service_fee_clp: Number(r.fee_amount) || 0,
            total_clp: Number(r.total_amount) || 0,
            reason: r.reason || null,
            created_at: r.created_at,
        })),
        order_url_for_buyer: null as string | null,
    };
}

// ---------------------------------------------------------------------------
// get_order / resend_tickets
// ---------------------------------------------------------------------------

const getOrder: ToolDef = {
    name: "get_order",
    title: "Detalle de una orden",
    description:
        "Detalle de una orden para resolver el reclamo de un comprador: entradas (id, tipo, estado, si ya ingresó), montos, pago, reembolsos y canal. " +
        "Busca por order_id, o por event_id + buyer_email (devuelve hasta 10 órdenes). Contiene datos personales.",
    scope: "attendees",
    permission: "attendees.read",
    annotations: { readOnlyHint: true },
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            order_id: orderIdSchema,
            event_id: eventIdSchema,
            buyer_email: { type: "string", maxLength: 200, description: "Email exacto del comprador (requiere event_id)." },
        },
    },
    async handler(args, ctx) {
        let orders: any[];
        if (args.order_id) {
            orders = [(await loadOrder(ctx, args.order_id)).order];
        } else {
            if (!args.event_id || !args.buyer_email) throw new ToolError("invalid_input", "Indica order_id, o event_id + buyer_email.");
            const event = await loadOwnedEvent<any>(ctx, args.event_id, "id");
            const email = String(args.buyer_email).trim().toLowerCase().replace(/[\\%_]/g, "\\$&");
            const { data, error } = await ctx.supabase
                .from("event_orders")
                .select("*")
                .eq("event_id", event.id)
                .ilike("buyer_email", email)
                .order("created_at", { ascending: false })
                .limit(10);
            if (error) throw error;
            orders = data || [];
            if (!orders.length) throw new ToolError("not_found", "No hay órdenes con ese email en este evento.");
        }
        const out = [];
        for (const o of orders) {
            const view = presentOrder(o, await loadOrderTickets(ctx, o.id), await loadRefunds(ctx, { orderId: o.id }));
            view.order_url_for_buyer = `${ctx.origin}/order/${o.id}`;
            out.push(view);
        }
        return { count: out.length, orders: out };
    },
};

const resendTickets: ToolDef = {
    name: "resend_tickets",
    title: "Reenviar entradas",
    description: "Reenvía al comprador el correo con sus entradas (\"no me llegó la entrada\"). Solo órdenes pagadas; las reembolsadas tienen las entradas anuladas.",
    scope: "attendees",
    permission: "orders.support",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: { type: "object", required: ["order_id"], additionalProperties: false, properties: { order_id: orderIdSchema } },
    audit: (args) => ({ summary: "Entradas reenviadas", target: `order:${args.order_id}` }),
    async handler(args, ctx) {
        const { order } = await loadOrder(ctx, args.order_id);
        if (order.status === "refunded") throw new ToolError("conflict", "La orden fue reembolsada: sus entradas están anuladas.");
        if (order.status !== "paid") throw new ToolError("conflict", "Solo se pueden reenviar órdenes pagadas.");
        const result = await sendTicketsEmail(ctx.requestUrl, order.id, true);
        if (!result.ok) throw new ToolError("upstream", result.data?.message || "No se pudo reenviar el correo. Intenta nuevamente.");
        return { order_id: order.id, event_id: Number(order.event_id), sent_to: order.buyer_email || null, status: "sent" };
    },
};

// ---------------------------------------------------------------------------
// transfer_ticket
// ---------------------------------------------------------------------------

const transferTicket: ToolDef = {
    name: "transfer_ticket",
    title: "Transferir entrada",
    description:
        "Cambia el titular de UNA entrada (ticket_id de get_order): la entrada pasa a una orden nueva a nombre del nuevo titular, se genera un QR nuevo " +
        "(el anterior deja de servir) y se le envía por correo. No se puede transferir una entrada ya usada o anulada. Usa idempotency_key.",
    scope: "attendees",
    permission: "orders.support",
    idempotent: true,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    inputSchema: {
        type: "object",
        required: ["ticket_id", "new_holder_name", "new_holder_email"],
        additionalProperties: false,
        properties: {
            ticket_id: { type: "string", pattern: UUID_PATTERN, description: "ID de la entrada (get_order → tickets[].ticket_id)." },
            new_holder_name: { type: "string", minLength: 1, maxLength: 200 },
            new_holder_email: { type: "string", maxLength: 200 },
            send_email: { type: "boolean", default: true, description: "Enviar la entrada al nuevo titular." },
        },
    },
    audit: (args, result) => ({ summary: "Entrada transferida", target: `ticket:${args.ticket_id} → order:${(result as any).new_order_id}` }),
    async handler(args, ctx) {
        const email = String(args.new_holder_email).trim().toLowerCase();
        if (!isValidEmail(email)) throw new ToolError("invalid_input", "Email del nuevo titular inválido.");
        const { data: ticket, error } = await ctx.supabase
            .from("event_attendees")
            .select("id, event_id, event_ticket_id, event_order_id, status, validated_at, is_complimentary")
            .eq("id", args.ticket_id)
            .maybeSingle();
        if (error) throw error;
        if (!ticket?.event_order_id) throw new ToolError("not_found", "Entrada no encontrada (ver get_order).");
        const { order, event } = await loadOrder(ctx, ticket.event_order_id);
        if (Number(ticket.event_id) !== Number(event.id)) throw new ToolError("not_found", "Entrada no encontrada.");
        if (order.status !== "paid") throw new ToolError("conflict", "Solo se pueden transferir entradas de órdenes pagadas.");
        const status = ticketStatus(ticket.status);
        if (status === "validated") throw new ToolError("conflict", "La entrada ya se usó para ingresar: no se puede transferir.");
        if (status !== "active") throw new ToolError("conflict", `La entrada no está vigente (estado: ${status}).`);

        const { data: type } = await ctx.supabase.from("event_tickets").select("id, ticket_name").eq("id", ticket.event_ticket_id).maybeSingle();
        const [firstName, ...rest] = String(args.new_holder_name).trim().split(/\s+/);
        const lastName = rest.join(" ").slice(0, 100) || null;
        const attendeeId = await findOrCreateAttendee(ctx.supabase, { firstName: firstName.slice(0, 100), lastName, email });

        // Orden nueva (monto 0) para el nuevo titular: su link /order/<id> y su correo muestran SOLO esta entrada.
        const orderRow: Record<string, unknown> = {
            event_id: event.id,
            attendee_id: attendeeId,
            status: "paid",
            amount: 0,
            payment_fee: 0,
            ticket_fee: 0,
            total_payment: 0,
            balance: 0,
            ticket_qty: 1,
            buyer_first_name: firstName.slice(0, 100),
            buyer_last_name: lastName,
            buyer_email: email,
            ticket_details: [
                {
                    id: Number(ticket.event_ticket_id),
                    name: type?.ticket_name || "Entrada",
                    price: 0,
                    quantity: 1,
                    total: 0,
                    transferred_from_order: order.id,
                    transferred_by: ctx.actor.userId,
                    ...(ticket.is_complimentary ? { complimentary: true } : {}),
                },
            ],
        };
        let { data: newOrder, error: orderError } = await ctx.supabase
            .from("event_orders")
            .insert({ ...orderRow, payment_provider: "free", currency: "CLP" })
            .select("id")
            .single();
        if (orderError && ["42703", "PGRST204"].includes(String(orderError.code || ""))) {
            ({ data: newOrder, error: orderError } = await ctx.supabase.from("event_orders").insert(orderRow).select("id").single());
        }
        if (orderError || !newOrder) throw orderError || new Error("No se pudo crear la orden del nuevo titular");

        const moveQuery = ctx.supabase
            .from("event_attendees")
            .update({ attendee_id: attendeeId, event_order_id: newOrder.id, qr_code: newQrCode() }, { count: "exact" })
            .eq("id", ticket.id)
            .eq("event_order_id", order.id);
        // Solo si sigue vigente (status NULL en entradas antiguas = activa)
        const { count: moved, error: moveError } = await (ticket.status == null ? moveQuery.is("status", null) : moveQuery.eq("status", ticket.status));
        if (moveError || !moved) {
            await ctx.supabase.from("event_orders").delete().eq("id", newOrder.id).eq("event_id", event.id);
            if (moveError) throw moveError;
            throw new ToolError("conflict", "La entrada cambió mientras se transfería (¿se validó?). Revisa get_order e intenta de nuevo.");
        }
        // La entrada ya no cuenta en la orden original (las ventas e ingresos no cambian: la orden nueva es de monto 0)
        await ctx.supabase
            .from("event_orders")
            .update({ ticket_qty: Math.max(0, (Number(order.ticket_qty) || 1) - 1) })
            .eq("id", order.id);

        let emailSent = false;
        if (args.send_email !== false) emailSent = (await sendTicketsEmail(ctx.requestUrl, newOrder.id)).ok;
        return {
            event_id: Number(event.id),
            ticket_id: ticket.id,
            from_order_id: order.id,
            new_order_id: newOrder.id,
            new_holder: { name: args.new_holder_name, email },
            previous_qr_valid: false,
            email_sent: emailSent,
            order_url_for_new_holder: `${ctx.origin}/order/${newOrder.id}`,
            ...(args.send_email !== false && !emailSent ? { note: "No se pudo enviar el correo: usa resend_tickets con new_order_id." } : {}),
        };
    },
};

// ---------------------------------------------------------------------------
// Saldo de un evento (lo que el productor aún no ha retirado)
// ---------------------------------------------------------------------------

/** Ventas pagadas − reembolsos parciales de órdenes pagadas − retiros (solicitados, en proceso o pagados). */
export async function eventUnwithdrawnBalance(ctx: ToolContext, eventId: number) {
    const orders = await fetchAll<any>(() => ctx.supabase.from("event_orders").select("id, amount").eq("event_id", eventId).eq("status", "paid"));
    const paidIds = new Set(orders.map((o) => String(o.id)));
    const sales = orders.reduce((n, o) => n + (Number(o.amount) || 0), 0);
    const refunds = (await loadRefunds(ctx, { eventId })).filter((r) => ACTIVE_REFUND(r) && paidIds.has(String(r.order_id)));
    const refunded = refunds.reduce((n, r) => n + (Number(r.ticket_amount) || 0), 0);
    const { data: withdrawals, error } = await ctx.supabase
        .from("event_withdrawals")
        .select("amount, status")
        .eq("event_id", eventId)
        .in("status", ["requested", "processing", "paid"]);
    if (error && !isMissingTable(error)) throw error;
    const withdrawn = (withdrawals || []).reduce((n: number, w: any) => n + (Number(w.amount) || 0), 0);
    return { sales, refunded, withdrawn, available: sales - refunded - withdrawn };
}

// ---------------------------------------------------------------------------
// refund_order
// ---------------------------------------------------------------------------

type RefundPlan = {
    order: any;
    event: any;
    selected: any[];
    /** Reembolso de toda la orden: la orden pasa a 'refunded'. */
    full: boolean;
    /** Entradas que salieron de la orden por transferencia y siguen fuera de ella (no se reembolsan aquí). */
    transferredOut: number;
    feeAbsorbed: boolean;
    ticketAmount: number;
    feeAmount: number;
    total: number;
    validatedCount: number;
    balance: Awaited<ReturnType<typeof eventUnwithdrawnBalance>>;
};

/** Calcula el reembolso (sin escribir nada). Lo usan la confirmación y la ejecución. */
async function planRefund(args: any, ctx: ToolContext): Promise<RefundPlan> {
    const { order, event } = await loadOrder(ctx, args.order_id);
    if (order.status === "refunded") throw new ToolError("conflict", "Esta orden ya fue reembolsada por completo.");
    if (order.status !== "paid") throw new ToolError("conflict", `Solo se reembolsan órdenes pagadas (estado actual: ${order.status}).`);
    const tickets = await loadOrderTickets(ctx, order.id);
    const live = tickets.filter((t) => ticketStatus(t.status) !== "cancelled");
    if (!live.length) throw new ToolError("conflict", "La orden no tiene entradas vigentes para reembolsar.");
    let selected = live;
    if (args.ticket_ids?.length) {
        const wanted = new Set(args.ticket_ids.map((id: string) => id.toLowerCase()));
        selected = live.filter((t) => wanted.has(String(t.id).toLowerCase()));
        if (selected.length !== wanted.size) throw new ToolError("invalid_input", "Algún ticket_id no pertenece a esta orden o ya está anulado (ver get_order).");
    }
    const validatedCount = selected.filter((t) => ticketStatus(t.status) === "validated").length;
    if (validatedCount && !args.force) {
        throw new ToolError("conflict", `${validatedCount} entrada(s) ya se usaron para ingresar. Si igual corresponde reembolsar, repite con force=true.`);
    }

    const amount = Number(order.amount) || 0;
    const feeTotal = (Number(order.ticket_fee) || 0) + (Number(order.service_fee_tax) || 0);
    const lines: any[] = Array.isArray(order.ticket_details) ? order.ticket_details : [];
    const priceByType = new Map(lines.map((l) => [Number(l?.id), Number(l?.price) || 0]));
    const gross = lines.reduce((n, l) => n + (Number(l?.total) || (Number(l?.price) || 0) * (Number(l?.quantity) || 0)), 0);
    const qtyInDetails = lines.reduce((n, l) => n + (Number(l?.quantity) || 0), 0);
    const prior = (await loadRefunds(ctx, { orderId: order.id })).filter(ACTIVE_REFUND);
    const priorTickets = prior.reduce((n, r) => n + (Number(r.ticket_amount) || 0), 0);
    const priorFee = prior.reduce((n, r) => n + (Number(r.fee_amount) || 0), 0);

    // Entradas transferidas a otro titular salieron de la orden (orden nueva de $0) pero siguen valiendo: su
    // valor sigue en amount. Si quedan fuera, reembolsar "todo lo que queda" es PARCIAL (la orden sigue 'paid'
    // y el saldo conserva el valor de las entradas transferidas).
    const transferredOut = Math.max(0, qtyInDetails - tickets.length);
    const full = selected.length === live.length && transferredOut === 0;
    const feeAbsorbed = Boolean(order.fee_absorbed);
    // Cargo absorbido: el comprador pagó un precio único, siempre se le devuelve completo (cargo incluido)
    const refundFee = feeAbsorbed || Boolean(args.refund_service_fee);
    let ticketAmount: number;
    let feeAmount: number;
    if (full) {
        // Toda la orden: el total "restante" evita diferencias de redondeo
        ticketAmount = Math.max(0, amount - priorTickets);
        feeAmount = refundFee ? Math.max(0, feeTotal - priorFee) : 0;
    } else {
        const value = selected.reduce((n, t) => n + (priceByType.get(Number(t.event_ticket_id)) || 0), 0);
        const share = gross > 0 ? value / gross : qtyInDetails > 0 ? selected.length / qtyInDetails : 0;
        ticketAmount = Math.min(Math.max(0, amount - priorTickets), Math.round(amount * share));
        feeAmount = refundFee ? Math.min(Math.max(0, feeTotal - priorFee), Math.round(feeTotal * share)) : 0;
    }
    const balance = await eventUnwithdrawnBalance(ctx, Number(event.id));
    if (ticketAmount > balance.available) {
        throw new ToolError(
            "conflict",
            `El reembolso (${clp(ticketAmount)} del valor de las entradas) supera lo que aún no se te ha transferido de este evento (${clp(Math.max(0, balance.available))}). ` +
                "Escríbenos a soporte de AI Tickets para coordinarlo: el valor de las entradas reembolsadas es de cargo del productor.",
        );
    }
    return { order, event, selected, full, transferredOut, feeAbsorbed, ticketAmount, feeAmount, total: ticketAmount + feeAmount, validatedCount, balance };
}

async function emailRefundToBuyer(plan: RefundPlan, reason: string | null) {
    const email = plan.order.buyer_email;
    if (!email || !isValidEmail(email)) return false;
    const name = plan.order.buyer_first_name || "hola";
    const what = plan.full ? "tu compra" : `${plan.selected.length} entrada(s) de tu compra`;
    const money = plan.total > 0 ? ` La devolución de ${clp(plan.total)} se hará al mismo medio de pago; el plazo en que se refleja depende de tu banco o emisor.` : "";
    const subject = `Reembolso de ${plan.event.name}`;
    const text = `Hola ${name}:\n\nSe reembolsó ${what} para ${plan.event.name}. Esas entradas quedaron anuladas y su QR ya no permite el ingreso.${money}${reason ? `\n\nMotivo: ${reason}` : ""}\n\nOrden: ${plan.order.id}\n\n${legalFooterText()}`;
    const html =
        `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:#111827;max-width:560px;margin:0 auto">` +
        `<p>Hola ${esc(name)}:</p><p>Se reembolsó ${esc(what)} para <strong>${esc(plan.event.name)}</strong>. Esas entradas quedaron anuladas y su QR ya no permite el ingreso.${esc(money)}</p>` +
        `${reason ? `<p>Motivo: ${esc(reason)}</p>` : ""}<p style="font-size:13px;color:#6b7280">Orden: ${esc(plan.order.id)}</p>${legalFooterHtml()}</div>`;
    try {
        await sendEmail({ to: formatRecipient(buyerName(plan.order) || "", email), subject, html, text, tags: ["refund"] });
        return true;
    } catch (err: any) {
        console.warn("refund email:", err?.message);
        return false;
    }
}

/**
 * Anula las entradas elegidas SOLO si siguen vigentes (con su estado leído en el plan). Si otra operación ya
 * anuló o validó alguna, revierte las que anuló esta llamada y aborta: evita reembolsar dos veces.
 */
async function claimTicketsForRefund(ctx: ToolContext, orderId: string, selected: any[]) {
    const claimed: any[] = [];
    let failed = false;
    for (const t of selected) {
        let q = ctx.supabase.from("event_attendees").update({ status: "cancelled" }, { count: "exact" }).eq("id", t.id).eq("event_order_id", orderId);
        q = t.status == null ? q.is("status", null) : q.eq("status", t.status);
        const { count, error } = await q;
        if (error) {
            await restoreTickets(ctx, orderId, claimed);
            throw error;
        }
        if (count === 1) claimed.push(t);
        else {
            failed = true;
            break;
        }
    }
    if (failed) {
        await restoreTickets(ctx, orderId, claimed);
        throw new ToolError("conflict", "Otra operación ya anuló o modificó estas entradas (¿un reembolso en paralelo?). Revisa get_order antes de reintentar.");
    }
}

/** Devuelve a su estado anterior entradas que esta llamada anuló. */
async function restoreTickets(ctx: ToolContext, orderId: string, tickets: any[]) {
    for (const t of tickets) {
        const { error } = await ctx.supabase
            .from("event_attendees")
            .update({ status: t.status ?? null })
            .eq("id", t.id)
            .eq("event_order_id", orderId)
            .eq("status", "cancelled");
        if (error) console.error("refund_order: no se pudo restaurar la entrada", t.id, error.message);
    }
}

const refundOrder: ToolDef = {
    name: "refund_order",
    title: "Reembolsar orden",
    description:
        "Reembolso total o parcial (ticket_ids) de una orden: anula esas entradas (su QR deja de servir) y deja la devolución solicitada a AI Tickets, " +
        "que devuelve el dinero al medio de pago original. Por defecto se devuelve solo el valor de las entradas; refund_service_fee=true devuelve también el cargo por servicio " +
        "(en eventos con cargo absorbido siempre se devuelve lo que pagó el comprador: tu neto + el cargo, que asume AI Tickets). " +
        "El valor de las entradas es de cargo del productor: no se puede reembolsar más de lo que aún no se le ha transferido de ese evento. " +
        "Entradas ya usadas requieren force=true. Requiere confirmación y acepta idempotency_key.",
    scope: "finance",
    permission: "finance.manage",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    inputSchema: {
        type: "object",
        required: ["order_id"],
        additionalProperties: false,
        properties: {
            order_id: orderIdSchema,
            ticket_ids: { type: "array", minItems: 1, maxItems: 100, items: { type: "string", pattern: UUID_PATTERN }, description: "Reembolso parcial: solo estas entradas. Omitir = toda la orden." },
            reason: { type: "string", maxLength: 500, description: "Motivo (se le informa al comprador)." },
            refund_service_fee: { type: "boolean", default: false, description: "true = devolver también el cargo por servicio de esas entradas (ignorado si el cargo lo absorbió el productor: ahí siempre se devuelve)." },
            notify_buyer: { type: "boolean", default: true },
            force: { type: "boolean", default: false, description: "Permite reembolsar entradas que ya se usaron para ingresar." },
        },
    },
    async confirm(args, ctx) {
        const plan = await planRefund(args, ctx);
        return {
            message:
                `Reembolso ${plan.full ? "TOTAL" : "parcial"} de la orden de ${buyerName(plan.order) || plan.order.buyer_email || "comprador"} en "${plan.event.name}": ` +
                `${plan.selected.length} entrada(s) quedarán anuladas y se devolverán ${clp(plan.total)} al comprador ` +
                `(${clp(plan.ticketAmount)} ${plan.feeAbsorbed ? "de tu neto" : "de entradas"}, a tu cargo${plan.feeAmount ? ` + ${clp(plan.feeAmount)} de cargo por servicio, que asume AI Tickets` : ""}).`,
            details: {
                order_id: plan.order.id,
                tickets: plan.selected.map((t) => ({ ticket_id: t.id, type: t.ticket_name, status: ticketStatus(t.status) })),
                ticket_amount_clp: plan.ticketAmount,
                service_fee_refund_clp: plan.feeAmount,
                total_to_buyer_clp: plan.total,
                event_balance_after_clp: plan.balance.available - plan.ticketAmount,
            },
            warnings: [
                ...(plan.validatedCount ? [`${plan.validatedCount} entrada(s) ya se usaron para ingresar.`] : []),
                ...(plan.transferredOut
                    ? [`${plan.transferredOut} entrada(s) de esta orden se transfirieron a otro titular y siguen vigentes: no se reembolsan aquí, así que el reembolso es parcial.`]
                    : []),
                "No se puede deshacer: las entradas quedan anuladas de inmediato.",
            ],
        };
    },
    audit: (args, result) => ({ summary: `Reembolso ${(result as any).kind} ${clp(Number((result as any).total_clp) || 0)}`, target: `order:${args.order_id}` }),
    async handler(args, ctx) {
        const plan = await planRefund(args, ctx);
        const ids = plan.selected.map((t) => t.id);
        await claimTicketsForRefund(ctx, plan.order.id, plan.selected);

        const now = new Date().toISOString();
        const refundRow = {
            organization_id: ctx.actor.orgId,
            event_id: Number(plan.event.id),
            order_id: plan.order.id,
            kind: plan.full ? "full" : "partial",
            ticket_amount: plan.ticketAmount,
            fee_amount: plan.feeAmount,
            total_amount: plan.total,
            cancelled_ticket_ids: ids,
            reason: args.reason || null,
            source: "refund_order",
            status: plan.total > 0 ? "requested" : "completed",
            requested_by: ctx.actor.userId,
            requested_via: ctx.channel,
            ...(plan.total > 0 ? {} : { processed_at: now }),
        };
        const { data: refund, error: refundError } = await ctx.supabase.from("aitickets_refunds").insert(refundRow).select("id, status").single();
        if (refundError) {
            // No dejar entradas anuladas sin registro del reembolso
            await restoreTickets(ctx, plan.order.id, plan.selected);
            if (isMissingTable(refundError)) throw new ToolError("unavailable", "Los reembolsos aún no están disponibles. Intenta en unos minutos.");
            throw refundError;
        }
        if (plan.full) {
            const { count, error } = await ctx.supabase
                .from("event_orders")
                .update({ status: "refunded", refunded_at: now }, { count: "exact" })
                .eq("id", plan.order.id)
                .eq("status", "paid");
            if (error) console.error("refund_order: no se pudo marcar la orden refunded:", error.message);
            else if (!count) console.warn(`refund_order: la orden ${plan.order.id} ya no estaba 'paid' al marcarla refunded`);
        }
        if (plan.total > 0) {
            await notifySlack(
                `💸 *Reembolso solicitado vía ${ctx.channel === "mcp" ? "MCP" : "API"}*\n• *Evento:* ${plan.event.name} (#${plan.event.id})\n• *Orden:* ${plan.order.id} (${plan.order.payment_provider || "flow"}, ref ${plan.order.payment_external_id || "—"})\n` +
                    `• *Devolver al comprador:* ${clp(plan.total)} (${clp(plan.ticketAmount)} entradas + ${clp(plan.feeAmount)} cargo)\n• *Tipo:* ${plan.full ? "total" : "parcial"}\n• *Refund id:* ${refund.id}\n• *Por:* ${ctx.actor.name || ctx.actor.email}`,
            );
        }
        const emailed = args.notify_buyer !== false ? await emailRefundToBuyer(plan, args.reason || null) : false;
        return {
            event_id: Number(plan.event.id),
            order_id: plan.order.id,
            refund_id: refund.id,
            kind: plan.full ? "full" : "partial",
            cancelled_ticket_ids: ids,
            ticket_amount_clp: plan.ticketAmount,
            service_fee_refund_clp: plan.feeAmount,
            total_clp: plan.total,
            refund_status: refund.status,
            order_status: plan.full ? "refunded" : "paid",
            buyer_notified: emailed,
            note:
                plan.total > 0
                    ? "Las entradas ya están anuladas. AI Tickets devuelve el dinero al medio de pago original (estado 'requested' hasta que se procese); el plazo en que el comprador lo ve depende de su banco o emisor. El valor de las entradas se descuenta de tu saldo."
                    : "Orden sin monto: las entradas quedaron anuladas y no hay dinero que devolver.",
        };
    },
};

// ---------------------------------------------------------------------------
// cancel_event
// ---------------------------------------------------------------------------

type CancelOrderPlan = { order: any; ticketAmount: number; feeAmount: number; total: number; alreadyRefunded: boolean };

/** Órdenes 'paid' del evento y lo que falta devolver de cada una (descontando reembolsos activos previos). */
async function planPaidOrders(ctx: ToolContext, eventId: number, excludeIds: Set<string> = new Set()): Promise<CancelOrderPlan[]> {
    const orders = (
        await fetchAll<any>(() =>
            ctx.supabase.from("event_orders").select("id, amount, ticket_fee, service_fee_tax, ticket_qty, payment_provider").eq("event_id", eventId).eq("status", "paid"),
        )
    ).filter((o) => !excludeIds.has(String(o.id)));
    const refunds = (await loadRefunds(ctx, { eventId })).filter(ACTIVE_REFUND);
    const priorByOrder = new Map<string, { t: number; f: number; cancel: boolean }>();
    for (const r of refunds) {
        const p = priorByOrder.get(String(r.order_id)) || { t: 0, f: 0, cancel: false };
        p.t += Number(r.ticket_amount) || 0;
        p.f += Number(r.fee_amount) || 0;
        if (r.source === "cancel_event") p.cancel = true;
        priorByOrder.set(String(r.order_id), p);
    }
    return orders.map((o) => {
        const prior = priorByOrder.get(String(o.id)) || { t: 0, f: 0, cancel: false };
        // Ya tiene el reembolso de la cancelación (un intento anterior se cortó antes de marcar la orden): no se duplica
        if (prior.cancel) return { order: o, ticketAmount: 0, feeAmount: 0, total: 0, alreadyRefunded: true };
        const ticketAmount = Math.max(0, (Number(o.amount) || 0) - prior.t);
        const feeAmount = Math.max(0, (Number(o.ticket_fee) || 0) + (Number(o.service_fee_tax) || 0) - prior.f);
        return { order: o, ticketAmount, feeAmount, total: ticketAmount + feeAmount, alreadyRefunded: false };
    });
}

async function planCancellation(args: any, ctx: ToolContext) {
    const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, name, slug, status, cancelled_at");
    const perOrder = await planPaidOrders(ctx, Number(event.id));
    const resuming = Boolean(event.cancelled_at);
    if (resuming && !perOrder.length) {
        const { count } = await ctx.supabase
            .from("event_attendees")
            .select("id", { count: "exact", head: true })
            .eq("event_id", event.id)
            .in("status", ["active", "validated"]);
        if (!count) throw new ToolError("conflict", "El evento ya está cancelado y no queda nada pendiente (entradas anuladas y reembolsos registrados).");
    }
    const totals = perOrder.reduce(
        (acc, p) => ({ tickets: acc.tickets + p.ticketAmount, fees: acc.fees + p.feeAmount, toRefund: acc.toRefund + (p.total > 0 ? 1 : 0) }),
        { tickets: 0, fees: 0, toRefund: 0 },
    );
    const balance = await eventUnwithdrawnBalance(ctx, Number(event.id));
    return { event, perOrder, totals, balance, resuming };
}

/** Anula todas las entradas vigentes del evento; devuelve las anuladas por orden (para el registro del reembolso). */
async function cancelLiveTickets(ctx: ToolContext, eventId: number) {
    const tickets = await fetchAll<any>(() => ctx.supabase.from("event_attendees").select("id, event_order_id, status").eq("event_id", eventId));
    const liveByOrder = new Map<string, string[]>();
    for (const t of tickets) {
        if (ticketStatus(t.status) === "cancelled" || !t.event_order_id) continue;
        const list = liveByOrder.get(String(t.event_order_id)) || [];
        list.push(t.id);
        liveByOrder.set(String(t.event_order_id), list);
    }
    for (const q of [
        ctx.supabase.from("event_attendees").update({ status: "cancelled" }).eq("event_id", eventId).is("status", null),
        ctx.supabase.from("event_attendees").update({ status: "cancelled" }).eq("event_id", eventId).in("status", ["active", "validated"]),
    ]) {
        const { error } = await q;
        if (error) throw error;
    }
    return liveByOrder;
}

const cancelEvent: ToolDef = {
    name: "cancel_event",
    title: "Cancelar evento",
    description:
        "Cancela un evento: deja de venderse, anula TODAS sus entradas, solicita el reembolso total (entradas + cargo por servicio) de cada orden pagada y avisa " +
        "por correo a los compradores. El valor de las entradas es de cargo del productor. No se puede deshacer. Solo dueño o finanzas (permiso de la conexión: finance). " +
        "Si un intento anterior quedó a medias, volver a llamarla completa lo pendiente. " +
        "Requiere confirmación y acepta idempotency_key.",
    scope: "finance",
    permission: "finance.manage",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id", "reason"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            reason: { type: "string", minLength: 3, maxLength: 1000, description: "Motivo; se incluye en el aviso a los compradores." },
            notify_buyers: { type: "boolean", default: true },
        },
    },
    async confirm(args, ctx) {
        const plan = await planCancellation(args, ctx);
        const warnings = ["No se puede deshacer: todas las entradas quedan anuladas y el evento deja de venderse."];
        if (plan.totals.tickets > plan.balance.available) {
            warnings.push(
                `Ya se te transfirió parte de las ventas: el valor de las entradas a reembolsar (${clp(plan.totals.tickets)}) supera tu saldo pendiente de este evento (${clp(Math.max(0, plan.balance.available))}). AI Tickets te contactará para restituir la diferencia.`,
            );
        }
        return {
            message:
                (plan.resuming ? `"${plan.event.name}" ya está cancelado; se completará lo pendiente: ` : `Se cancelará "${plan.event.name}": `) +
                `${plan.perOrder.length} orden(es) pagada(s) quedarán reembolsadas y anuladas, ` +
                `con ${clp(plan.totals.tickets + plan.totals.fees)} a devolver a ${plan.totals.toRefund} comprador(es)` +
                `${args.notify_buyers !== false ? ", y se les avisará por correo" : ""}.`,
            details: {
                event_id: Number(plan.event.id),
                paid_orders: plan.perOrder.length,
                refund_tickets_clp: plan.totals.tickets,
                refund_service_fees_clp: plan.totals.fees,
                reason: args.reason,
            },
            warnings,
        };
    },
    audit: (args, result) => ({ summary: `Evento cancelado; ${(result as any).refunds_created} reembolso(s)`, target: `event:${args.event_id}` }),
    async handler(args, ctx) {
        const plan = await planCancellation(args, ctx);
        const now = new Date().toISOString();
        const eventId = Number(plan.event.id);

        // Órdenes reembolsadas por refund_order (antes de cancelar): sus compradores no reciben el aviso de cancelación.
        // Se deduce de los registros de reembolso, así sirve igual en un reintento.
        const eventRefunds = (await loadRefunds(ctx, { eventId })).filter(ACTIVE_REFUND);
        const byCancellation = new Set(eventRefunds.filter((r) => r.source === "cancel_event").map((r) => String(r.order_id)));
        const { data: refundedOrders } = await ctx.supabase.from("event_orders").select("id").eq("event_id", eventId).eq("status", "refunded").limit(5000);
        const refundedByOrder = new Set(eventRefunds.filter((r) => r.source !== "cancel_event").map((r) => String(r.order_id)));
        const excludeOrderIds = (refundedOrders || [])
            .map((o: any) => String(o.id))
            .filter((id: string) => refundedByOrder.has(id) && !byCancellation.has(id));

        // 1. Deja de venderse (un reintento conserva la fecha y el motivo originales)
        if (!plan.resuming) {
            const { error: evError } = await ctx.supabase
                .from("events")
                .update({ status: "draft", cancelled_at: now, cancellation_reason: args.reason })
                .eq("id", eventId)
                .eq("organization_id", ctx.actor.orgId)
                .is("cancelled_at", null);
            if (evError) throw evError;
        }

        // 2-3. Anula entradas y reembolsa órdenes pagadas. Se repite por si entró un pago (webhook) mientras tanto:
        // el evento ya no vende, así que converge en pocas vueltas.
        const processed = new Set<string>();
        let refundsCreated = 0;
        let refundTotal = 0;
        let ticketsCancelled = 0;
        let perOrder = plan.perOrder;
        for (let round = 0; round < 3; round++) {
            const liveByOrder = await cancelLiveTickets(ctx, eventId);
            for (const l of liveByOrder.values()) ticketsCancelled += l.length;
            if (round > 0) perOrder = await planPaidOrders(ctx, eventId, processed);
            if (!perOrder.length) break;

            for (let i = 0; i < perOrder.length; i += 200) {
                const batch = perOrder.slice(i, i + 200);
                const rows = batch
                    .filter((p) => p.total > 0 && !p.alreadyRefunded)
                    .map((p) => ({
                        organization_id: ctx.actor.orgId,
                        event_id: eventId,
                        order_id: p.order.id,
                        kind: "full",
                        ticket_amount: p.ticketAmount,
                        fee_amount: p.feeAmount,
                        total_amount: p.total,
                        cancelled_ticket_ids: liveByOrder.get(String(p.order.id)) || [],
                        reason: args.reason,
                        source: "cancel_event",
                        status: "requested",
                        requested_by: ctx.actor.userId,
                        requested_via: ctx.channel,
                    }));
                if (rows.length) {
                    const { error } = await ctx.supabase.from("aitickets_refunds").insert(rows);
                    if (error) {
                        console.error("cancel_event: reembolsos:", error.message);
                        await notifySlack(`🚨 cancel_event #${eventId}: falló el registro de reembolsos (${error.message}). Reintentar cancel_event completa lo pendiente.`);
                        throw new ToolError(
                            "internal",
                            "El evento quedó cancelado pero no se pudieron registrar todos los reembolsos. Vuelve a llamar a cancel_event (con un resumen nuevo) para completar lo pendiente; AI Tickets fue notificado.",
                        );
                    }
                }
                // Solo las órdenes de este lote que sigan 'paid' (no toca pagos que entren después: van en la siguiente vuelta)
                const batchIds = batch.map((p) => p.order.id);
                const { error: ordersError } = await ctx.supabase
                    .from("event_orders")
                    .update({ status: "refunded", refunded_at: now })
                    .in("id", batchIds)
                    .eq("event_id", eventId)
                    .eq("status", "paid");
                if (ordersError) {
                    console.error("cancel_event: órdenes:", ordersError.message);
                    throw new ToolError("internal", "No se pudieron marcar todas las órdenes como reembolsadas. Vuelve a llamar a cancel_event para completar lo pendiente.");
                }
                for (const p of batch) processed.add(String(p.order.id));
                refundsCreated += rows.length;
                refundTotal += rows.reduce((n, r) => n + r.total_amount, 0);
            }
        }

        // 4. Aviso a compradores (background function con secreto interno). Es el último paso: si un intento anterior
        // falló antes, nunca se encoló, así que un reintento también avisa.
        let notificationQueued = false;
        if (args.notify_buyers !== false) {
            const res = await callInternalFunction(ctx.requestUrl, "/.netlify/functions/send-event-notification-background", {
                eventId,
                changeType: "cancellation",
                changeDescription: args.reason,
                requestedBy: { type: "user", userId: ctx.actor.userId, organizationId: ctx.actor.orgId, via: ctx.channel },
                includeCancelled: true,
                excludeOrderIds,
            });
            notificationQueued = res.ok;
        }
        await notifySlack(
            `🛑 *Evento ${plan.resuming ? "cancelado (reintento: completando lo pendiente)" : "cancelado"} vía ${ctx.channel === "mcp" ? "MCP" : "API"}*\n• *Evento:* ${plan.event.name} (#${eventId})\n• *Reembolsos a procesar:* ${refundsCreated} por ${clp(refundTotal)}\n` +
                `• *Saldo del productor en el evento:* ${clp(plan.balance.available)}\n• *Aviso a compradores:* ${notificationQueued ? "en cola" : "NO enviado"}\n• *Por:* ${ctx.actor.name || ctx.actor.email}`,
        );
        return {
            event_id: eventId,
            status: "cancelled",
            on_sale: false,
            resumed: plan.resuming,
            tickets_cancelled: ticketsCancelled,
            orders_refunded: processed.size,
            refunds_created: refundsCreated,
            refund_total_clp: refundTotal,
            buyers_notification_queued: notificationQueued,
            note:
                "Las entradas quedaron anuladas. AI Tickets devuelve el dinero a cada comprador con su medio de pago original. " +
                (args.notify_buyers !== false && !notificationQueued ? "El aviso por correo NO se pudo encolar: usa send_attendee_message o avísanos." : ""),
        };
    },
};

export const postsaleTools: ToolDef[] = [getOrder, resendTickets, transferTicket, refundOrder, cancelEvent];
