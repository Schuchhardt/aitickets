// Métricas de plataforma del MCP de administración: UNA sola definición (docs/specs/mcp-admin.md, sección 6).
//   Orden vendida   = 'paid' y no es cortesía ni transferencia (src/lib/orderKinds.ts); fecha = created_at (Chile)
//   Ventas brutas   = Σ total_payment (lo que cobró Flow); si falta, amount + ticket_fee + service_fee_tax
//   Neto productor  = Σ amount (ya sin descuentos ni cargo absorbido)
//   Ingreso AI Tix  = Σ ticket_fee (cargo neto, sin IVA)        IVA del cargo = Σ service_fee_tax (se declara)
//   Costo Flow      = Σ payment_fee                              Descuentos    = Σ discount_amount
// Los eventos demo (isDemoEventSlug) se excluyen de todo agregado.
// Se calcula en TypeScript reutilizando orderKinds (no se duplica en SQL); consultas paginadas y por tandas.
import { fetchAll, localDay } from "../producer-api/tools/common";
import { ToolError, type JsonSchema } from "../producer-api/registry";
import { isCourtesyOrder, isTransferOrder, orderSoldQty } from "../orderKinds";
import { isDemoEventSlug } from "../demoEvent.mjs";
import { addDays, todayInTimeZone, zonedDateTimeToUtc } from "../../../netlify/lib/dates.mjs";

export const TZ = "America/Santiago";
const EVENT_ID_CHUNK = 150;
/** Tope de un período (días). */
export const MAX_PERIOD_DAYS = 366;

export const SALE_ORDER_COLUMNS =
    "id, event_id, created_at, amount, ticket_fee, service_fee_tax, total_payment, payment_fee, discount_amount, ticket_qty, ticket_details, payment_provider";

export type SalesTotals = {
    paid_orders: number;
    tickets_sold: number;
    courtesy_tickets: number;
    gross_sales_clp: number;
    producer_net_clp: number;
    aitickets_fee_net_clp: number;
    fee_iva_clp: number;
    flow_cost_clp: number;
    discounts_clp: number;
    last_sale_at: string | null;
};

export const emptyTotals = (): SalesTotals => ({
    paid_orders: 0,
    tickets_sold: 0,
    courtesy_tickets: 0,
    gross_sales_clp: 0,
    producer_net_clp: 0,
    aitickets_fee_net_clp: 0,
    fee_iva_clp: 0,
    flow_cost_clp: 0,
    discounts_clp: 0,
    last_sale_at: null,
});

const num = (v: unknown) => Math.round(Number(v) || 0);

/** Suma una orden 'paid' a los totales según las definiciones canónicas. */
export function addOrder(t: SalesTotals, o: any): SalesTotals {
    if (isTransferOrder(o)) return t;
    if (isCourtesyOrder(o)) {
        t.courtesy_tickets += orderSoldQty(o);
        return t;
    }
    const amount = num(o.amount);
    const fee = num(o.ticket_fee);
    const iva = num(o.service_fee_tax);
    t.paid_orders += 1;
    t.tickets_sold += orderSoldQty(o);
    t.producer_net_clp += amount;
    t.aitickets_fee_net_clp += fee;
    t.fee_iva_clp += iva;
    t.gross_sales_clp += o.total_payment != null && o.total_payment !== "" ? num(o.total_payment) : amount + fee + iva;
    t.flow_cost_clp += num(o.payment_fee);
    t.discounts_clp += num(o.discount_amount);
    if (o.created_at && (!t.last_sale_at || o.created_at > t.last_sale_at)) t.last_sale_at = o.created_at;
    return t;
}

export const totalsFromOrders = (orders: any[]) => orders.reduce((t, o) => addOrder(t, o), emptyTotals());

export function mergeTotals(a: SalesTotals, b: SalesTotals): SalesTotals {
    const out = emptyTotals();
    for (const k of Object.keys(out) as (keyof SalesTotals)[]) {
        if (k === "last_sale_at") continue;
        (out as any)[k] = (a as any)[k] + (b as any)[k];
    }
    out.last_sale_at = [a.last_sale_at, b.last_sale_at].filter(Boolean).sort().pop() || null;
    return out;
}

/** Ticket promedio y margen derivados de los totales. */
export function derivedMoney(t: SalesTotals) {
    return {
        avg_order_clp: t.paid_orders ? Math.round(t.gross_sales_clp / t.paid_orders) : 0,
        aitickets_margin_before_refunds_clp: t.aitickets_fee_net_clp - t.flow_cost_clp,
    };
}

export type Period = { from: string; to: string; fromIso: string; toIso: string; days: number };

/** Días YYYY-MM-DD (Chile) → instantes UTC [fromIso, toIso). */
export function periodFromDays(from: string, to: string): Period {
    const fromIso = (zonedDateTimeToUtc(from, "00:00") as Date).toISOString();
    const toIso = (zonedDateTimeToUtc(addDays(to, 1), "00:00") as Date).toISOString();
    const days = Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86400000);
    return { from, to, fromIso, toIso, days };
}

export const PERIOD_PRESETS = ["today", "7d", "30d", "90d", "this_month", "last_month", "ytd", "all"] as const;

export const periodSchema: Record<string, JsonSchema> = {
    preset: { type: "string", enum: PERIOD_PRESETS, description: "Período predefinido (días locales de Chile). Por defecto 30d. Se ignora si vienen from/to." },
    from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Desde (YYYY-MM-DD, hora de Chile, inclusive)." },
    to: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Hasta (YYYY-MM-DD, hora de Chile, inclusive)." },
};

/** Inicio de la plataforma para el preset "all". */
const PLATFORM_START = "2024-01-01";

/** Período pedido (preset o from/to) y el período anterior del mismo largo, para comparar. */
export function resolvePeriod(args: { preset?: string; from?: string; to?: string }, now = new Date()): { current: Period; previous: Period | null } {
    const today = todayInTimeZone(TZ, now);
    let from: string;
    let to = today;
    if (args.from || args.to) {
        from = args.from || addDays(args.to || today, -29);
        to = args.to || today;
    } else {
        const preset = args.preset || "30d";
        const [y, m] = today.split("-").map(Number);
        if (preset === "today") from = today;
        else if (preset === "7d") from = addDays(today, -6);
        else if (preset === "90d") from = addDays(today, -89);
        else if (preset === "this_month") from = `${today.slice(0, 7)}-01`;
        else if (preset === "last_month") {
            const lm = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
            from = lm;
            to = addDays(`${today.slice(0, 7)}-01`, -1);
        } else if (preset === "ytd") from = `${y}-01-01`;
        else if (preset === "all") from = PLATFORM_START;
        else from = addDays(today, -29);
    }
    if (from > to) throw new ToolError("invalid_input", `El período está al revés: from (${from}) es posterior a to (${to}).`);
    const current = periodFromDays(from, to);
    if (args.preset !== "all" && current.days > MAX_PERIOD_DAYS) {
        throw new ToolError("invalid_input", `El período es de ${current.days} días; el máximo es ${MAX_PERIOD_DAYS} (usa preset "all" para el histórico).`);
    }
    const previous = args.preset === "all" ? null : periodFromDays(addDays(from, -current.days), addDays(from, -1));
    return { current, previous };
}

/** Variación porcentual (1 decimal) o null si no hay base. */
export const pctChange = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null);
export const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 1000) / 10 : null);

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------

export const PLATFORM_EVENT_COLUMNS = "id, name, slug, status, accessibility, organization_id, start_date, end_date, created_at, archived_at, cancelled_at, capacity";

/** Eventos de la plataforma sin los demo (con archived_at/cancelled_at si existen). */
export async function loadPlatformEvents(supabase: any, opts: { orgIds?: number[] | null; includeDemo?: boolean } = {}): Promise<any[]> {
    const build = (cols: string) => () => {
        let q = supabase.from("events").select(cols).order("id", { ascending: true });
        if (opts.orgIds) q = q.in("organization_id", opts.orgIds);
        return q;
    };
    let rows: any[];
    try {
        rows = await fetchAll<any>(build(PLATFORM_EVENT_COLUMNS), { max: 100000 });
    } catch (err: any) {
        if (!["42703", "PGRST204"].includes(String(err?.code || ""))) throw err;
        rows = await fetchAll<any>(build("id, name, slug, status, accessibility, organization_id, start_date, end_date, created_at"), { max: 100000 });
    }
    return opts.includeDemo ? rows : rows.filter((e) => !isDemoEventSlug(e.slug));
}

/** Órdenes 'paid' de esos eventos (por tandas), opcionalmente solo las creadas en [fromIso, toIso). */
export async function loadPaidOrders(supabase: any, eventIds: number[], period?: Pick<Period, "fromIso" | "toIso"> | null): Promise<any[]> {
    const out: any[] = [];
    for (let i = 0; i < eventIds.length; i += EVENT_ID_CHUNK) {
        const chunk = eventIds.slice(i, i + EVENT_ID_CHUNK);
        const rows = await fetchAll<any>(
            () => {
                let q = supabase.from("event_orders").select(SALE_ORDER_COLUMNS).in("event_id", chunk).eq("status", "paid");
                if (period) q = q.gte("created_at", period.fromIso).lt("created_at", period.toIso);
                return q.order("id", { ascending: true });
            },
            { max: 500000 },
        );
        out.push(...rows);
    }
    return out;
}

/** Totales por evento (Map event_id → SalesTotals). */
export function totalsByEvent(orders: any[]): Map<number, SalesTotals> {
    const map = new Map<number, SalesTotals>();
    for (const o of orders) {
        const id = Number(o.event_id);
        map.set(id, addOrder(map.get(id) || emptyTotals(), o));
    }
    return map;
}

/** Totales por organización a partir de los totales por evento. */
export function totalsByOrg(events: any[], byEvent: Map<number, SalesTotals>): Map<number, SalesTotals> {
    const map = new Map<number, SalesTotals>();
    for (const e of events) {
        const t = byEvent.get(Number(e.id));
        if (!t) continue;
        const org = Number(e.organization_id);
        map.set(org, mergeTotals(map.get(org) || emptyTotals(), t));
    }
    return map;
}

/** Ventas por día local (Chile) de órdenes ya cargadas. */
export function salesByDay(orders: any[]): Map<string, SalesTotals> {
    const map = new Map<string, SalesTotals>();
    for (const o of orders) {
        const d = localDay(o.created_at);
        map.set(d, addOrder(map.get(d) || emptyTotals(), o));
    }
    return map;
}

// ---------------------------------------------------------------------------
// Segmentos de productores
// ---------------------------------------------------------------------------

export const SEGMENTS = ["sin_verificar", "sin_evento", "activo", "publicado_sin_ventas", "borrador_estancado", "en_riesgo", "inactivo"] as const;
export type Segment = (typeof SEGMENTS)[number];

export const SEGMENT_LABELS: Record<Segment, string> = {
    sin_verificar: "Correo sin verificar",
    sin_evento: "Verificado, sin eventos",
    activo: "Vendió en los últimos 30 días o tiene un evento próximo con ventas",
    publicado_sin_ventas: "Evento publicado próximo sin ninguna venta",
    borrador_estancado: "Solo borradores (el último con más de 3 días)",
    en_riesgo: "Vendía (30–90 días atrás), nada reciente y sin evento próximo",
    inactivo: "Sin actividad reciente",
};

/**
 * Segmento de una organización.
 * @param org  fila de organizations (email_verified_at)
 * @param events  sus eventos (no demo)
 * @param sales  sus órdenes vendidas ({ event_id, created_at }), de cualquier fecha
 */
export function segmentFor(org: any, events: any[], sales: Array<{ event_id: number; created_at: string }>, now = new Date()): Segment {
    if (!org?.email_verified_at) return "sin_verificar";
    const live = events.filter((e) => !e.archived_at);
    if (!live.length) return "sin_evento";
    const nowMs = now.getTime();
    const daysAgo = (iso: string) => (nowMs - Date.parse(iso)) / 86400000;
    const withSales = new Set(sales.map((o) => Number(o.event_id)));
    const upcomingPublished = live.filter((e) => e.status === "published" && !e.cancelled_at && (!e.end_date || Date.parse(e.end_date) >= nowMs));
    if (sales.some((o) => daysAgo(o.created_at) <= 30) || upcomingPublished.some((e) => withSales.has(Number(e.id)))) return "activo";
    if (upcomingPublished.length) return "publicado_sin_ventas";
    if (!live.some((e) => e.status === "published")) {
        const lastDraft = live.map((e) => e.created_at).filter(Boolean).sort().pop();
        if (lastDraft && daysAgo(lastDraft) > 3) return "borrador_estancado";
    }
    if (sales.some((o) => daysAgo(o.created_at) <= 90)) return "en_riesgo";
    return "inactivo";
}
