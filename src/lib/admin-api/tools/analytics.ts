// Herramientas de admin: analítica de plataforma (KPIs, series, ranking de productores y embudo de activación).
// Definiciones de venta, bruto, cargo e IVA: src/lib/admin-api/metrics.ts (nunca se redefinen aquí).
import { fetchAll, localDay, eventPublicUrl } from "../../producer-api/tools/common";
import { isCourtesyOrder, isTransferOrder } from "../../orderKinds";
import { ACTIVE_REFUND_STATUSES } from "../../producer-api/ledger";
import { addDays } from "../../../../netlify/lib/dates.mjs";
import type { AdminToolDef } from "../registry";
import {
    SEGMENTS,
    SEGMENT_LABELS,
    derivedMoney,
    emptyTotals,
    loadPaidOrders,
    loadPlatformEvents,
    pct,
    pctChange,
    periodSchema,
    resolvePeriod,
    salesByDay,
    totalsByEvent,
    totalsByOrg,
    totalsFromOrders,
    type Period,
    type SalesTotals,
} from "../metrics";
import { organizationIdSchema, overviewOrganizations, tolerantRows } from "./organizations";

// ---------------------------------------------------------------------------
// Utilidades compartidas (también las usan activity.ts y support.ts)
// ---------------------------------------------------------------------------

/** Venta = no es cortesía ni transferencia (src/lib/orderKinds.ts). */
export const isSaleOrder = (o: any) => !isTransferOrder(o) && !isCourtesyOrder(o);

const isMissing = (error: any) => ["42P01", "PGRST205", "42703", "PGRST204"].includes(String(error?.code || ""));

/** fetchAll que devuelve [] si la tabla o columna no existe (deploy sin migrar). */
export async function tolerantAll<T = any>(build: () => any, opts?: { max?: number }): Promise<T[]> {
    try {
        return await fetchAll<T>(build, opts);
    } catch (err: any) {
        if (isMissing(err)) return [];
        throw err;
    }
}

/** Conteo exacto (head) o null si la consulta falla. */
export async function headCount(query: any): Promise<number | null> {
    const { count, error } = await query;
    return error ? null : (count ?? 0);
}

/** Nombres de organizaciones por id. */
export async function orgNames(supabase: any, ids: number[]): Promise<Map<number, string>> {
    const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
    if (!unique.length) return new Map();
    const rows = await fetchAll<any>(() => supabase.from("organizations").select("id, public_name").in("id", unique).order("id", { ascending: true }));
    return new Map(rows.map((r: any) => [Number(r.id), r.public_name]));
}

const MAX_PERIOD_VISITS = 300000;

/** Visitas creadas en el período, solo de los eventos indicados (no demo). Con orgFilter se consulta por evento. */
export async function loadVisitsInPeriod(supabase: any, period: Pick<Period, "fromIso" | "toIso">, eventIds: number[], { byEvent = false } = {}) {
    const set = new Set(eventIds);
    if (byEvent) {
        const out: any[] = [];
        for (let i = 0; i < eventIds.length; i += 150) {
            const chunk = eventIds.slice(i, i + 150);
            out.push(
                ...(await tolerantAll<any>(
                    () => supabase.from("event_visits").select("event_id, ip_hash, created_at").in("event_id", chunk).gte("created_at", period.fromIso).lt("created_at", period.toIso).order("id", { ascending: true }),
                    { max: MAX_PERIOD_VISITS },
                )),
            );
        }
        return out;
    }
    const rows = await tolerantAll<any>(
        () => supabase.from("event_visits").select("event_id, ip_hash, created_at").gte("created_at", period.fromIso).lt("created_at", period.toIso).order("id", { ascending: true }),
        { max: MAX_PERIOD_VISITS },
    );
    return rows.filter((v) => set.has(Number(v.event_id)));
}

export type VisitGroup = "total" | "event" | "org" | "day" | "week" | "month";
export type VisitCount = { visits: number; unique_visitors: number };

/**
 * Visitas y visitantes únicos (ip_hash distintos DENTRO de cada grupo) del período, contados en la base con la RPC
 * aitickets_admin_visit_counts (202610250116): no trae las filas, así que no depende del volumen. Claves: 'total',
 * el event_id o el organization_id como texto, o el día/semana/mes de bucketOf(). Si la función aún no existe
 * (deploy sin migrar) se cuenta en memoria con loadVisitsInPeriod; para group 'org' hace falta orgOfEvent.
 */
export async function visitCounts(
    supabase: any,
    period: Pick<Period, "fromIso" | "toIso">,
    eventIds: number[],
    group: VisitGroup,
    { orgOfEvent }: { orgOfEvent?: Map<number, number> } = {},
): Promise<Map<string, VisitCount>> {
    if (!eventIds.length) return new Map();
    const { data, error } = await supabase.rpc("aitickets_admin_visit_counts", { p_from: period.fromIso, p_to: period.toIso, p_event_ids: eventIds, p_group: group });
    if (!error && Array.isArray(data)) {
        return new Map(data.map((r: any) => [String(r.bucket), { visits: Number(r.visits) || 0, unique_visitors: Number(r.unique_visitors) || 0 }]));
    }
    if (error && !["42883", "PGRST202"].includes(String(error.code || ""))) console.error("aitickets_admin_visit_counts:", error.message);
    const rows = await loadVisitsInPeriod(supabase, period, eventIds, { byEvent: eventIds.length <= 150 });
    const keyOf = (v: any): string | null => {
        if (group === "event") return String(v.event_id);
        if (group === "org") {
            const org = orgOfEvent?.get(Number(v.event_id));
            return org == null ? null : String(org);
        }
        if (group === "total") return "total";
        return bucketOf(localDay(v.created_at), group);
    };
    const acc = new Map<string, { visits: number; ips: Set<string> }>();
    for (const v of rows) {
        const key = keyOf(v);
        if (key == null) continue;
        const a = acc.get(key) || { visits: 0, ips: new Set<string>() };
        a.visits += 1;
        a.ips.add(String(v.ip_hash));
        acc.set(key, a);
    }
    return new Map([...acc].map(([k, a]) => [k, { visits: a.visits, unique_visitors: a.ips.size }]));
}

/** Reembolsos activos (requested/processing/completed) creados en el período, de esos eventos. */
export async function loadActiveRefunds(supabase: any, period: Pick<Period, "fromIso" | "toIso">, eventIds: number[]) {
    const set = new Set(eventIds);
    const rows = await tolerantAll<any>(() =>
        supabase
            .from("aitickets_refunds")
            .select("id, organization_id, event_id, order_id, kind, total_amount, fee_amount, ticket_amount, status, created_at, processed_at")
            .in("status", ACTIVE_REFUND_STATUSES)
            .gte("created_at", period.fromIso)
            .lt("created_at", period.toIso)
            .order("created_at", { ascending: true }),
    );
    return rows.filter((r) => set.has(Number(r.event_id)));
}

const sumBy = (rows: any[], key: string) => rows.reduce((n, r) => n + (Math.round(Number(r?.[key])) || 0), 0);

const MONEY_KEYS = ["gross_sales_clp", "producer_net_clp", "aitickets_fee_net_clp", "fee_iva_clp", "flow_cost_clp", "discounts_clp"] as const;

function moneyBlock(t: SalesTotals, refundFee: number) {
    return {
        gross_sales_clp: t.gross_sales_clp,
        producer_net_clp: t.producer_net_clp,
        aitickets_fee_net_clp: t.aitickets_fee_net_clp,
        fee_iva_clp: t.fee_iva_clp,
        flow_cost_clp: t.flow_cost_clp,
        discounts_clp: t.discounts_clp,
        refund_fees_absorbed_clp: refundFee,
        aitickets_margin_clp: t.aitickets_fee_net_clp - t.flow_cost_clp - refundFee,
    };
}

// ---------------------------------------------------------------------------
// get_platform_overview
// ---------------------------------------------------------------------------

const TOP_N = 5;

const getPlatformOverview: AdminToolDef = {
    name: "get_platform_overview",
    title: "Resumen de la plataforma",
    description:
        "KPIs de toda la plataforma en un período (por defecto 30 días) comparados con el período anterior del mismo largo: plata (ventas brutas, " +
        "ingreso de AI Tickets = cargo neto, IVA del cargo, costo de Flow, margen, neto a productores), actividad (órdenes, entradas, ticket promedio, " +
        "eventos y productores con ventas, productores nuevos, eventos creados, visitas, visitantes únicos y conversión), reembolsos, top 5 eventos y " +
        "productores, y contadores de la bandeja de operación. Sin eventos demo. Montos en CLP.",
    readOnly: true,
    inputSchema: { type: "object", additionalProperties: false, properties: { ...periodSchema } },
    async handler(args, actx) {
        const { supabase } = actx;
        const { current, previous } = resolvePeriod(args);
        const events = await loadPlatformEvents(supabase);
        const eventIds = events.map((e) => Number(e.id));
        const eventById = new Map(events.map((e) => [Number(e.id), e]));

        const [orders, prevOrders, refunds, prevRefunds, visits, newOrgs, verifiedOrgs, pending] = await Promise.all([
            loadPaidOrders(supabase, eventIds, current),
            previous ? loadPaidOrders(supabase, eventIds, previous) : Promise.resolve([]),
            loadActiveRefunds(supabase, current, eventIds),
            previous ? loadActiveRefunds(supabase, previous, eventIds) : Promise.resolve([]),
            visitCounts(supabase, current, eventIds, "total"),
            tolerantAll<any>(() => supabase.from("organizations").select("id, created_at").gte("created_at", current.fromIso).lt("created_at", current.toIso).order("id", { ascending: true })),
            tolerantAll<any>(() => supabase.from("organizations").select("id").gte("email_verified_at", current.fromIso).lt("email_verified_at", current.toIso).order("id", { ascending: true })),
            pendingCounters(supabase),
        ]);

        const totals = totalsFromOrders(orders);
        const prevTotals = previous ? totalsFromOrders(prevOrders) : null;
        const byEvent = totalsByEvent(orders);
        const byOrg = totalsByOrg(events, byEvent);
        const refundFee = sumBy(refunds, "fee_amount");
        const prevRefundFee = sumBy(prevRefunds, "fee_amount");
        const money = moneyBlock(totals, refundFee);
        const prevMoney = prevTotals ? moneyBlock(prevTotals, prevRefundFee) : null;
        const visitTotals = visits.get("total") || { visits: 0, unique_visitors: 0 };
        const uniqueVisitors = visitTotals.unique_visitors;
        const eventsCreated = events.filter((e) => e.created_at && e.created_at >= current.fromIso && e.created_at < current.toIso);

        const topEvents = [...byEvent.entries()]
            .filter(([, t]) => t.paid_orders > 0)
            .sort((a, b) => b[1].gross_sales_clp - a[1].gross_sales_clp)
            .slice(0, TOP_N);
        const topOrgs = [...byOrg.entries()]
            .filter(([, t]) => t.paid_orders > 0)
            .sort((a, b) => b[1].gross_sales_clp - a[1].gross_sales_clp)
            .slice(0, TOP_N);
        const names = await orgNames(supabase, [...topOrgs.map(([id]) => id), ...topEvents.map(([id]) => Number(eventById.get(id)?.organization_id))]);

        return {
            period: { from: current.from, to: current.to, days: current.days, ...(previous ? { compare_from: previous.from, compare_to: previous.to } : {}) },
            money: {
                ...money,
                ...(prevMoney
                    ? { vs_previous_pct: Object.fromEntries(Object.keys(money).map((k) => [k, pctChange((money as any)[k], (prevMoney as any)[k])])), previous: prevMoney }
                    : {}),
            },
            activity: {
                paid_orders: totals.paid_orders,
                tickets_sold: totals.tickets_sold,
                courtesy_tickets: totals.courtesy_tickets,
                avg_order_clp: derivedMoney(totals).avg_order_clp,
                events_with_sales: [...byEvent.values()].filter((t) => t.paid_orders > 0).length,
                producers_with_sales: [...byOrg.values()].filter((t) => t.paid_orders > 0).length,
                new_producers: newOrgs.length,
                producers_verified: verifiedOrgs.length,
                events_created: eventsCreated.length,
                events_created_and_published: eventsCreated.filter((e) => e.status === "published").length,
                visits: visitTotals.visits,
                unique_visitors: uniqueVisitors,
                conversion_pct: pct(totals.paid_orders, uniqueVisitors),
                ...(prevTotals
                    ? {
                          vs_previous_pct: {
                              paid_orders: pctChange(totals.paid_orders, prevTotals.paid_orders),
                              tickets_sold: pctChange(totals.tickets_sold, prevTotals.tickets_sold),
                          },
                      }
                    : {}),
                note: "events_created_and_published = eventos creados en el período que hoy están publicados (no se guarda la fecha de publicación). producers_verified = correo verificado en el período.",
            },
            refunds: {
                count: refunds.length,
                total_clp: sumBy(refunds, "total_amount"),
                ticket_amount_clp: sumBy(refunds, "ticket_amount"),
                fee_absorbed_by_aitickets_clp: refundFee,
                note: "Reembolsos activos (requested, processing, completed) creados en el período.",
            },
            top_events: topEvents.map(([id, t]) => {
                const e = eventById.get(id);
                return {
                    event_id: id,
                    name: e?.name ?? null,
                    organization: { id: Number(e?.organization_id), name: names.get(Number(e?.organization_id)) || null },
                    gross_sales_clp: t.gross_sales_clp,
                    tickets_sold: t.tickets_sold,
                    paid_orders: t.paid_orders,
                    public_url: e?.status === "published" ? eventPublicUrl({ origin: actx.origin } as any, e.slug) : null,
                };
            }),
            top_producers: topOrgs.map(([id, t]) => ({
                organization_id: id,
                name: names.get(id) || null,
                gross_sales_clp: t.gross_sales_clp,
                aitickets_fee_net_clp: t.aitickets_fee_net_clp,
                tickets_sold: t.tickets_sold,
                paid_orders: t.paid_orders,
            })),
            pending_operations: pending,
            definitions:
                "Ventas sin cortesías ni transferencias. gross = lo que pagaron los compradores; aitickets_fee_net = cargo por servicio sin IVA (ingreso); " +
                "margen = cargo neto − costo Flow − cargo devuelto en reembolsos. Conversión = órdenes vendidas ÷ visitantes únicos. Sin eventos demo.",
        };
    },
};

/** Contadores de la bandeja de operación (solo conteos; el detalle está en las herramientas de operación). */
export async function pendingCounters(supabase: any) {
    const accountsPending = async () => {
        const base = () => supabase.from("organization_payout_accounts").select("organization_id", { count: "exact", head: true }).is("verified_at", null).not("bank_account_number", "is", null);
        const withRejected = await headCount(base().is("verification_rejected_at", null));
        return withRejected ?? headCount(base());
    };
    const [payouts, accounts, refunds, review] = await Promise.all([
        headCount(supabase.from("aitickets_payouts").select("id", { count: "exact", head: true }).eq("status", "requested")),
        accountsPending(),
        headCount(supabase.from("aitickets_refunds").select("id", { count: "exact", head: true }).eq("status", "requested")),
        headCount(supabase.from("event_orders").select("id", { count: "exact", head: true }).eq("status", "review")),
    ]);
    return { payouts_requested: payouts, accounts_to_verify: accounts, refunds_requested: refunds, orders_in_review: review };
}

// ---------------------------------------------------------------------------
// get_platform_timeseries
// ---------------------------------------------------------------------------

const SERIES_METRICS = ["gross", "fee_net", "orders", "tickets", "signups", "visits", "refunds"] as const;
const GRANULARITIES = ["day", "week", "month"] as const;

/** Lunes (YYYY-MM-DD) de la semana de un día YYYY-MM-DD. */
export function weekStart(day: string): string {
    const [y, m, d] = day.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
    return addDays(day, -((dow + 6) % 7));
}

export function bucketOf(day: string, granularity: (typeof GRANULARITIES)[number]): string {
    if (granularity === "week") return weekStart(day);
    if (granularity === "month") return day.slice(0, 7);
    return day;
}

const getPlatformTimeseries: AdminToolDef = {
    name: "get_platform_timeseries",
    title: "Series de la plataforma",
    description:
        "Serie por día, semana (empieza el lunes) o mes, en hora de Chile, de las métricas pedidas: gross (ventas brutas), fee_net (ingreso de AI Tickets), " +
        "orders, tickets, signups (productores nuevos), visits (y visitantes únicos) y refunds (cantidad y monto). Opcional: solo una organización. " +
        "Sin eventos demo. Granularidad por defecto: día hasta 62 días, semana hasta 200, mes en adelante.",
    readOnly: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            metrics: { type: "array", items: { type: "string", enum: SERIES_METRICS }, minItems: 1, maxItems: SERIES_METRICS.length, description: "Por defecto gross, orders y tickets." },
            granularity: { type: "string", enum: GRANULARITIES },
            organization_id: organizationIdSchema,
            ...periodSchema,
        },
    },
    async handler(args, actx) {
        const { supabase } = actx;
        const { current } = resolvePeriod(args);
        const metrics: string[] = args.metrics?.length ? args.metrics : ["gross", "orders", "tickets"];
        const granularity = args.granularity || (current.days <= 62 ? "day" : current.days <= 200 ? "week" : "month");
        const orgIds = args.organization_id ? [args.organization_id] : null;
        const events = await loadPlatformEvents(supabase, { orgIds });
        const eventIds = events.map((e) => Number(e.id));
        const want = (m: string) => metrics.includes(m);

        const [orders, signups, visits, refunds] = await Promise.all([
            want("gross") || want("fee_net") || want("orders") || want("tickets") ? loadPaidOrders(supabase, eventIds, current) : Promise.resolve([]),
            want("signups") && !orgIds
                ? tolerantAll<any>(() => supabase.from("organizations").select("id, created_at").gte("created_at", current.fromIso).lt("created_at", current.toIso).order("id", { ascending: true }))
                : Promise.resolve([]),
            want("visits") ? visitCounts(supabase, current, eventIds, granularity) : Promise.resolve(new Map<string, VisitCount>()),
            want("refunds") ? loadActiveRefunds(supabase, current, eventIds) : Promise.resolve([]),
        ]);

        type Point = Record<string, any> & { bucket: string; from: string; to: string };
        const points = new Map<string, Point>();
        for (let d = current.from; d <= current.to; d = addDays(d, 1)) {
            const key = bucketOf(d, granularity);
            const p = points.get(key);
            if (p) p.to = d;
            else points.set(key, { bucket: key, from: d, to: d });
        }
        const at = (iso: string) => points.get(bucketOf(localDay(iso), granularity));

        const daily = salesByDay(orders);
        const bucketSales = new Map<string, SalesTotals>();
        for (const [day, t] of daily) {
            const key = bucketOf(day, granularity);
            const acc = bucketSales.get(key) || emptyTotals();
            for (const k of [...MONEY_KEYS, "paid_orders", "tickets_sold"] as const) (acc as any)[k] += (t as any)[k];
            bucketSales.set(key, acc);
        }
        for (const o of signups) {
            const p = at(o.created_at);
            if (p) p.signups = (p.signups || 0) + 1;
        }
        for (const r of refunds) {
            const p = at(r.created_at);
            if (!p) continue;
            p.refunds_count = (p.refunds_count || 0) + 1;
            p.refunds_clp = (p.refunds_clp || 0) + (Math.round(Number(r.total_amount)) || 0);
        }

        const series = [...points.values()].map((p) => {
            const t = bucketSales.get(p.bucket) || emptyTotals();
            const out: Record<string, unknown> = { bucket: p.bucket, from: p.from, to: p.to };
            if (want("gross")) out.gross_sales_clp = t.gross_sales_clp;
            if (want("fee_net")) out.aitickets_fee_net_clp = t.aitickets_fee_net_clp;
            if (want("orders")) out.paid_orders = t.paid_orders;
            if (want("tickets")) out.tickets_sold = t.tickets_sold;
            if (want("signups") && !orgIds) out.signups = p.signups || 0;
            if (want("visits")) {
                out.visits = visits.get(p.bucket)?.visits || 0;
                out.unique_visitors = visits.get(p.bucket)?.unique_visitors || 0;
            }
            if (want("refunds")) {
                out.refunds_count = p.refunds_count || 0;
                out.refunds_clp = p.refunds_clp || 0;
            }
            return out;
        });

        return {
            period: { from: current.from, to: current.to, days: current.days },
            granularity,
            metrics,
            ...(args.organization_id ? { organization_id: args.organization_id } : {}),
            ...(want("signups") && orgIds ? { note: "signups no aplica a una sola organización." } : {}),
            series,
        };
    },
};

// ---------------------------------------------------------------------------
// rank_producers
// ---------------------------------------------------------------------------

const RANK_SORTS = ["gross", "fee_net", "tickets", "orders", "growth", "conversion"] as const;

const rankProducers: AdminToolDef = {
    name: "rank_producers",
    title: "Ranking de productores",
    description:
        "Cómo le va a cada productor en un período (por defecto 30 días) vs el período anterior: ventas brutas, ingreso de AI Tickets, entradas, órdenes, " +
        "crecimiento %, eventos con ventas, visitantes únicos y conversión, nota promedio de reseñas (histórica), tasa de reembolso, segmento y alertas. " +
        "Por defecto solo productores con ventas en el período o en el anterior (include_inactive para todos, o filtra por segment).",
    readOnly: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            ...periodSchema,
            sort: { type: "string", enum: RANK_SORTS, default: "gross" },
            segment: { type: "string", enum: SEGMENTS, description: "Solo este segmento." },
            include_inactive: { type: "boolean", default: false, description: "true = incluir productores sin ventas en ninguno de los dos períodos." },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        },
    },
    async handler(args, actx) {
        const { supabase } = actx;
        const { current, previous } = resolvePeriod(args);
        const orgs = await fetchAll<any>(() => supabase.from("organizations").select("*").order("id", { ascending: true }), { max: 50000 });
        let rows = await overviewOrganizations(supabase, orgs);
        if (args.segment) rows = rows.filter((r) => r.segment === args.segment);

        const eventIds = rows.flatMap((r) => r.events.map((e: any) => Number(e.id)));
        const orgOfEvent = new Map(rows.flatMap((r) => r.events.map((e: any) => [Number(e.id), Number(r.org.id)] as [number, number])));
        const [visits, refunds, ratings] = await Promise.all([
            visitCounts(supabase, current, eventIds, "org", { orgOfEvent }),
            loadActiveRefunds(supabase, current, eventIds),
            tolerantAll<any>(() => supabase.from("aitickets_event_reviews").select("organization_id, rating").order("id", { ascending: true }), { max: 100000 }),
        ]);
        const refundsByOrg = new Map<number, number>();
        for (const r of refunds) refundsByOrg.set(Number(r.organization_id), (refundsByOrg.get(Number(r.organization_id)) || 0) + 1);
        const ratingByOrg = new Map<number, { sum: number; n: number }>();
        for (const r of ratings) {
            const n = Number(r.rating);
            if (!(n >= 1 && n <= 5)) continue;
            const acc = ratingByOrg.get(Number(r.organization_id)) || { sum: 0, n: 0 };
            acc.sum += n;
            acc.n += 1;
            ratingByOrg.set(Number(r.organization_id), acc);
        }

        const inPeriod = (o: any, p: Pick<Period, "fromIso" | "toIso">) => o.created_at >= p.fromIso && o.created_at < p.toIso;
        const ranked = rows.map((r) => {
            const id = Number(r.org.id);
            const now = totalsFromOrders(r.orders.filter((o) => inPeriod(o, current)));
            const before = previous ? totalsFromOrders(r.orders.filter((o) => inPeriod(o, previous))) : emptyTotals();
            const eventsWithSales = new Set(r.orders.filter((o) => inPeriod(o, current) && isSaleOrder(o)).map((o) => Number(o.event_id))).size;
            const unique = visits.get(String(id))?.unique_visitors || 0;
            const rating = ratingByOrg.get(id);
            const growth = pctChange(now.gross_sales_clp, before.gross_sales_clp);
            const alerts: string[] = [];
            if (r.segment === "en_riesgo") alerts.push("En riesgo: vendía y no tiene ventas recientes ni evento próximo.");
            if (r.segment === "publicado_sin_ventas") alerts.push("Evento publicado próximo sin ninguna venta.");
            if (before.paid_orders >= 5 && growth != null && growth <= -50) alerts.push(`Ventas ${growth}% vs el período anterior.`);
            if (r.totals.paid_orders > 0 && r.payoutStatus !== "verified") alerts.push(`Cuenta bancaria: ${r.payoutStatus}.`);
            if (rating && rating.n >= 5 && rating.sum / rating.n < 3.5) alerts.push(`Nota de reseñas baja (${Math.round((rating.sum / rating.n) * 10) / 10}).`);
            return {
                organization_id: id,
                name: r.org.public_name,
                owner_email: r.owner?.email ?? null,
                segment: r.segment,
                period: {
                    gross_sales_clp: now.gross_sales_clp,
                    aitickets_fee_net_clp: now.aitickets_fee_net_clp,
                    producer_net_clp: now.producer_net_clp,
                    paid_orders: now.paid_orders,
                    tickets_sold: now.tickets_sold,
                    events_with_sales: eventsWithSales,
                    unique_visitors: unique,
                    conversion_pct: pct(now.paid_orders, unique),
                    refunds: refundsByOrg.get(id) || 0,
                    refund_rate_pct: pct(refundsByOrg.get(id) || 0, now.paid_orders),
                },
                previous_period: { gross_sales_clp: before.gross_sales_clp, paid_orders: before.paid_orders, tickets_sold: before.tickets_sold },
                growth_pct: growth,
                lifetime_gross_sales_clp: r.totals.gross_sales_clp,
                reviews: rating ? { average: Math.round((rating.sum / rating.n) * 10) / 10, count: rating.n } : null,
                payout_account: r.payoutStatus,
                alerts,
            };
        });
        const active = args.include_inactive || args.segment ? ranked : ranked.filter((r) => r.period.paid_orders > 0 || r.previous_period.paid_orders > 0);
        const key: Record<string, (r: (typeof ranked)[number]) => number> = {
            gross: (r) => r.period.gross_sales_clp,
            fee_net: (r) => r.period.aitickets_fee_net_clp,
            tickets: (r) => r.period.tickets_sold,
            orders: (r) => r.period.paid_orders,
            growth: (r) => (r.growth_pct == null ? -Infinity : r.growth_pct),
            conversion: (r) => (r.period.conversion_pct == null ? -Infinity : r.period.conversion_pct),
        };
        const k = key[args.sort] || key.gross;
        active.sort((a, b) => k(b) - k(a) || b.period.gross_sales_clp - a.period.gross_sales_clp);
        return {
            period: { from: current.from, to: current.to, ...(previous ? { compare_from: previous.from, compare_to: previous.to } : {}) },
            sort: args.sort,
            total: active.length,
            segments: SEGMENT_LABELS,
            producers: active.slice(0, args.limit),
            note: "Ventas sin cortesías ni transferencias y sin eventos demo. reviews = promedio histórico. growth_pct = ventas brutas vs el período anterior.",
        };
    },
};

// ---------------------------------------------------------------------------
// get_producer_funnel
// ---------------------------------------------------------------------------

const FUNNEL_STEPS = [
    { key: "registered", label: "Se registró" },
    { key: "email_verified", label: "Verificó su correo" },
    { key: "first_event_created", label: "Creó su primer evento" },
    { key: "first_event_published", label: "Publicó un evento" },
    { key: "first_sale", label: "Tuvo su primera venta" },
    { key: "second_event", label: "Creó un segundo evento" },
    { key: "payout_verified", label: "Tiene su cuenta bancaria verificada" },
] as const;
const STUCK_LIMIT = 20;

const median = (values: number[]) => {
    if (!values.length) return null;
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    const m = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    return Math.round(m * 10) / 10;
};

const getProducerFunnel: AdminToolDef = {
    name: "get_producer_funnel",
    title: "Embudo de activación de productores",
    description:
        "Embudo de los productores que se registraron en un período (cohorte; por defecto 90 días): registrado → correo verificado → primer evento → " +
        "evento publicado → primera venta → segundo evento → cuenta bancaria verificada. Por paso: cuántos llegaron, conversión desde el paso anterior, " +
        "mediana de días desde el paso anterior y quiénes quedaron atascados (hasta 20 por paso, con el correo del dueño para contactarlos).",
    readOnly: true,
    inputSchema: { type: "object", additionalProperties: false, properties: { ...periodSchema } },
    async handler(args, actx) {
        const { supabase } = actx;
        const { current } = resolvePeriod({ preset: "90d", ...args });
        const orgs = await tolerantAll<any>(() => supabase.from("organizations").select("*").gte("created_at", current.fromIso).lt("created_at", current.toIso).order("id", { ascending: true }));
        const orgIds = orgs.map((o) => Number(o.id));
        const [events, users, accounts] = await Promise.all([
            orgIds.length ? loadPlatformEvents(supabase, { orgIds }) : Promise.resolve([]),
            orgIds.length ? fetchAll<any>(() => supabase.from("users").select("id, email, role, organization_id").in("organization_id", orgIds).order("id", { ascending: true })) : Promise.resolve([]),
            orgIds.length ? tolerantRows(() => supabase.from("organization_payout_accounts").select("organization_id, verified_at").in("organization_id", orgIds)) : Promise.resolve([]),
        ]);
        const orders = events.length ? await loadPaidOrders(supabase, events.map((e) => Number(e.id))) : [];
        const orgOfEvent = new Map(events.map((e) => [Number(e.id), Number(e.organization_id)]));

        const eventsByOrg = new Map<number, any[]>();
        for (const e of events) {
            const list = eventsByOrg.get(Number(e.organization_id)) || [];
            list.push(e);
            eventsByOrg.set(Number(e.organization_id), list);
        }
        const firstSale = new Map<number, string>();
        for (const o of orders) {
            if (!isSaleOrder(o)) continue;
            const org = orgOfEvent.get(Number(o.event_id));
            if (org == null) continue;
            const prev = firstSale.get(org);
            if (!prev || o.created_at < prev) firstSale.set(org, o.created_at);
        }
        const verifiedAt = new Map(accounts.filter((a: any) => a.verified_at).map((a: any) => [Number(a.organization_id), a.verified_at]));
        const ownerEmail = new Map<number, string | null>();
        for (const u of users) if (u.role === "producer" || !ownerEmail.has(Number(u.organization_id))) ownerEmail.set(Number(u.organization_id), u.email ?? null);

        // Fecha en que cada organización alcanzó cada paso (null = no llegó). Los pasos son secuenciales.
        const stepDates = orgs.map((org) => {
            const id = Number(org.id);
            const evs = (eventsByOrg.get(id) || []).filter((e) => e.created_at).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
            const published = evs.find((e) => e.status === "published");
            const raw: Record<string, string | null> = {
                registered: org.created_at || null,
                email_verified: org.email_verified_at || null,
                first_event_created: evs[0]?.created_at || null,
                // Sin fecha de publicación: se usa la de creación del primer evento publicado (cota inferior)
                first_event_published: published?.created_at || null,
                first_sale: firstSale.get(id) || null,
                second_event: evs[1]?.created_at || null,
                payout_verified: verifiedAt.get(id) || null,
            };
            const dates: Record<string, string | null> = {};
            let reached = true;
            for (const step of FUNNEL_STEPS) {
                reached = reached && Boolean(raw[step.key]);
                dates[step.key] = reached ? raw[step.key] : null;
            }
            return { org, dates };
        });

        const steps = FUNNEL_STEPS.map((step, i) => {
            const reached = stepDates.filter((s) => s.dates[step.key]);
            const prevKey = i > 0 ? FUNNEL_STEPS[i - 1].key : null;
            const prevReached = prevKey ? stepDates.filter((s) => s.dates[prevKey]) : stepDates;
            const days = prevKey
                ? reached.map((s) => Math.max(0, (Date.parse(s.dates[step.key]!) - Date.parse(s.dates[prevKey]!)) / 86400000))
                : [];
            const stuck = prevKey ? prevReached.filter((s) => !s.dates[step.key]) : [];
            return {
                step: step.key,
                label: step.label,
                organizations: reached.length,
                conversion_from_previous_pct: prevKey ? pct(reached.length, prevReached.length) : null,
                conversion_from_registered_pct: pct(reached.length, stepDates.length),
                median_days_from_previous: prevKey ? median(days) : null,
                stuck_here: stuck.length,
                stuck_examples: stuck.slice(0, STUCK_LIMIT).map((s) => ({
                    organization_id: Number(s.org.id),
                    name: s.org.public_name,
                    created_at: s.org.created_at,
                    owner_email: ownerEmail.get(Number(s.org.id)) ?? null,
                    days_since_signup: Math.floor((Date.now() - Date.parse(s.org.created_at)) / 86400000),
                })),
            };
        });

        return {
            cohort: { registered_from: current.from, registered_to: current.to, organizations: orgs.length },
            steps,
            note:
                "Pasos secuenciales: cuenta solo a quien alcanzó también los anteriores. first_event_published usa la fecha de creación del primer evento " +
                "publicado (no se guarda la fecha de publicación). Ventas sin cortesías ni transferencias; sin eventos demo. stuck_examples trae el correo " +
                "del dueño para contactarlo: úsalo solo para eso.",
        };
    },
};

export const analyticsTools: AdminToolDef[] = [getPlatformOverview, getPlatformTimeseries, rankProducers, getProducerFunnel];
