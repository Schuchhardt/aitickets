// Analítica de eventos: una sola fuente para el panel (/dashboard, /dashboard/events/:id y su analítica),
// la API/MCP de productores (get_event_performance) y, más adelante, el MCP de administración.
//
// Definiciones (docs/specs/mcp-admin.md, sección 6):
//   * Venta = orden 'paid' que no es cortesía ni transferencia (src/lib/orderKinds.ts). Entradas vendidas =
//     orderSoldQty (las transferidas siguen contando en su orden de origen). Ingresos = Σ amount (lo que recibe
//     el productor, ya con descuentos y sin cargo por servicio).
//   * Cortesías: se informan aparte, nunca como venta.
//   * Conversión = órdenes vendidas ÷ visitantes únicos (ip_hash distintos).
//   * Ocupación (sell-through) = entradas emitidas ÷ capacidad a la venta (sin el tipo "Cortesía" del sistema).
//   * Días y horas en hora de Chile (America/Santiago).
// Todo se lee paginado (fetchAll): PostgREST corta en 1000 filas sin avisar.
import { fetchAll, localDay, ticketAvailability, presentTicket, TICKET_SELECT, isCourtesyName, TZ } from "./producer-api/tools/common";
import { isCourtesyOrder, isTransferOrder, lineSoldQty, orderLines, orderSoldQty } from "./orderKinds";
import { formatFunctionLabel } from "../../netlify/lib/dates.mjs";

export const MAX_VISITS = 50000;
/** Tope de días de la serie diaria del panel. */
export const MAX_SERIES_DAYS = 366;
export const DIRECT_CHANNEL = "Directo / sin seguimiento";

export const PROVIDER_LABELS: Record<string, string> = { flow: "Webpay", free: "Gratis", courtesy: "Cortesía", demo: "Demo", stripe: "Tarjeta" };
export const providerLabel = (p: string | null | undefined) => (p ? PROVIDER_LABELS[p] || p : "Webpay");

const isMissingColumn = (error: any) =>
    ["42703", "PGRST204"].includes(String(error?.code || "")) || /column .* does not exist|could not find .* column/i.test(String(error?.message || ""));
const isMissingFunction = (error: any) => ["42883", "PGRST202"].includes(String(error?.code || ""));

const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 1000) / 10 : null);

const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" });
/** Hora 0-23 en Chile. */
export const localHour = (iso: string | Date) => Number(hourFmt.format(new Date(iso))) % 24;

/** Día YYYY-MM-DD + n días (calendario, sin zona horaria). */
export function addDays(day: string, n: number): string {
    const [y, m, d] = day.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Días YYYY-MM-DD de `from` a `to` (inclusive). */
export function dayRange(from: string, to: string): string[] {
    const out: string[] = [];
    for (let d = from; d <= to && out.length <= MAX_SERIES_DAYS * 2; d = addDays(d, 1)) out.push(d);
    return out;
}

// ---------------------------------------------------------------------------
// Clasificación
// ---------------------------------------------------------------------------

/** Fuente de una visita: utm_source si viene; si no, el sitio de origen (referrer). */
export function categorizeReferrer(referrer: string | null | undefined, utmSource: string | null | undefined): string {
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

type Attribution = { ref?: string | null; utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null };

/** Canal de seguimiento (link con ?ref= o utm_*): el mismo criterio para órdenes y visitas. */
export function trackingChannel(a: Attribution): string {
    if (a.ref) return `ref:${a.ref}`;
    return [a.utm_source, a.utm_medium, a.utm_campaign].filter(Boolean).join(" / ") || DIRECT_CHANNEL;
}

// ---------------------------------------------------------------------------
// Carga (paginada)
// ---------------------------------------------------------------------------

export type VisitRow = Attribution & { created_at: string; ip_hash: string | null; referrer: string | null; country?: string | null; city?: string | null };

const VISIT_COLUMNS = "created_at, ip_hash, referrer, utm_source, utm_medium, utm_campaign, country, city";

/**
 * Visitas de un evento (hasta `max`). `refTracked` = false si la columna ref aún no existe (deploy preview sin la
 * migración 202610270200): las visitas se leen igual, sin ref.
 */
export async function loadEventVisits(supabase: any, eventId: number, { max = MAX_VISITS } = {}): Promise<{ visits: VisitRow[]; truncated: boolean; refTracked: boolean }> {
    const build = (cols: string) => () =>
        supabase.from("event_visits").select(cols).eq("event_id", eventId).order("created_at", { ascending: true }).order("id", { ascending: true });
    let refTracked = true;
    let visits: VisitRow[];
    try {
        visits = await fetchAll<VisitRow>(build(`${VISIT_COLUMNS}, ref`), { max });
    } catch (err) {
        if (!isMissingColumn(err)) throw err;
        refTracked = false;
        visits = await fetchAll<VisitRow>(build(VISIT_COLUMNS), { max });
    }
    return { visits, truncated: visits.length >= max, refTracked };
}

export const PAID_ORDER_COLUMNS =
    "id, created_at, amount, ticket_qty, discount_amount, discount_code, ticket_details, ref, utm_source, utm_medium, utm_campaign, payment_provider";

/** Órdenes pagadas de un evento (todas, en orden de creación). */
export async function loadPaidOrders(supabase: any, eventId: number): Promise<any[]> {
    return fetchAll<any>(() =>
        supabase.from("event_orders").select(PAID_ORDER_COLUMNS).eq("event_id", eventId).eq("status", "paid").order("created_at", { ascending: true }).order("id", { ascending: true }),
    );
}

/** Visitas y visitantes únicos sin traer las filas (RPC); si la función aún no existe, se cuentan paginando. */
export async function eventVisitCounts(supabase: any, eventId: number): Promise<{ visits: number; unique_visitors: number; truncated: boolean }> {
    const { data, error } = await supabase.rpc("aitickets_event_visit_counts", { p_event_id: Number(eventId) });
    const row = Array.isArray(data) ? data[0] : data;
    if (!error && row) return { visits: Number(row.visits) || 0, unique_visitors: Number(row.unique_visitors) || 0, truncated: false };
    if (error && !isMissingFunction(error)) console.error("aitickets_event_visit_counts:", error.message);
    const rows = await fetchAll<{ ip_hash: string | null }>(
        () => supabase.from("event_visits").select("ip_hash").eq("event_id", eventId).order("id", { ascending: true }),
        { max: MAX_VISITS },
    );
    return { visits: rows.length, unique_visitors: new Set(rows.map((v) => v.ip_hash)).size, truncated: rows.length >= MAX_VISITS };
}

export type OrderCheckins = { tickets: number; checked_in: number };

/**
 * Entradas vigentes e ingresadas (status validated) por orden de venta, para "entraron" por canal / link de RRPP.
 * Una entrada transferida a otro titular queda en la orden de la transferencia: se cuenta en la venta original
 * (transferred_from_order, siguiendo la cadena), que es la que trajo el link. `orders` = loadPaidOrders.
 */
export async function loadOrderCheckins(supabase: any, eventId: number, orders: any[]): Promise<Map<string, OrderCheckins>> {
    const rows = await fetchAll<{ event_order_id: string | null; status: string | null }>(() =>
        supabase.from("event_attendees").select("id, event_order_id, status").eq("event_id", eventId).order("id", { ascending: true }),
    );
    const origin = new Map<string, string>();
    for (const o of orders) {
        if (isTransferOrder(o)) origin.set(String(o.id), String(orderLines(o)[0]?.transferred_from_order));
    }
    const root = (id: string) => {
        const seen = new Set<string>();
        while (origin.has(id) && !seen.has(id)) {
            seen.add(id);
            id = origin.get(id)!;
        }
        return id;
    };
    const out = new Map<string, OrderCheckins>();
    for (const a of rows) {
        if (!a.event_order_id || (a.status != null && a.status !== "active" && a.status !== "validated")) continue;
        const id = root(String(a.event_order_id));
        const row = out.get(id) || { tickets: 0, checked_in: 0 };
        row.tickets += 1;
        if (a.status === "validated") row.checked_in += 1;
        out.set(id, row);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Ventas
// ---------------------------------------------------------------------------

export type ChannelSales = { channel: string; orders: number; tickets: number; revenue_clp: number };
export type ProviderSales = { provider: string; label: string; orders: number; tickets: number; revenue_clp: number };

export function summarizeSales(orders: any[]) {
    const sales = orders.filter((o) => !isCourtesyOrder(o) && !isTransferOrder(o));
    const courtesyTickets = orders.filter((o) => isCourtesyOrder(o) && !isTransferOrder(o)).reduce((n, o) => n + orderSoldQty(o), 0);
    let revenue = 0, ticketsSold = 0, discountTotal = 0;
    const byType = new Map<string, { name: string; tickets: number; gross_revenue_clp: number }>();
    const channels = new Map<string, ChannelSales>();
    const codes = new Map<string, { code: string; orders: number; discount_clp: number }>();
    const providers = new Map<string, ProviderSales>();
    for (const o of sales) {
        const qty = orderSoldQty(o);
        const amount = Number(o.amount) || 0;
        revenue += amount;
        ticketsSold += qty;
        discountTotal += Number(o.discount_amount) || 0;
        for (const l of orderLines(o)) {
            const name = l?.name || "Entrada";
            const row = byType.get(name) || { name, tickets: 0, gross_revenue_clp: 0 };
            row.tickets += lineSoldQty(l);
            row.gross_revenue_clp += (Number(l?.price) || 0) * lineSoldQty(l);
            byType.set(name, row);
        }
        const channel = trackingChannel(o);
        const ch = channels.get(channel) || { channel, orders: 0, tickets: 0, revenue_clp: 0 };
        ch.orders += 1; ch.tickets += qty; ch.revenue_clp += amount;
        channels.set(channel, ch);
        const provider = String(o.payment_provider || "flow");
        const pr = providers.get(provider) || { provider, label: providerLabel(provider), orders: 0, tickets: 0, revenue_clp: 0 };
        pr.orders += 1; pr.tickets += qty; pr.revenue_clp += amount;
        providers.set(provider, pr);
        if (o.discount_code) {
            const c = codes.get(o.discount_code) || { code: o.discount_code, orders: 0, discount_clp: 0 };
            c.orders += 1; c.discount_clp += Number(o.discount_amount) || 0;
            codes.set(o.discount_code, c);
        }
    }
    const byRevenue = <T extends { revenue_clp: number; orders: number }>(a: T, b: T) => b.revenue_clp - a.revenue_clp || b.orders - a.orders;
    return {
        sales,
        paidOrders: sales.length,
        ticketsSold,
        courtesyTickets,
        revenue,
        discountTotal,
        lastSaleAt: sales.length ? sales[sales.length - 1].created_at : null,
        byType: [...byType.values()].sort((a, b) => b.tickets - a.tickets),
        channels: [...channels.values()].sort(byRevenue),
        providers: [...providers.values()].sort(byRevenue),
        codes: [...codes.values()].sort((a, b) => b.orders - a.orders),
    };
}

// ---------------------------------------------------------------------------
// Por función
// ---------------------------------------------------------------------------

/** Clave de las líneas válidas para cualquier función (pase completo o tipo de entrada sin función). */
export const ALL_FUNCTIONS = "all";

/**
 * Función de una línea de orden: su event_date_id, o el de su tipo de entrada (`ticketFunction`, id → event_date_id)
 * en órdenes antiguas que no lo guardaban. ALL_FUNCTIONS si vale para cualquier función.
 */
export function lineFunctionKey(line: any, ticketFunction?: Map<number, number | null>): string {
    const id = line?.event_date_id ?? (line?.id != null ? ticketFunction?.get(Number(line.id)) : null);
    return id == null ? ALL_FUNCTIONS : String(id);
}

/**
 * La parte de una orden que es de una función: solo sus líneas de esa función, con su parte del monto (el monto de la
 * orden, ya con descuentos, se reparte según el valor de cada línea). null si la orden no tiene entradas de esa función.
 */
export function orderForFunction(o: any, key: string, ticketFunction?: Map<number, number | null>): any | null {
    const lines = orderLines(o);
    const own = lines.filter((l: any) => lineFunctionKey(l, ticketFunction) === key);
    if (!own.length) return null;
    if (own.length === lines.length) return o;
    const value = (ls: any[]) => ls.reduce((n: number, l: any) => n + (Number(l?.total) || (Number(l?.price) || 0) * lineSoldQty(l)), 0);
    const total = value(lines);
    const share = total > 0 ? value(own) / total : own.length / lines.length;
    return {
        ...o,
        ticket_details: own,
        ticket_qty: own.reduce((n: number, l: any) => n + (Number(l?.quantity) || 0), 0),
        amount: Math.round((Number(o.amount) || 0) * share),
        discount_amount: Math.round((Number(o.discount_amount) || 0) * share),
    };
}

/** Funciones del evento (event_dates) con su etiqueta, y el mapa tipo de entrada → función para órdenes antiguas. */
export async function loadEventFunctions(supabase: any, eventId: number) {
    const [{ data: dates }, { data: tickets }] = await Promise.all([
        supabase.from("event_dates").select("id, date, start_time").eq("event_id", eventId).order("date", { ascending: true }),
        supabase.from("event_tickets").select("id, event_date_id").eq("event_id", eventId),
    ]);
    const functions = ((dates || []) as any[])
        .sort((a, b) => `${a.date} ${a.start_time || ""}`.localeCompare(`${b.date} ${b.start_time || ""}`))
        .map((d) => ({ id: Number(d.id), label: formatFunctionLabel(d, { withPlace: false }) as string }));
    const ticketFunction = new Map<number, number | null>(((tickets || []) as any[]).map((t) => [Number(t.id), t.event_date_id == null ? null : Number(t.event_date_id)]));
    return { functions, ticketFunction };
}

export type FunctionOccupancy = {
    event_date_id: number | null;
    label: string;
    sold: number;
    courtesy: number;
    issued: number;
    checked_in: number;
    /** Suma del cupo de sus tipos de entrada; null si alguno es sin límite (o no tiene tipos con cupo). */
    capacity: number | null;
    occupancy_pct: number | null;
};

/**
 * Ocupación de cada función (panel y get_event_performance): por función, entradas vendidas, cortesías, emitidas
 * (vigentes, sin anuladas), ingresadas, cupo y % (emitidas ÷ cupo). La función de una entrada es la de su tipo de
 * entrada; las de tipos sin función (pase completo, cortesías del tipo "Cortesía") van en una fila aparte, que no se
 * suma al cupo de cada función.
 */
export async function functionOccupancy(supabase: any, eventId: number): Promise<FunctionOccupancy[]> {
    const [{ functions }, { data: tickets }, attendees] = await Promise.all([
        loadEventFunctions(supabase, eventId),
        supabase.from("event_tickets").select("id, ticket_name, event_date_id, total_quantity, is_gift").eq("event_id", eventId),
        fetchAll<any>(() =>
            supabase.from("event_attendees").select("id, event_ticket_id, status, is_complimentary").eq("event_id", eventId).order("id", { ascending: true }),
        ),
    ]);
    const keyOf = (dateId: unknown) => (dateId == null ? ALL_FUNCTIONS : String(dateId));
    const rows = new Map<string, FunctionOccupancy & { unlimited: boolean; capacitySum: number; types: number }>();
    for (const f of functions) {
        rows.set(String(f.id), { event_date_id: f.id, label: f.label, sold: 0, courtesy: 0, issued: 0, checked_in: 0, capacity: null, occupancy_pct: null, unlimited: false, capacitySum: 0, types: 0 });
    }
    const row = (key: string) => {
        let r = rows.get(key);
        if (!r) {
            r = { event_date_id: null, label: "Válidas para cualquier función", sold: 0, courtesy: 0, issued: 0, checked_in: 0, capacity: null, occupancy_pct: null, unlimited: false, capacitySum: 0, types: 0 };
            rows.set(key, r);
        }
        return r;
    };
    const ticketById = new Map<number, any>(((tickets || []) as any[]).map((t) => [Number(t.id), t]));
    for (const t of (tickets || []) as any[]) {
        // El tipo de cortesía del sistema no es cupo a la venta (igual que eventCapacity)
        if (t.is_gift || isCourtesyName(t.ticket_name)) continue;
        const r = row(keyOf(t.event_date_id));
        r.types += 1;
        if (t.total_quantity == null) r.unlimited = true;
        else r.capacitySum += Number(t.total_quantity) || 0;
    }
    for (const a of attendees) {
        if (a.status === "cancelled") continue;
        const t = ticketById.get(Number(a.event_ticket_id));
        const r = row(keyOf(t?.event_date_id));
        const courtesy = a.is_complimentary === true || isCourtesyName(t?.ticket_name);
        r.issued += 1;
        if (courtesy) r.courtesy += 1;
        else r.sold += 1;
        if (a.status === "validated") r.checked_in += 1;
    }
    return [...rows.values()]
        .filter((r) => r.event_date_id != null || r.issued > 0 || r.types > 0)
        .map(({ unlimited, capacitySum, types, ...r }) => {
            const capacity = unlimited || !types ? null : capacitySum;
            return { ...r, capacity, occupancy_pct: capacity ? pct(r.issued, capacity) : null };
        });
}

/**
 * Ventas por función (sin cortesías ni transferencias): órdenes, entradas e ingresos de cada función, y aparte las
 * entradas válidas para cualquier función. Una orden con entradas de dos funciones cuenta en ambas.
 */
export function salesByFunction(sales: any[], functions: { id: number; label: string }[], ticketFunction?: Map<number, number | null>) {
    const keys = [...functions.map((f) => String(f.id)), ALL_FUNCTIONS];
    return keys
        .map((key) => {
            const scoped = sales.map((o) => orderForFunction(o, key, ticketFunction)).filter(Boolean);
            const f = functions.find((x) => String(x.id) === key);
            return {
                event_date_id: f ? f.id : null,
                label: f ? f.label : "Válidas para cualquier función",
                orders: scoped.length,
                tickets: scoped.reduce((n: number, o: any) => n + orderSoldQty(o), 0),
                revenue_clp: scoped.reduce((n: number, o: any) => n + (Number(o.amount) || 0), 0),
            };
        })
        .filter((r) => r.event_date_id != null || r.orders > 0);
}

// ---------------------------------------------------------------------------
// Tráfico
// ---------------------------------------------------------------------------

export function summarizeTraffic(visits: VisitRow[], { geoTop = 10, sourcesTop = 8 } = {}) {
    const sources = new Map<string, { source: string; visits: number }>();
    const geo = new Map<string, { location: string; country: string | null; city: string | null; visits: number }>();
    const peakHours = new Array(24).fill(0) as number[];
    for (const v of visits) {
        const s = categorizeReferrer(v.referrer, v.utm_source);
        const row = sources.get(s) || { source: s, visits: 0 };
        row.visits += 1;
        sources.set(s, row);
        const location = [v.city, v.country].filter(Boolean).join(", ") || "Desconocido";
        const g = geo.get(location) || { location, country: v.country || null, city: v.city || null, visits: 0 };
        g.visits += 1;
        geo.set(location, g);
        peakHours[localHour(v.created_at)] += 1;
    }
    const total = visits.length;
    return {
        visits: total,
        uniqueVisitors: new Set(visits.map((v) => v.ip_hash)).size,
        sources: [...sources.values()].sort((a, b) => b.visits - a.visits).slice(0, sourcesTop),
        locations: [...geo.values()]
            .sort((a, b) => b.visits - a.visits)
            .slice(0, geoTop)
            .map((g) => ({ ...g, percentage: total ? Math.round((g.visits / total) * 100) : 0 })),
        peakHours,
    };
}

/**
 * Ventas y conversión por canal de seguimiento. Las visitas se atribuyen por los parámetros del link con que
 * llegaron (ref / utm_*); las órdenes, por la atribución que guardó el checkout. Si ref aún no se registra en las
 * visitas (refTracked = false), los canales ref:* no tienen visitas conocidas (null). Con `checkins`
 * (loadOrderCheckins) cada canal trae también cuántas de sus entradas ya ingresaron (checked_in).
 */
export function channelConversion(
    visits: VisitRow[],
    sales: any[],
    { refTracked = true, top = 20, checkins = null }: { refTracked?: boolean; top?: number; checkins?: Map<string, OrderCheckins> | null } = {},
) {
    const rows = new Map<string, { channel: string; visits: number; visitors: Set<string>; orders: number; tickets: number; revenue_clp: number; checked_in: number }>();
    const get = (channel: string) => {
        let r = rows.get(channel);
        if (!r) rows.set(channel, (r = { channel, visits: 0, visitors: new Set(), orders: 0, tickets: 0, revenue_clp: 0, checked_in: 0 }));
        return r;
    };
    for (const v of visits) {
        const r = get(trackingChannel(v));
        r.visits += 1;
        r.visitors.add(String(v.ip_hash));
    }
    for (const o of sales) {
        const r = get(trackingChannel(o));
        r.orders += 1;
        r.tickets += orderSoldQty(o);
        r.revenue_clp += Number(o.amount) || 0;
        r.checked_in += checkins?.get(String(o.id))?.checked_in || 0;
    }
    return [...rows.values()]
        .map((r) => {
            const unknownVisits = !refTracked && r.channel.startsWith("ref:");
            const unique = r.visitors.size;
            return {
                channel: r.channel,
                visits: unknownVisits ? null : r.visits,
                unique_visitors: unknownVisits ? null : unique,
                orders: r.orders,
                tickets: r.tickets,
                revenue_clp: r.revenue_clp,
                // Más órdenes que visitantes (p. ej. visitas anteriores a que se registrara ref): no es una conversión real
                conversion_pct: unknownVisits || !unique || r.orders > unique ? null : pct(r.orders, unique),
                // Entradas de esas ventas que ya ingresaron a la puerta ("entraron"); null si no se cargaron los check-ins
                checked_in: checkins ? r.checked_in : null,
            };
        })
        .sort((a, b) => b.revenue_clp - a.revenue_clp || b.orders - a.orders || (b.visits || 0) - (a.visits || 0))
        .slice(0, top);
}

/**
 * Ingresos a la puerta por canal / link (get_checkin_stats): de las entradas vigentes de cada canal (ventas e
 * inscripciones; sin cortesías ni transferencias, que cuentan en su venta original), cuántas ya entraron.
 */
export function checkinsByChannel(sales: any[], checkins: Map<string, OrderCheckins>) {
    const rows = new Map<string, { channel: string; tickets: number; checked_in: number }>();
    for (const o of sales) {
        const c = checkins.get(String(o.id));
        if (!c) continue;
        const channel = trackingChannel(o);
        const r = rows.get(channel) || { channel, tickets: 0, checked_in: 0 };
        r.tickets += c.tickets;
        r.checked_in += c.checked_in;
        rows.set(channel, r);
    }
    return [...rows.values()]
        .map((r) => ({ ...r, pending: r.tickets - r.checked_in, checked_in_pct: pct(r.checked_in, r.tickets) }))
        .sort((a, b) => b.checked_in - a.checked_in || b.tickets - a.tickets);
}

/** Serie diaria (hora de Chile) de visitas, entradas vendidas e ingresos sobre los días dados. */
export function dailySeries(days: string[], visits: VisitRow[], sales: any[]) {
    const series = new Map(days.map((d) => [d, { date: d, visits: 0, tickets: 0, revenue_clp: 0 }]));
    for (const v of visits) {
        const row = series.get(localDay(v.created_at));
        if (row) row.visits += 1;
    }
    for (const o of sales) {
        const row = series.get(localDay(o.created_at));
        if (row) { row.tickets += orderSoldQty(o); row.revenue_clp += Number(o.amount) || 0; }
    }
    return [...series.values()];
}

/** Días del primer al último movimiento (visita o venta), con tope MAX_SERIES_DAYS (los más recientes). */
export function activityDays(visits: VisitRow[], sales: any[]): { days: string[]; truncated: boolean } {
    const all = [...visits.map((v) => v.created_at), ...sales.map((o) => o.created_at)].filter(Boolean).map((t) => localDay(t));
    if (!all.length) return { days: [], truncated: false };
    let from = all.reduce((a, b) => (a < b ? a : b));
    const to = all.reduce((a, b) => (a > b ? a : b));
    const truncated = addDays(from, MAX_SERIES_DAYS - 1) < to;
    if (truncated) from = addDays(to, -(MAX_SERIES_DAYS - 1));
    return { days: dayRange(from, to), truncated };
}

// ---------------------------------------------------------------------------
// Capacidad y entradas emitidas
// ---------------------------------------------------------------------------

/** Capacidad a la venta y entradas emitidas (stock real: aitickets_ticket_availability). */
export async function eventCapacity(supabase: any, event: { id: number; status?: string | null }) {
    const { data: tickets, error } = await supabase.from("event_tickets").select(TICKET_SELECT).eq("event_id", event.id);
    if (error) console.error("eventCapacity:", error.message);
    const availability = await ticketAvailability({ supabase } as any, event.id, (tickets || []).map((t: any) => Number(t.id)));
    const ticketTypes = (tickets || []).map((t: any) => presentTicket(t, availability.get(Number(t.id)), event));
    // El tipo de cortesía del sistema no es capacidad a la venta
    const forSale = ticketTypes.filter((t: any) => !t.is_system);
    const unlimited = forSale.some((t: any) => t.quantity == null);
    const capacity = unlimited ? null : forSale.reduce((s: number, t: any) => s + (t.quantity || 0), 0);
    const issued = forSale.reduce((s: number, t: any) => s + t.sold, 0);
    return { ticketTypes, capacity, unlimited, issued, sellThroughPct: capacity ? pct(issued, capacity) : null };
}

/**
 * Entradas vigentes (no anuladas) por tipo, desde event_attendees. Las cortesías emitidas en un tipo de venta se
 * muestran como "<tipo> (cortesía)"; el tipo "Cortesía" del sistema aparece con su nombre.
 */
export async function issuedByTicketType(supabase: any, eventId: number) {
    const rows = await fetchAll<any>(() =>
        supabase.from("event_attendees").select("id, event_ticket_id, status, is_complimentary, event_tickets(ticket_name)").eq("event_id", eventId).order("id", { ascending: true }),
    );
    const byType = new Map<string, { name: string; ticket_type_id: number | null; complimentary: boolean; tickets: number }>();
    for (const a of rows) {
        if (a.status === "cancelled") continue;
        const base = a.event_tickets?.ticket_name || "Desconocido";
        const complimentary = a.is_complimentary === true && !isCourtesyName(base);
        const name = complimentary ? `${base} (cortesía)` : base;
        const row = byType.get(name) || { name, ticket_type_id: a.event_ticket_id != null ? Number(a.event_ticket_id) : null, complimentary, tickets: 0 };
        row.tickets += 1;
        byType.set(name, row);
    }
    return [...byType.values()].sort((a, b) => b.tickets - a.tickets);
}

// ---------------------------------------------------------------------------
// Vistas del panel
// ---------------------------------------------------------------------------

/**
 * Página de analítica de un evento (/dashboard/events/:id/analytics). El evento ya debe estar autorizado.
 * `eventDateId`: además, las ventas por canal de esa función (function_channels; sin visitas: no se sabe a qué función
 * iba quien visitó).
 */
export async function getEventAnalytics(supabase: any, event: { id: number; status?: string | null }, { eventDateId = null }: { eventDateId?: number | null } = {}) {
    const [{ visits, truncated: visitsTruncated, refTracked }, orders, capacity, ticketTypes, { count: refunded }, { functions, ticketFunction }] = await Promise.all([
        loadEventVisits(supabase, event.id),
        loadPaidOrders(supabase, event.id),
        eventCapacity(supabase, event),
        issuedByTicketType(supabase, event.id),
        supabase.from("event_orders").select("id", { count: "exact", head: true }).eq("event_id", event.id).eq("status", "refunded"),
        loadEventFunctions(supabase, event.id),
    ]);
    const selectedFunction = eventDateId != null ? functions.find((f) => f.id === Number(eventDateId)) || null : null;
    const sales = summarizeSales(orders);
    const traffic = summarizeTraffic(visits);
    const { days, truncated: seriesTruncated } = activityDays(visits, sales.sales);
    const checkins = await loadOrderCheckins(supabase, event.id, orders);
    return {
        kpis: {
            visits: traffic.visits,
            unique_visitors: traffic.uniqueVisitors,
            paid_orders: sales.paidOrders,
            tickets_sold: sales.ticketsSold,
            courtesy_tickets: sales.courtesyTickets,
            revenue_clp: sales.revenue,
            conversion_pct: pct(sales.paidOrders, traffic.uniqueVisitors),
            capacity: capacity.capacity,
            issued_tickets: capacity.issued,
            sell_through_pct: capacity.sellThroughPct,
        },
        daily: dailySeries(days, visits, sales.sales),
        series_truncated: seriesTruncated,
        peak_hours: traffic.peakHours,
        sources: traffic.sources,
        locations: traffic.locations,
        channels: channelConversion(visits, sales.sales, { refTracked, checkins }),
        providers: sales.providers,
        ticket_types: ticketTypes,
        refunded_orders: refunded || 0,
        visits_truncated: visitsTruncated,
        ref_tracked: refTracked,
        functions,
        sales_by_function: functions.length > 1 ? salesByFunction(sales.sales, functions, ticketFunction) : [],
        selected_function: selectedFunction,
        function_channels: selectedFunction
            ? summarizeSales(sales.sales.map((o: any) => orderForFunction(o, String(selectedFunction.id), ticketFunction)).filter(Boolean)).channels
            : null,
    };
}

/** Tarjetas del resumen de un evento (/dashboard/events/:id): sin traer las visitas completas. */
export async function getEventSummary(supabase: any, event: { id: number; status?: string | null }) {
    const [visitCounts, orders, capacity, ticketTypes] = await Promise.all([
        eventVisitCounts(supabase, event.id),
        loadPaidOrders(supabase, event.id),
        eventCapacity(supabase, event),
        issuedByTicketType(supabase, event.id),
    ]);
    const sales = summarizeSales(orders);
    const issuedByTypeId: Record<string, number> = {};
    for (const t of ticketTypes) if (t.ticket_type_id != null) issuedByTypeId[t.ticket_type_id] = (issuedByTypeId[t.ticket_type_id] || 0) + t.tickets;
    return {
        visits: visitCounts.visits,
        unique_visitors: visitCounts.unique_visitors,
        paid_orders: sales.paidOrders,
        tickets_sold: sales.ticketsSold,
        courtesy_tickets: sales.courtesyTickets,
        revenue_clp: sales.revenue,
        conversion_pct: pct(sales.paidOrders, visitCounts.unique_visitors),
        capacity: capacity.capacity,
        issued_tickets: capacity.issued,
        sell_through_pct: capacity.sellThroughPct,
        issued_by_ticket_type_id: issuedByTypeId,
    };
}

const ORG_ORDER_COLUMNS = "id, event_id, amount, ticket_qty, ticket_details, payment_provider";
const EVENT_ID_CHUNK = 150;

/** Totales históricos de ventas de un conjunto de eventos (inicio del panel), paginado y por tandas de eventos. */
export async function orgSalesTotals(supabase: any, eventIds: number[]) {
    let paidOrders = 0, ticketsSold = 0, courtesyTickets = 0, revenue = 0;
    for (let i = 0; i < eventIds.length; i += EVENT_ID_CHUNK) {
        const chunk = eventIds.slice(i, i + EVENT_ID_CHUNK);
        const orders = await fetchAll<any>(
            () => supabase.from("event_orders").select(ORG_ORDER_COLUMNS).in("event_id", chunk).eq("status", "paid").order("id", { ascending: true }),
            { max: 500000 },
        );
        const s = summarizeSales(orders);
        paidOrders += s.paidOrders;
        ticketsSold += s.ticketsSold;
        courtesyTickets += s.courtesyTickets;
        revenue += s.revenue;
    }
    return { paid_orders: paidOrders, tickets_sold: ticketsSold, courtesy_tickets: courtesyTickets, revenue_clp: revenue };
}
