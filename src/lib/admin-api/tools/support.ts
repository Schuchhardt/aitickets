// Herramientas de admin: soporte a compradores y usuarios (búsqueda de órdenes entre organizaciones, diagnóstico de
// una orden y búsqueda de usuarios). Devuelven datos personales: solo lo necesario para resolver el caso.
import { ToolError } from "../../producer-api/registry";
import { fetchAll, localDateTime } from "../../producer-api/tools/common";
import { isCourtesyOrder, isTransferOrder, orderLines, orderSoldQty } from "../../orderKinds";
import { isDemoEventSlug } from "../../demoEvent.mjs";
import { ROLE_LABELS } from "../../producer-api/permissions";
import { loadOrderEmailLog, summarizeEmailDelivery } from "../../../../netlify/lib/email-log.mjs";
import type { AdminToolDef } from "../registry";
import { organizationIdSchema, tolerantRows } from "./organizations";
import { orgNames, tolerantAll } from "./analytics";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

const ORDER_COLUMNS =
    "id, created_at, status, event_id, attendee_id, amount, ticket_fee, service_fee_tax, total_payment, payment_fee, discount_amount, discount_code, " +
    "ticket_qty, ticket_details, payment_provider, payment_external_id, buyer_first_name, buyer_last_name, buyer_email, email_sent_at, email_claimed_at, " +
    "hold_expires_at, processing_started_at, refunded_at";
const ORDER_COLUMNS_BASE =
    "id, created_at, status, event_id, attendee_id, amount, ticket_fee, total_payment, payment_fee, ticket_qty, ticket_details, payment_external_id, " +
    "buyer_first_name, buyer_last_name, buyer_email, email_sent_at";

/** Órdenes por id con las columnas nuevas si existen (deploy sin migrar: columnas base). */
async function loadOrdersByIds(supabase: any, ids: string[]): Promise<any[]> {
    if (!ids.length) return [];
    const out: any[] = [];
    for (let i = 0; i < ids.length; i += 150) {
        const chunk = ids.slice(i, i + 150);
        let { data, error } = await supabase.from("event_orders").select(ORDER_COLUMNS).in("id", chunk);
        if (error && ["42703", "PGRST204"].includes(String(error.code || ""))) ({ data, error } = await supabase.from("event_orders").select(ORDER_COLUMNS_BASE).in("id", chunk));
        if (error) throw error;
        out.push(...(data || []));
    }
    return out;
}

export const orderKind = (o: any) => (isTransferOrder(o) ? "transfer" : isCourtesyOrder(o) ? "courtesy" : "sale");

const buyerName = (o: any, attendee?: any) =>
    [o.buyer_first_name ?? attendee?.first_name, o.buyer_last_name ?? attendee?.last_name].filter(Boolean).join(" ") || null;

// ---------------------------------------------------------------------------
// search_orders
// ---------------------------------------------------------------------------

const STATUSES = ["paid", "pending", "processing", "review", "refunded", "expired", "rejected", "cancelled", "failed"] as const;

/** Ids de órdenes que calzan con el texto (sin .or(): una consulta por criterio). */
async function matchOrderIds(supabase: any, query: string): Promise<Set<string>> {
    const q = query.trim();
    const ids = new Set<string>();
    const add = (rows: any[], key = "id") => rows.forEach((r) => r?.[key] && ids.add(String(r[key])));
    const lookups: Promise<void>[] = [];

    if (UUID_RE.test(q)) {
        lookups.push(tolerantRows(() => supabase.from("event_orders").select("id").eq("id", q)).then((r) => add(r)));
        // También puede ser el id de una entrada
        lookups.push(tolerantRows(() => supabase.from("event_attendees").select("event_order_id").eq("id", q)).then((r) => add(r, "event_order_id")));
    }
    if (q.includes("@")) {
        const email = escapeLike(q.toLowerCase());
        lookups.push(tolerantRows(() => supabase.from("event_orders").select("id").ilike("buyer_email", email).limit(500)).then((r) => add(r)));
        lookups.push(
            tolerantRows(() => supabase.from("attendees").select("id").ilike("email", email).limit(200)).then(async (att) => {
                const attendeeIds = att.map((a: any) => Number(a.id));
                if (attendeeIds.length) add(await tolerantRows(() => supabase.from("event_orders").select("id").in("attendee_id", attendeeIds).limit(500)));
            }),
        );
    }
    if (/^\d{4,20}$/.test(q)) lookups.push(tolerantRows(() => supabase.from("event_orders").select("id").eq("payment_external_id", q).limit(50)).then((r) => add(r)));
    if (!q.includes("@") && q.length >= 6) {
        // Código QR de una entrada (texto exacto)
        lookups.push(tolerantRows(() => supabase.from("event_attendees").select("event_order_id").eq("qr_code", q).limit(10)).then((r) => add(r, "event_order_id")));
    }
    if (!q.includes("@") && /[a-záéíóúñü]/i.test(q)) {
        const words = q.split(/\s+/).filter(Boolean);
        const like = (w: string) => `%${escapeLike(w)}%`;
        if (words.length === 1) {
            for (const col of ["buyer_first_name", "buyer_last_name"]) {
                lookups.push(tolerantRows(() => supabase.from("event_orders").select("id").ilike(col, like(words[0])).limit(300)).then((r) => add(r)));
            }
        } else {
            // Nombre + apellido: primera palabra en el nombre y última en el apellido
            const first = words[0];
            const last = words[words.length - 1];
            lookups.push(
                tolerantRows(() => supabase.from("event_orders").select("id").ilike("buyer_first_name", like(first)).ilike("buyer_last_name", like(last)).limit(300)).then((r) => add(r)),
            );
            lookups.push(
                tolerantRows(() => supabase.from("attendees").select("id").ilike("first_name", like(first)).ilike("last_name", like(last)).limit(200)).then(async (att) => {
                    const attendeeIds = att.map((a: any) => Number(a.id));
                    if (attendeeIds.length) add(await tolerantRows(() => supabase.from("event_orders").select("id").in("attendee_id", attendeeIds).limit(500)));
                }),
            );
        }
    }
    await Promise.all(lookups);
    return ids;
}

const searchOrders: AdminToolDef = {
    name: "search_orders",
    title: "Buscar órdenes (toda la plataforma)",
    description:
        "Busca órdenes de cualquier productor por correo del comprador, nombre y apellido, id de la orden o de una entrada (uuid), número de orden de " +
        "Flow (payment_external_id) o código QR de una entrada. Filtros: organización, evento y estado. Por orden: productor, evento, estado, tipo " +
        "(sale/courtesy/transfer), medio de pago, montos, entradas, si salió el correo y el siguiente paso. Para el diagnóstico completo usa " +
        "get_order_timeline. Pensado para cuando un comprador escribe directo a AI Tickets. Devuelve datos personales: úsalos solo para el caso.",
    readOnly: true,
    sensitive: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
            query: { type: "string", minLength: 3, maxLength: 200, description: "Correo, nombre y apellido, id de orden/entrada, n° de orden de Flow o código QR." },
            organization_id: organizationIdSchema,
            event_id: { type: "integer", minimum: 1, description: "Solo órdenes de este evento." },
            status: { type: "string", enum: STATUSES, description: "Solo órdenes en este estado." },
            limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        },
    },
    async handler(args, actx) {
        const { supabase } = actx;
        const ids = [...(await matchOrderIds(supabase, args.query))];
        let orders = await loadOrdersByIds(supabase, ids);
        if (args.event_id) orders = orders.filter((o) => Number(o.event_id) === args.event_id);
        if (args.status) orders = orders.filter((o) => o.status === args.status);

        const eventIds = [...new Set(orders.map((o) => Number(o.event_id)))];
        const events = eventIds.length
            ? await fetchAll<any>(() => supabase.from("events").select("id, name, slug, organization_id, start_date").in("id", eventIds).order("id", { ascending: true }))
            : [];
        const eventById = new Map(events.map((e: any) => [Number(e.id), e]));
        if (args.organization_id) orders = orders.filter((o) => Number(eventById.get(Number(o.event_id))?.organization_id) === args.organization_id);
        orders.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        const total = orders.length;
        orders = orders.slice(0, args.limit);

        const names = await orgNames(supabase, events.map((e: any) => Number(e.organization_id)));
        const attendeeIds = [...new Set(orders.map((o) => Number(o.attendee_id)).filter(Boolean))];
        const buyers = attendeeIds.length
            ? await tolerantAll<any>(() => supabase.from("attendees").select("id, first_name, last_name, email").in("id", attendeeIds).order("id", { ascending: true }))
            : [];
        const buyerById = new Map(buyers.map((b: any) => [Number(b.id), b]));
        const tickets = orders.length
            ? await tolerantAll<any>(() => supabase.from("event_attendees").select("id, event_order_id, status, validated_at").in("event_order_id", orders.map((o) => o.id)).order("id", { ascending: true }))
            : [];
        const ticketsByOrder = new Map<string, any[]>();
        for (const t of tickets) {
            const list = ticketsByOrder.get(String(t.event_order_id)) || [];
            list.push(t);
            ticketsByOrder.set(String(t.event_order_id), list);
        }

        return {
            total,
            returned: orders.length,
            orders: orders.map((o) => {
                const e = eventById.get(Number(o.event_id));
                const b = buyerById.get(Number(o.attendee_id));
                const ts = ticketsByOrder.get(String(o.id)) || [];
                return {
                    order_id: o.id,
                    created_at: o.created_at,
                    created_local: localDateTime(o.created_at),
                    status: o.status,
                    kind: orderKind(o),
                    payment_provider: o.payment_provider ?? null,
                    flow_order: o.payment_external_id ?? null,
                    buyer: { name: buyerName(o, b), email: o.buyer_email ?? b?.email ?? null },
                    event: e ? { id: Number(e.id), name: e.name, start_local: localDateTime(e.start_date), ...(isDemoEventSlug(e.slug) ? { demo: true } : {}) } : { id: Number(o.event_id) },
                    organization: e ? { id: Number(e.organization_id), name: names.get(Number(e.organization_id)) || null } : null,
                    amounts: {
                        total_paid_clp: o.total_payment != null ? Number(o.total_payment) : null,
                        producer_net_clp: Number(o.amount) || 0,
                        service_fee_net_clp: Number(o.ticket_fee) || 0,
                        service_fee_iva_clp: Number(o.service_fee_tax) || 0,
                        discount_clp: Number(o.discount_amount) || 0,
                    },
                    tickets: {
                        sold: orderSoldQty(o),
                        issued: ts.length,
                        active: ts.filter((t) => t.status !== "cancelled").length,
                        checked_in: ts.filter((t) => t.validated_at || t.status === "validated").length,
                    },
                    email_sent_at: o.email_sent_at ?? null,
                    next: `get_order_timeline con order_id ${o.id}`,
                };
            }),
        };
    },
};

// ---------------------------------------------------------------------------
// get_order_timeline
// ---------------------------------------------------------------------------

const PROCESSING_STALE_MINUTES = 5;

/** Veredicto y siguiente acción para soporte, según el estado de la orden. */
export function orderVerdict(o: any, ctx: { emailSummary: any; refunds: any[]; activeTickets: number; now?: number }): { verdict: string; next_action: string } {
    const now = ctx.now ?? Date.now();
    const status = String(o.status || "");
    const kind = orderKind(o);
    const lastEmail = ctx.emailSummary?.last_status;
    const flowOrder = o.payment_external_id ? ` (orden de Flow ${o.payment_external_id})` : "";
    const pendingRefunds = ctx.refunds.filter((r) => r.status === "requested" || r.status === "processing");
    const refundNote = pendingRefunds.length
        ? ` Además tiene ${pendingRefunds.length} reembolso(s) parcial(es) pedido(s) sin devolver en Flow: select aitickets_set_refund_status('${pendingRefunds[0].id}', 'completed', '<id del reembolso en Flow>', null, '<tu nombre>');`
        : "";
    if (status === "paid") {
        const withRefund = (v: { verdict: string; next_action: string }) => ({ verdict: v.verdict, next_action: v.next_action + refundNote });
        if (lastEmail === "bounced" || lastEmail === "complained") {
            return withRefund({
                verdict: `Pagada, pero el último correo de entradas ${lastEmail === "bounced" ? "rebotó" : "fue marcado como spam"}.`,
                next_action: `Pedir al comprador otra dirección y transferirle las entradas con org_transfer_ticket (o corregirla y usar org_resend_tickets con order_id ${o.id}).`,
            });
        }
        if (!o.email_sent_at && lastEmail !== "sent" && lastEmail !== "delivered") {
            return withRefund({
                verdict: kind === "sale" ? "Pagada, pero el correo con las entradas no salió." : `Orden de ${kind === "courtesy" ? "cortesía" : "transferencia"} sin correo enviado.`,
                next_action: `org_resend_tickets con order_id ${o.id} (reenvía las entradas al correo del comprador).`,
            });
        }
        return withRefund({
            verdict: `Pagada y entradas enviadas${o.email_sent_at ? ` (${localDateTime(o.email_sent_at)})` : ""}. ${ctx.activeTickets} entrada(s) vigente(s).`,
            next_action: "Si dice que no le llegó: que revise spam o promociones; si no aparece, org_resend_tickets con order_id. Si quiere cambiar el titular: org_transfer_ticket.",
        });
    }
    if (status === "review") {
        return {
            verdict: "Pago recibido pero en revisión manual (sobreventa, monto distinto o código de descuento sobre su límite: ver el aviso 🚨 en Slack).",
            next_action:
                "Decidir con el productor: emitir las entradas a mano (ampliar cupo) o reembolsar con org_refund_order. Mientras tanto la plata queda retenida en el saldo del productor.",
        };
    }
    if (status === "processing") {
        const started = o.processing_started_at ? Date.parse(o.processing_started_at) : null;
        const stale = !started || now - started > PROCESSING_STALE_MINUTES * 60_000;
        return {
            verdict: stale ? "Quedó a medio procesar (la invocación que confirmaba el pago se cortó)." : "Se está confirmando el pago en este momento.",
            next_action: stale
                ? "El cron expire-pending-orders la concilia con Flow cada 10 min y avisa a Slack si no puede. Si pasa más de 30 min, revisar el pago en el panel de Flow."
                : "Esperar unos minutos y volver a consultar.",
        };
    }
    if (status === "pending") {
        const hold = o.hold_expires_at ? Date.parse(o.hold_expires_at) : null;
        if (hold && hold > now) {
            return { verdict: `El comprador está en el pago; la reserva vence a las ${localDateTime(o.hold_expires_at)}.`, next_action: "Esperar a que termine el pago o venza la reserva." };
        }
        return {
            verdict: `Reserva vencida sin confirmación${flowOrder}.`,
            next_action: o.payment_external_id
                ? "El cron consulta a Flow antes de expirarla: si Flow la cobró, la confirma y envía las entradas. Si sigue pendiente en 30 min, buscar la orden de Flow en su panel."
                : "El comprador no llegó a Flow: tiene que comprar de nuevo.",
        };
    }
    if (status === "expired") {
        return {
            verdict: `Expiró: la reserva venció sin pago confirmado${flowOrder}.`,
            next_action: o.payment_external_id
                ? `Si el comprador dice que pagó: el cron la revisa una vez más con Flow 60–75 min después de vencer y la confirma si estaba pagada. Si no, buscar la orden de Flow ${o.payment_external_id} en el panel de Flow.`
                : "El comprador no llegó a pagar: tiene que comprar de nuevo.",
        };
    }
    if (status === "refunded" || ctx.refunds.length) {
        const pending = ctx.refunds.filter((r) => r.status === "requested" || r.status === "processing");
        return {
            verdict: pending.length
                ? `Reembolso pedido (${pending.length}) y aún no devuelto en Flow.`
                : `Reembolsada (${ctx.refunds.map((r) => r.status).join(", ") || status}).`,
            next_action: pending.length
                ? `Devolver en el panel de Flow y registrarlo: select aitickets_set_refund_status('${pending[0].id}', 'completed', '<id del reembolso en Flow>', null, '<tu nombre>');`
                : "Nada pendiente.",
        };
    }
    if (["rejected", "cancelled", "failed"].includes(status)) {
        return { verdict: `El pago no se completó (${status}).`, next_action: "No hay cobro: el comprador tiene que comprar de nuevo." };
    }
    return { verdict: `Estado: ${status || "desconocido"}.`, next_action: "Revisar el detalle." };
}

const getOrderTimeline: AdminToolDef = {
    name: "get_order_timeline",
    title: "Diagnóstico de una orden",
    description:
        "Todo lo que pasó con una orden de cualquier productor, en orden cronológico: creación y reserva, eventos de pago de Flow, estado, correo de " +
        "entradas (envío, entrega, rebote), entradas (vigentes, anuladas, check-in), transferencias, reembolsos y avisos enviados. Termina con un " +
        "veredicto y la siguiente acción concreta (p. ej. org_resend_tickets). Usa search_orders para encontrar el order_id.",
    readOnly: true,
    sensitive: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["order_id"],
        properties: { order_id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$", description: "ID de la orden (uuid)." } },
    },
    async handler(args, actx) {
        const { supabase } = actx;
        const [order] = await loadOrdersByIds(supabase, [args.order_id]);
        if (!order) throw new ToolError("not_found", `No existe la orden ${args.order_id}. Búscala con search_orders.`);
        const { data: event } = await supabase.from("events").select("id, name, slug, organization_id, start_date").eq("id", order.event_id).maybeSingle();
        const names = await orgNames(supabase, event ? [Number(event.organization_id)] : []);

        const [paymentEvents, tickets, refunds, emailRows] = await Promise.all([
            tolerantAll<any>(() => supabase.from("aitickets_payment_events").select("id, provider, type, received_at").eq("order_id", order.id).order("received_at", { ascending: true })),
            tolerantAll<any>(() =>
                supabase.from("event_attendees").select("id, attendee_id, status, validated_at, is_complimentary, created_at, event_tickets(ticket_name)").eq("event_order_id", order.id).order("id", { ascending: true }),
            ),
            tolerantAll<any>(() =>
                supabase.from("aitickets_refunds").select("id, kind, status, total_amount, ticket_amount, fee_amount, source, provider_reference, created_at, processed_at").eq("order_id", order.id).order("created_at", { ascending: true }),
            ),
            loadOrderEmailLog(supabase, order.id, { limit: 10 }),
        ]);
        const emailSummary = summarizeEmailDelivery(emailRows, { emailSentAt: order.email_sent_at ?? null });
        const attendeeIds = [...new Set([order.attendee_id, ...tickets.map((t: any) => t.attendee_id)].map(Number).filter(Boolean))];
        const notifications = attendeeIds.length
            ? await tolerantAll<any>(() =>
                  supabase.from("notification_log").select("type, channel, status, created_at, attendee_id").eq("event_id", order.event_id).in("attendee_id", attendeeIds).order("created_at", { ascending: true }),
                  { max: 200 },
              )
            : [];

        const timeline: Array<{ at: string; at_local: string | null; what: string }> = [];
        const push = (at: string | null | undefined, what: string) => at && timeline.push({ at, at_local: localDateTime(at), what });
        push(order.created_at, `Orden creada (${orderKind(order)}, ${order.payment_provider || "flow"}, ${orderSoldQty(order)} entrada(s))`);
        push(order.hold_expires_at, "Vence la reserva de stock");
        push(order.processing_started_at, "Inicio de la confirmación del pago (processing)");
        for (const p of paymentEvents) push(p.received_at, `Evento de pago ${p.provider}: ${p.type}`);
        push(order.email_claimed_at, "Envío del correo de entradas iniciado");
        push(order.email_sent_at, "Correo de entradas enviado");
        for (const r of Array.isArray(emailRows) ? emailRows : []) {
            push(r.created_at, `Correo (${r.kind}): ${r.status}${r.error ? ` — ${r.error}` : ""}`);
            for (const ev of Array.isArray(r.events) ? r.events : []) push(ev?.at, `Correo: ${String(ev?.type || "").replace("email.", "")}`);
        }
        for (const t of tickets) {
            if (t.validated_at) push(t.validated_at, `Check-in de una entrada (${t.event_tickets?.ticket_name || "entrada"})`);
        }
        for (const r of refunds) {
            push(r.created_at, `Reembolso ${r.kind} pedido: $${Number(r.total_amount || 0).toLocaleString("es-CL")} (${r.source})`);
            push(r.processed_at, `Reembolso ${r.status}${r.provider_reference ? ` (ref ${r.provider_reference})` : ""}`);
        }
        for (const n of notifications) push(n.created_at, `Aviso ${n.type} (${n.channel}, ${n.status})`);
        push(order.refunded_at, "Orden marcada como reembolsada");
        timeline.sort((a, b) => a.at.localeCompare(b.at));

        const lines = orderLines(order);
        const transfers = {
            is_transfer: isTransferOrder(order),
            from_orders: [...new Set(lines.map((l: any) => l?.transferred_from_order).filter(Boolean))],
            transferred_out: lines.reduce((n: number, l: any) => n + (Number(l?.transferred_out) || 0), 0),
        };
        const activeTickets = tickets.filter((t: any) => t.status !== "cancelled").length;
        const { verdict, next_action } = orderVerdict(order, { emailSummary, refunds, activeTickets });

        return {
            order: {
                id: order.id,
                status: order.status,
                kind: orderKind(order),
                created_at: order.created_at,
                payment_provider: order.payment_provider ?? null,
                flow_order: order.payment_external_id ?? null,
                buyer: { name: buyerName(order), email: order.buyer_email ?? null },
                amounts: {
                    total_paid_clp: order.total_payment != null ? Number(order.total_payment) : null,
                    producer_net_clp: Number(order.amount) || 0,
                    service_fee_net_clp: Number(order.ticket_fee) || 0,
                    service_fee_iva_clp: Number(order.service_fee_tax) || 0,
                    flow_cost_clp: order.payment_fee != null ? Number(order.payment_fee) : null,
                    discount_clp: Number(order.discount_amount) || 0,
                    discount_code: order.discount_code ?? null,
                },
                lines: lines.map((l: any) => ({ name: l?.name ?? null, quantity: Number(l?.quantity) || 0, price: Number(l?.price) || 0, ...(l?.transferred_out ? { transferred_out: Number(l.transferred_out) } : {}) })),
            },
            event: event ? { id: Number(event.id), name: event.name, start_local: localDateTime(event.start_date), ...(isDemoEventSlug(event.slug) ? { demo: true } : {}) } : null,
            organization: event ? { id: Number(event.organization_id), name: names.get(Number(event.organization_id)) || null } : null,
            tickets: tickets.map((t: any) => ({
                ticket_id: t.id,
                type: t.event_tickets?.ticket_name ?? null,
                status: t.status || "active",
                complimentary: t.is_complimentary === true,
                checked_in_at: t.validated_at ?? null,
            })),
            transfers,
            refunds,
            email_delivery: emailSummary,
            payment_events: paymentEvents,
            notifications: notifications.map((n: any) => ({ type: n.type, channel: n.channel, status: n.status, at: n.created_at })),
            timeline,
            verdict,
            next_action,
        };
    },
};

// ---------------------------------------------------------------------------
// search_users
// ---------------------------------------------------------------------------

const searchUsers: AdminToolDef = {
    name: "search_users",
    title: "Buscar usuarios del panel",
    description:
        "Busca usuarios (productores y sus equipos) por correo o nombre: organización, rol, si está activo, último acceso, cantidad de ingresos y si el " +
        "correo de la organización está verificado. Útil para \"no puedo entrar\". Nunca devuelve contraseñas ni ids de autenticación.",
    readOnly: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
            query: { type: "string", minLength: 2, maxLength: 120, description: "Correo o nombre (parcial)." },
            limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        },
    },
    async handler(args, actx) {
        const { supabase } = actx;
        const like = `%${escapeLike(args.query.trim())}%`;
        const columns = "id, name, email, role, active, organization_id, last_access_at, login_count, created_at";
        const [byEmail, byName, support] = await Promise.all([
            tolerantRows(() => supabase.from("users").select(columns).ilike("email", like).limit(100)),
            tolerantRows(() => supabase.from("users").select(columns).ilike("name", like).limit(100)),
            tolerantRows(() => supabase.from("aitickets_platform_settings").select("value").eq("key", "support_user_id")),
        ]);
        const supportId = Number(support[0]?.value) || null;
        const seen = new Map<number, any>();
        for (const u of [...byEmail, ...byName]) if (!seen.has(Number(u.id)) && Number(u.id) !== supportId) seen.set(Number(u.id), u);
        const users = [...seen.values()].sort((a, b) => String(b.last_access_at || "").localeCompare(String(a.last_access_at || ""))).slice(0, args.limit);
        const orgIds = [...new Set(users.map((u) => Number(u.organization_id)).filter(Boolean))];
        const orgs = orgIds.length
            ? await tolerantRows(() => supabase.from("organizations").select("id, public_name, email_verified_at").in("id", orgIds))
            : [];
        const orgById = new Map(orgs.map((o: any) => [Number(o.id), o]));
        return {
            total: seen.size,
            returned: users.length,
            users: users.map((u) => {
                const org = orgById.get(Number(u.organization_id));
                return {
                    id: Number(u.id),
                    name: u.name ?? null,
                    email: u.email ?? null,
                    role: u.role,
                    role_label: ROLE_LABELS[u.role] || u.role,
                    active: u.active !== false,
                    last_access_at: u.last_access_at ?? null,
                    logins: u.login_count ?? 0,
                    created_at: u.created_at ?? null,
                    organization: org ? { id: Number(org.id), name: org.public_name, email_verified: Boolean(org.email_verified_at) } : null,
                };
            }),
            note: "El login exige el correo de la organización verificado. Para reenviar la verificación o un link de acceso usa las herramientas de operación.",
        };
    },
};

export const supportTools: AdminToolDef[] = [searchOrders, getOrderTimeline, searchUsers];
