// Saldo del productor por evento (fuente única para get_balance, request_payout, liquidaciones y reembolsos).
//
// Reglas:
//   * Neto de ventas = suma de event_orders.amount de órdenes 'paid'. amount ya es lo que recibe el productor:
//     viene descontado por códigos y, si el cargo lo absorbe el productor (fee_absorbed), sin cargo ni su IVA.
//   * Reembolsos parciales = aitickets_refunds.ticket_amount de reembolsos ACTIVOS (requested/processing/
//     completed; ver isActiveRefund) cuya orden SIGUE 'paid'. 'failed' y 'cancelled' no restan.
//     Un reembolso total deja la orden 'refunded', que ya no suma como venta: restarlo otra vez lo contaría
//     dos veces. fee_amount (cargo devuelto al comprador) lo asume AI Tickets, no el productor.
//   * Retirado = event_withdrawals con status requested/processing/paid (incluye las filas manuales antiguas).
//   * Pendiente de cobro = neto - reembolsos parciales - retirado.
//       - available: la última función terminó hace ≥ 48 h y el evento no está cancelado;
//       - pending: el evento aún no termina (o no tiene fecha);
//       - un evento cancelado no libera saldo: queda retenido hasta cuadrar los reembolsos.
//   * retained = órdenes 'review' (pago en revisión manual) + saldo de eventos cancelados.
//   * Un saldo negativo (reembolso después de un retiro) se informa en negative_balance y se descuenta
//     del disponible total.
// Tolera tablas/columnas que aún no existen (deploy preview sin migrar): esas partes cuentan como 0.
import { zonedDateTimeToUtc } from "../../../netlify/lib/dates.mjs";

export const RELEASE_HOURS = 48;
export const WITHDRAWN_STATUSES = ["requested", "processing", "paid"];

/** Reembolsos que cuentan (descuentan saldo y bloquean reembolsar dos veces lo mismo). 'failed'/'cancelled' no. */
export const ACTIVE_REFUND_STATUSES = ["requested", "processing", "completed"];
export const isActiveRefund = (r: { status?: unknown }) => ACTIVE_REFUND_STATUSES.includes(String(r?.status));

export type EventLedger = {
    event_id: number;
    name: string;
    status: string | null;
    cancelled: boolean;
    fee_absorbed: boolean;
    last_function_end: string | null;
    releases_at: string | null;
    released: boolean;
    paid_orders: number;
    tickets: number;
    sales_net: number;
    partial_refunds: number;
    withdrawn: number;
    paid_out: number;
    net_due: number;
    available: number;
    pending: number;
    retained: number;
    in_review: number;
};

export type OrgLedger = {
    events: EventLedger[];
    totals: { available: number; pending: number; retained: number; withdrawn: number; paid_out: number; negative_balance: number; sales_net: number; partial_refunds: number };
};

const PAGE = 1000;

async function fetchAllRows(build: () => any, max = 50000): Promise<any[]> {
    const out: any[] = [];
    for (let from = 0; from < max; from += PAGE) {
        const { data, error } = await build().range(from, from + PAGE - 1);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < PAGE) break;
    }
    return out;
}

/** Lee filas tolerando tabla/columna inexistente (devuelve []). */
async function tolerant(build: () => any): Promise<any[]> {
    try {
        return await fetchAllRows(build);
    } catch (err: any) {
        if (["42P01", "PGRST205", "42703", "PGRST204"].includes(String(err?.code || ""))) return [];
        throw err;
    }
}

/** Eventos de la organización con las columnas nuevas si existen. */
export async function loadOrgEvents(supabase: any, orgId: number, eventIds?: number[] | null): Promise<any[]> {
    const run = (cols: string) => {
        let q = supabase.from("events").select(cols).eq("organization_id", orgId);
        if (eventIds) q = q.in("id", eventIds);
        return q;
    };
    const { data, error } = await run("id, name, status, start_date, end_date, cancelled_at, fee_absorbed");
    if (!error) return data || [];
    const { data: legacy, error: legacyError } = await run("id, name, status, start_date, end_date");
    if (legacyError) throw legacyError;
    return legacy || [];
}

/** Fin de la última función: máximo entre events.end_date y cada event_date (fecha + hora de término, o 23:59). */
export function lastFunctionEnd(event: any, dates: any[]): Date | null {
    let last: number | null = event?.end_date ? new Date(event.end_date).getTime() : null;
    for (const d of dates || []) {
        const start = String(d.start_time || "00:00");
        const endTime = d.end_time ? String(d.end_time) : "23:59";
        let end = zonedDateTimeToUtc(d.date, endTime);
        if (!end) continue;
        if (d.end_time && endTime.slice(0, 5) < start.slice(0, 5)) end = new Date(end.getTime() + 86400000); // termina pasada la medianoche
        if (last == null || end.getTime() > last) last = end.getTime();
    }
    return last == null || Number.isNaN(last) ? null : new Date(last);
}

/** Saldo por evento de la organización (opcionalmente solo algunos eventos). */
export async function computeOrgLedger(supabase: any, orgId: number, opts: { eventIds?: number[] | null; now?: Date } = {}): Promise<OrgLedger> {
    const now = opts.now || new Date();
    const events = await loadOrgEvents(supabase, orgId, opts.eventIds);
    const ids = events.map((e) => Number(e.id));
    const empty: OrgLedger = { events: [], totals: { available: 0, pending: 0, retained: 0, withdrawn: 0, paid_out: 0, negative_balance: 0, sales_net: 0, partial_refunds: 0 } };
    if (!ids.length) return empty;

    const [orders, dates, refunds, withdrawals] = await Promise.all([
        fetchAllRows(() => supabase.from("event_orders").select("id, event_id, status, amount, ticket_qty").in("event_id", ids).in("status", ["paid", "review"])),
        tolerant(() => supabase.from("event_dates").select("event_id, date, start_time, end_time").in("event_id", ids)),
        tolerant(() => supabase.from("aitickets_refunds").select("order_id, event_id, ticket_amount, status").eq("organization_id", orgId).in("event_id", ids)),
        tolerant(() => supabase.from("event_withdrawals").select("event_id, amount, status").in("event_id", ids)),
    ]);

    const paidOrderIds = new Set(orders.filter((o) => o.status === "paid").map((o) => String(o.id)));
    const byEvent = new Map<number, EventLedger>();
    for (const e of events) {
        const end = lastFunctionEnd(e, dates.filter((d) => Number(d.event_id) === Number(e.id)));
        const releasesAt = end ? new Date(end.getTime() + RELEASE_HOURS * 3600000) : null;
        const cancelled = Boolean(e.cancelled_at);
        byEvent.set(Number(e.id), {
            event_id: Number(e.id),
            name: e.name,
            status: e.status ?? null,
            cancelled,
            fee_absorbed: Boolean(e.fee_absorbed),
            last_function_end: end ? end.toISOString() : null,
            releases_at: releasesAt ? releasesAt.toISOString() : null,
            released: Boolean(releasesAt && releasesAt.getTime() <= now.getTime()) && !cancelled,
            paid_orders: 0,
            tickets: 0,
            sales_net: 0,
            partial_refunds: 0,
            withdrawn: 0,
            paid_out: 0,
            net_due: 0,
            available: 0,
            pending: 0,
            retained: 0,
            in_review: 0,
        });
    }
    for (const o of orders) {
        const l = byEvent.get(Number(o.event_id));
        if (!l) continue;
        if (o.status === "paid") {
            l.sales_net += Math.round(Number(o.amount) || 0);
            l.paid_orders += 1;
            l.tickets += Number(o.ticket_qty) || 0;
        } else l.in_review += Math.round(Number(o.amount) || 0);
    }
    for (const r of refunds) {
        if (!isActiveRefund(r) || !paidOrderIds.has(String(r.order_id))) continue;
        const l = byEvent.get(Number(r.event_id));
        if (l) l.partial_refunds += Math.round(Number(r.ticket_amount) || 0);
    }
    for (const w of withdrawals) {
        if (!WITHDRAWN_STATUSES.includes(String(w.status))) continue;
        const l = byEvent.get(Number(w.event_id));
        if (!l) continue;
        const amount = Math.round(Number(w.amount) || 0);
        l.withdrawn += amount;
        if (w.status === "paid") l.paid_out += amount;
    }

    const totals = { ...empty.totals };
    for (const l of byEvent.values()) {
        l.net_due = l.sales_net - l.partial_refunds - l.withdrawn;
        const positive = Math.max(0, l.net_due);
        if (l.cancelled) l.retained = positive;
        else if (l.released) l.available = positive;
        else l.pending = positive;
        l.retained += l.in_review;
        if (l.net_due < 0) totals.negative_balance += -l.net_due;
        totals.available += l.available;
        totals.pending += l.pending;
        totals.retained += l.retained;
        totals.withdrawn += l.withdrawn;
        totals.paid_out += l.paid_out;
        totals.sales_net += l.sales_net;
        totals.partial_refunds += l.partial_refunds;
    }
    totals.available = Math.max(0, totals.available - totals.negative_balance);
    return { events: [...byEvent.values()], totals };
}

/** Saldo de un solo evento (lo usan los reembolsos para no devolver más de lo que queda por pagar). */
export async function computeEventLedger(supabase: any, orgId: number, eventId: number, now?: Date): Promise<EventLedger | null> {
    const ledger = await computeOrgLedger(supabase, orgId, { eventIds: [eventId], now });
    return ledger.events[0] || null;
}

/** Suma `days` días hábiles (lunes a viernes) a una fecha; devuelve YYYY-MM-DD en hora de Chile. */
export function addBusinessDays(from: Date, days: number): string {
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" });
    const [y, m, d] = fmt.format(from).split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d, 12));
    let left = days;
    while (left > 0) {
        date.setUTCDate(date.getUTCDate() + 1);
        const dow = date.getUTCDay();
        if (dow !== 0 && dow !== 6) left -= 1;
    }
    return date.toISOString().slice(0, 10);
}
