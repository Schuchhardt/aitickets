// Herramientas: rendimiento de eventos (ventas, tráfico, conversión, canales). Agrupa por día en hora de Chile.
import type { ToolDef, ToolContext } from "../registry";
import { eventIdSchema, loadOwnedEvent, eventPublicUrl, ticketAvailability, presentTicket, TICKET_SELECT, fetchAll, localDay, eventUrls, scopeToEvents } from "./common";

const MAX_VISITS = 50000;

export function categorizeReferrer(referrer: string | null, utmSource: string | null): string {
    if (utmSource) return utmSource;
    if (!referrer) return "Directo";
    const url = referrer.toLowerCase();
    if (url.includes("google")) return "Google";
    if (url.includes("facebook") || url.includes("fb.")) return "Facebook";
    if (url.includes("instagram")) return "Instagram";
    if (url.includes("twitter") || url.includes("x.com")) return "X/Twitter";
    if (url.includes("tiktok")) return "TikTok";
    if (url.includes("linkedin")) return "LinkedIn";
    if (url.includes("whatsapp")) return "WhatsApp";
    return "Otro";
}

const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 1000) / 10 : null);

function topN(map: Map<string, any>, n: number, key: string) {
    return [...map.values()].sort((a, b) => b[key] - a[key]).slice(0, n);
}

/** Lista de días YYYY-MM-DD (hora de Chile) de los últimos `days` días, terminando hoy. */
function lastDays(days: number, now = new Date()): string[] {
    const out: string[] = [];
    for (let i = days - 1; i >= 0; i--) out.push(localDay(new Date(now.getTime() - i * 86400000)));
    return [...new Set(out)];
}

export async function eventPerformance(ctx: ToolContext, eventId: number, days: number) {
    const event = await loadOwnedEvent<any>(ctx, eventId, "id, name, slug, status, start_date, end_date");
    const now = new Date();

    const [orders, visits, { count: refunded }, { data: tickets }] = await Promise.all([
        fetchAll<any>(() =>
            ctx.supabase.from("event_orders")
                .select("created_at, amount, ticket_qty, discount_amount, discount_code, ticket_details, ref, utm_source, utm_medium, utm_campaign, payment_provider")
                .eq("event_id", event.id).eq("status", "paid").order("created_at", { ascending: true })),
        fetchAll<any>(() =>
            ctx.supabase.from("event_visits").select("created_at, ip_hash, referrer, utm_source").eq("event_id", event.id).order("created_at", { ascending: true }),
            { max: MAX_VISITS }),
        ctx.supabase.from("event_orders").select("id", { count: "exact", head: true }).eq("event_id", event.id).eq("status", "refunded"),
        ctx.supabase.from("event_tickets").select(TICKET_SELECT).eq("event_id", event.id),
    ]);

    // Ventas
    let revenue = 0, ticketsSold = 0, discountTotal = 0, courtesyTickets = 0;
    const byType = new Map<string, { name: string; tickets: number; gross_revenue_clp: number }>();
    const channels = new Map<string, { channel: string; orders: number; tickets: number; revenue_clp: number }>();
    const codes = new Map<string, { code: string; orders: number; discount_clp: number }>();
    for (const o of orders) {
        const qty = Number(o.ticket_qty) || 1;
        if (o.payment_provider === "courtesy") {
            courtesyTickets += qty;
            continue;
        }
        revenue += Number(o.amount) || 0;
        ticketsSold += qty;
        discountTotal += Number(o.discount_amount) || 0;
        for (const l of Array.isArray(o.ticket_details) ? o.ticket_details : []) {
            const name = l?.name || "Entrada";
            const row = byType.get(name) || { name, tickets: 0, gross_revenue_clp: 0 };
            row.tickets += Number(l?.quantity) || 0;
            row.gross_revenue_clp += (Number(l?.price) || 0) * (Number(l?.quantity) || 0);
            byType.set(name, row);
        }
        const channel = o.ref ? `ref:${o.ref}` : [o.utm_source, o.utm_medium, o.utm_campaign].filter(Boolean).join(" / ") || "Directo / sin seguimiento";
        const ch = channels.get(channel) || { channel, orders: 0, tickets: 0, revenue_clp: 0 };
        ch.orders += 1; ch.tickets += qty; ch.revenue_clp += Number(o.amount) || 0;
        channels.set(channel, ch);
        if (o.discount_code) {
            const c = codes.get(o.discount_code) || { code: o.discount_code, orders: 0, discount_clp: 0 };
            c.orders += 1; c.discount_clp += Number(o.discount_amount) || 0;
            codes.set(o.discount_code, c);
        }
    }
    const paidOrders = orders.filter((o) => o.payment_provider !== "courtesy").length;

    // Capacidad (stock real: emitidas + en checkout)
    const availability = await ticketAvailability(ctx, event.id, (tickets || []).map((t: any) => Number(t.id)));
    const ticketTypes = (tickets || []).map((t: any) => presentTicket(t, availability.get(Number(t.id))));
    const unlimited = ticketTypes.some((t: any) => t.quantity == null);
    const capacity = unlimited ? null : ticketTypes.reduce((s: number, t: any) => s + (t.quantity || 0), 0);
    const issued = ticketTypes.reduce((s: number, t: any) => s + t.sold, 0);

    // Tráfico
    const unique = new Set(visits.map((v) => v.ip_hash)).size;
    const sources = new Map<string, { source: string; visits: number }>();
    for (const v of visits) {
        const s = categorizeReferrer(v.referrer, v.utm_source);
        const row = sources.get(s) || { source: s, visits: 0 };
        row.visits += 1;
        sources.set(s, row);
    }

    // Serie diaria
    const series = new Map(lastDays(days, now).map((d) => [d, { date: d, visits: 0, tickets: 0, revenue_clp: 0 }]));
    for (const v of visits) {
        const row = series.get(localDay(v.created_at));
        if (row) row.visits += 1;
    }
    for (const o of orders) {
        if (o.payment_provider === "courtesy") continue;
        const row = series.get(localDay(o.created_at));
        if (row) { row.tickets += Number(o.ticket_qty) || 1; row.revenue_clp += Number(o.amount) || 0; }
    }

    // Ritmo: últimos 7 días vs 7 anteriores
    const since = (d: number) => now.getTime() - d * 86400000;
    const inRange = (o: any, from: number, to: number) => { const t = new Date(o.created_at).getTime(); return t >= from && t < to; };
    const paid = orders.filter((o) => o.payment_provider !== "courtesy");
    const sum = (list: any[]) => list.reduce((s, o) => s + (Number(o.ticket_qty) || 1), 0);
    const last7 = sum(paid.filter((o) => inRange(o, since(7), now.getTime() + 1)));
    const prev7 = sum(paid.filter((o) => inRange(o, since(14), since(7))));
    const lastSale = paid.length ? paid[paid.length - 1].created_at : null;
    const daysUntil = event.start_date ? Math.ceil((new Date(event.start_date).getTime() - now.getTime()) / 86400000) : null;

    return {
        event_id: Number(event.id),
        name: event.name,
        status: event.status,
        ...eventUrls(ctx, event),
        start_date: event.start_date,
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
            last_sale_at: lastSale,
            note: "revenue_clp = monto de entradas para el productor (ya con descuentos, sin cargo por servicio).",
        },
        capacity: {
            total: capacity,
            unlimited_ticket_types: unlimited,
            issued_tickets: issued,
            sell_through_pct: capacity ? pct(issued, capacity) : null,
        },
        pace: {
            tickets_last_7_days: last7,
            tickets_previous_7_days: prev7,
            trend: last7 > prev7 ? "up" : last7 < prev7 ? "down" : "flat",
            avg_tickets_per_day_last_7: Math.round((last7 / 7) * 10) / 10,
            projected_additional_tickets_until_event: daysUntil && daysUntil > 0 ? Math.round((last7 / 7) * daysUntil) : null,
        },
        traffic: {
            visits: visits.length,
            unique_visitors: unique,
            conversion_pct: pct(paidOrders, unique),
            truncated: visits.length >= MAX_VISITS,
            top_sources: topN(sources, 8, "visits"),
        },
        ticket_types: ticketTypes,
        sales_by_ticket_type: topN(byType, 30, "tickets"),
        sales_channels: topN(channels, 10, "revenue_clp"),
        discount_codes_used: topN(codes, 20, "orders"),
        daily: [...series.values()],
    };
}

const getEventPerformance: ToolDef = {
    name: "get_event_performance",
    title: "Rendimiento del evento",
    description:
        "¿Cómo le va al evento? Ventas, ingresos, capacidad vendida, ritmo de venta (últimos 7 días vs anteriores y proyección), " +
        "visitas, conversión, fuentes de tráfico, canales de venta (ref/UTM), códigos usados y serie diaria. " +
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
            ctx.supabase.from("events").select("id, name, slug, status, start_date").eq("organization_id", ctx.actor.orgId),
            "id",
        )
            .order("start_date", { ascending: false })
            .limit(300);
        if (error) throw error;
        const ids = (events || []).map((e: any) => Number(e.id));
        const sinceIso = new Date(Date.now() - args.days * 86400000).toISOString();
        const orders = ids.length
            ? await fetchAll<any>(() =>
                ctx.supabase.from("event_orders").select("event_id, amount, ticket_qty, payment_provider, created_at")
                    .in("event_id", ids).eq("status", "paid").gte("created_at", sinceIso))
            : [];
        const per = new Map<number, { tickets: number; revenue: number; orders: number }>();
        let tickets = 0, revenue = 0, count = 0;
        for (const o of orders) {
            if (o.payment_provider === "courtesy") continue;
            const row = per.get(Number(o.event_id)) || { tickets: 0, revenue: 0, orders: 0 };
            row.tickets += Number(o.ticket_qty) || 1; row.revenue += Number(o.amount) || 0; row.orders += 1;
            per.set(Number(o.event_id), row);
            tickets += Number(o.ticket_qty) || 1; revenue += Number(o.amount) || 0; count += 1;
        }
        return {
            period_days: args.days,
            since: sinceIso,
            totals: { paid_orders: count, tickets_sold: tickets, revenue_clp: revenue },
            events: (events || [])
                .map((e: any) => ({
                    event_id: Number(e.id),
                    name: e.name,
                    status: e.status,
                    start_date: e.start_date,
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
