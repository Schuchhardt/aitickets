// Herramientas: rendimiento de eventos (ventas, tráfico, conversión, canales). Agrupa por día en hora de Chile.
// Los cálculos viven en src/lib/eventAnalytics.ts (los mismos que muestra el panel).
import type { ToolDef, ToolContext } from "../registry";
import { eventIdSchema, loadOwnedEvent, eventPublicUrl, fetchAll, localDay, eventUrls, scopeToEvents, eventDateFields, DATES_NOTE } from "./common";
import { isCourtesyOrder, isTransferOrder, orderSoldQty } from "../../orderKinds";
import {
    categorizeReferrer,
    channelConversion,
    dailySeries,
    eventCapacity,
    loadEventFunctions,
    loadEventVisits,
    loadPaidOrders,
    salesByFunction,
    summarizeSales,
    summarizeTraffic,
} from "../../eventAnalytics";

export { categorizeReferrer };

const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 1000) / 10 : null);

/** Lista de días YYYY-MM-DD (hora de Chile) de los últimos `days` días, terminando hoy. */
function lastDays(days: number, now = new Date()): string[] {
    const out: string[] = [];
    for (let i = days - 1; i >= 0; i--) out.push(localDay(new Date(now.getTime() - i * 86400000)));
    return [...new Set(out)];
}

export async function eventPerformance(ctx: ToolContext, eventId: number, days: number) {
    const event = await loadOwnedEvent<any>(ctx, eventId, "id, name, slug, status, start_date, end_date");
    const now = new Date();

    const [orders, { visits, truncated, refTracked }, { count: refunded }, capacity, { functions, ticketFunction }] = await Promise.all([
        loadPaidOrders(ctx.supabase, event.id),
        loadEventVisits(ctx.supabase, event.id),
        ctx.supabase.from("event_orders").select("id", { count: "exact", head: true }).eq("event_id", event.id).eq("status", "refunded"),
        eventCapacity(ctx.supabase, event),
        loadEventFunctions(ctx.supabase, event.id),
    ]);

    // Ventas: sin cortesías ni transferencias (src/lib/orderKinds.ts). Las entradas transferidas siguen contando
    // como vendidas en su orden de origen (transferred_out).
    const s = summarizeSales(orders);
    const { sales, paidOrders, ticketsSold, courtesyTickets, revenue, discountTotal } = s;
    const traffic = summarizeTraffic(visits);

    // Ritmo: últimos 7 días vs 7 anteriores
    const since = (d: number) => now.getTime() - d * 86400000;
    const inRange = (o: any, from: number, to: number) => { const t = new Date(o.created_at).getTime(); return t >= from && t < to; };
    const sum = (list: any[]) => list.reduce((n, o) => n + orderSoldQty(o), 0);
    const last7 = sum(sales.filter((o) => inRange(o, since(7), now.getTime() + 1)));
    const prev7 = sum(sales.filter((o) => inRange(o, since(14), since(7))));
    const daysUntil = event.start_date ? Math.ceil((new Date(event.start_date).getTime() - now.getTime()) / 86400000) : null;

    return {
        event_id: Number(event.id),
        name: event.name,
        status: event.status,
        ...eventUrls(ctx, event),
        ...eventDateFields(event),
        dates_note: DATES_NOTE,
        days_until_event: daysUntil,
        sales: {
            paid_orders: paidOrders,
            tickets_sold: ticketsSold,
            courtesy_tickets: courtesyTickets,
            revenue_clp: revenue,
            discounts_given_clp: discountTotal,
            average_order_clp: paidOrders ? Math.round(revenue / paidOrders) : 0,
            average_ticket_clp: ticketsSold ? Math.round(revenue / ticketsSold) : 0,
            refunded_orders: refunded || 0,
            last_sale_at: s.lastSaleAt,
            note: "revenue_clp = monto de entradas para el productor (ya con descuentos, sin cargo por servicio). Las cortesías (courtesy_tickets) y las transferencias de titular no cuentan como ventas.",
        },
        capacity: {
            total: capacity.capacity,
            unlimited_ticket_types: capacity.unlimited,
            issued_tickets: capacity.issued,
            courtesy_tickets_issued: courtesyTickets,
            sell_through_pct: capacity.sellThroughPct,
        },
        pace: {
            tickets_last_7_days: last7,
            tickets_previous_7_days: prev7,
            trend: last7 > prev7 ? "up" : last7 < prev7 ? "down" : "flat",
            avg_tickets_per_day_last_7: Math.round((last7 / 7) * 10) / 10,
            projected_additional_tickets_until_event: daysUntil && daysUntil > 0 ? Math.round((last7 / 7) * daysUntil) : null,
        },
        traffic: {
            visits: traffic.visits,
            unique_visitors: traffic.uniqueVisitors,
            conversion_pct: pct(paidOrders, traffic.uniqueVisitors),
            truncated,
            top_sources: traffic.sources,
            top_locations: traffic.locations.map(({ location, visits: n, percentage }) => ({ location, visits: n, percentage })),
            peak_hours_local: traffic.peakHours.map((n, hour) => ({ hour, visits: n })).filter((h) => h.visits > 0).sort((a, b) => b.visits - a.visits).slice(0, 5),
        },
        ticket_types: capacity.ticketTypes,
        sales_by_ticket_type: s.byType.slice(0, 30),
        // Solo con más de una función: órdenes, entradas e ingresos de cada una (una orden con dos funciones cuenta en ambas)
        ...(functions.length > 1 ? { sales_by_function: salesByFunction(sales, functions, ticketFunction) } : {}),
        sales_channels: s.channels.slice(0, 10),
        channel_conversion: channelConversion(visits, sales, { refTracked, top: 10 }),
        sales_by_payment_provider: s.providers,
        discount_codes_used: s.codes.slice(0, 20),
        daily: dailySeries(lastDays(days, now), visits, sales),
    };
}

const getEventPerformance: ToolDef = {
    name: "get_event_performance",
    title: "Rendimiento del evento",
    description:
        "¿Cómo le va al evento? Ventas, ingresos, capacidad vendida, ritmo de venta (últimos 7 días vs anteriores y proyección), " +
        "ventas por función (si tiene varias), visitas, conversión, fuentes de tráfico, ubicación de visitantes, horas pico, canales de venta (ref/UTM) con su conversión, " +
            "medios de pago, códigos usados y serie diaria. " +
        "Ideal para diagnosticar y recomendar acciones (subir precio, crear descuento, reforzar un canal).",
    scope: "read",
    annotations: { readOnlyHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            days: { type: "integer", minimum: 1, maximum: 120, default: 30, description: "Días de la serie diaria." },
        },
    },
    handler: (args, ctx) => eventPerformance(ctx, args.event_id, args.days),
};

const getSalesOverview: ToolDef = {
    name: "get_sales_overview",
    title: "Resumen de ventas de la organización",
    description: "Ventas de todos los eventos de la organización en un período: totales y ranking por evento.",
    scope: "read",
    annotations: { readOnlyHint: true },
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { days: { type: "integer", minimum: 1, maximum: 365, default: 30, description: "Período hacia atrás desde hoy." } },
    },
    async handler(args, ctx) {
        const { data: events, error } = await scopeToEvents(
            ctx,
            ctx.supabase.from("events").select("id, name, slug, status, start_date, end_date").eq("organization_id", ctx.actor.orgId),
            "id",
        )
            .order("start_date", { ascending: false })
            .limit(300);
        if (error) throw error;
        const ids = (events || []).map((e: any) => Number(e.id));
        const sinceIso = new Date(Date.now() - args.days * 86400000).toISOString();
        const orders = ids.length
            ? await fetchAll<any>(() =>
                ctx.supabase.from("event_orders").select("event_id, amount, ticket_qty, ticket_details, payment_provider, created_at")
                    .in("event_id", ids).eq("status", "paid").gte("created_at", sinceIso))
            : [];
        const per = new Map<number, { tickets: number; revenue: number; orders: number }>();
        let tickets = 0, revenue = 0, count = 0;
        for (const o of orders) {
            if (isCourtesyOrder(o) || isTransferOrder(o)) continue;
            const qty = orderSoldQty(o);
            const row = per.get(Number(o.event_id)) || { tickets: 0, revenue: 0, orders: 0 };
            row.tickets += qty; row.revenue += Number(o.amount) || 0; row.orders += 1;
            per.set(Number(o.event_id), row);
            tickets += qty; revenue += Number(o.amount) || 0; count += 1;
        }
        return {
            period_days: args.days,
            dates_note: DATES_NOTE,
            since: sinceIso,
            totals: { paid_orders: count, tickets_sold: tickets, revenue_clp: revenue },
            events: (events || [])
                .map((e: any) => ({
                    event_id: Number(e.id),
                    name: e.name,
                    status: e.status,
                    ...eventDateFields(e),
                    public_url: e.status === "published" ? eventPublicUrl(ctx, e.slug) : null,
                    tickets_sold: per.get(Number(e.id))?.tickets || 0,
                    revenue_clp: per.get(Number(e.id))?.revenue || 0,
                }))
                .filter((e: any) => e.tickets_sold > 0 || (e.start_date && e.start_date >= sinceIso))
                .sort((a: any, b: any) => b.revenue_clp - a.revenue_clp || b.tickets_sold - a.tickets_sold),
        };
    },
};

export const analyticsTools: ToolDef[] = [getEventPerformance, getSalesOverview];
