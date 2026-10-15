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
//   * Liberación POR FUNCIÓN: cada orden se libera 48 h después de que termina SU función
//     (event_attendees → event_tickets.event_date_id). Una orden con entradas de varias funciones, o con
//     entradas válidas para cualquier función (event_date_id NULL), se libera con la última función del evento.
//       - available: lo liberado (ventas de funciones terminadas hace ≥ 48 h − sus reembolsos − retirado),
//         acotado al saldo del evento; un evento cancelado no libera nada;
//       - pending: el resto (funciones por realizarse o sin fecha);
//       - un evento cancelado no libera saldo: queda retenido hasta cuadrar los reembolsos.
//   * Los retiros solo salen de lo liberado, así que se restan de ese tramo.
//   * retained = órdenes 'review' (pago en revisión manual) + saldo de eventos cancelados.
//   * Un saldo negativo (reembolso después de un retiro) se informa en negative_balance y se descuenta
//     del disponible total.
// Tolera tablas/columnas que aún no existen (deploy preview sin migrar): esas partes cuentan como 0.
import { zonedDateTimeToUtc } from "../../../netlify/lib/dates.mjs";
import { PAYOUT_RELEASE_HOURS } from "../../../netlify/lib/legal.mjs";

export const RELEASE_HOURS = PAYOUT_RELEASE_HOURS;
export const WITHDRAWN_STATUSES = ["requested", "processing", "paid"];

/** Reembolsos que cuentan (descuentan saldo y bloquean reembolsar dos veces lo mismo). 'failed'/'cancelled' no. */
export const ACTIVE_REFUND_STATUSES = ["requested", "processing", "completed"];
export const isActiveRefund = (r: { status?: unknown }) => ACTIVE_REFUND_STATUSES.includes(String(r?.status));

export type FunctionRelease = {
    event_date_id: number;
    date: string;
    start_time: string | null;
    ends_at: string;
    releases_at: string;
    released: boolean;
    sales_net: number;
    tickets: number;
};

export type EventLedger = {
    event_id: number;
    name: string;
    status: string | null;
    cancelled: boolean;
    fee_absorbed: boolean;
    last_function_end: string | null;
    releases_at: string | null;
    /** true cuando TODO el evento está liberado (terminó su última función hace ≥ 48 h). */
    released: boolean;
    /** Próxima liberación pendiente (la primera función que aún no cumple 48 h), si hay. */
    next_release_at: string | null;
    functions: FunctionRelease[];
    paid_orders: number;
    tickets: number;
    sales_net: number;
    /** Ventas netas de órdenes cuya función ya se liberó. */
    released_sales: number;
    partial_refunds: number;
    withdrawn: number;
    paid_out: number;
    net_due: number;
    /** Lo liberado que aún no se retira (puede ser negativo si un reembolso llega después de un retiro). */
    released_due: number;
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

/** Fin de una función: fecha + hora de término (o 23:59) en hora de Chile; si termina antes de empezar, cruza la medianoche. */
export function functionEnd(d: any): Date | null {
    if (!d?.date) return null;
    const start = String(d.start_time || "00:00");
    const endTime = d.end_time ? String(d.end_time) : "23:59";
    let end = zonedDateTimeToUtc(d.date, endTime);
    if (!end) return null;
    if (d.end_time && endTime.slice(0, 5) < start.slice(0, 5)) end = new Date(end.getTime() + 86400000); // termina pasada la medianoche
    return end;
}

/** Fin de la última función: máximo entre events.end_date y cada event_date (fecha + hora de término, o 23:59). */
export function lastFunctionEnd(event: any, dates: any[]): Date | null {
    let last: number | null = event?.end_date ? new Date(event.end_date).getTime() : null;
    for (const d of dates || []) {
        const end = functionEnd(d);
        if (end && (last == null || end.getTime() > last)) last = end.getTime();
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

    const [orders, dates, refunds, withdrawals, tickets, attendees] = await Promise.all([
        fetchAllRows(() => supabase.from("event_orders").select("id, event_id, status, amount, ticket_qty").in("event_id", ids).in("status", ["paid", "review"])),
        tolerant(() => supabase.from("event_dates").select("id, event_id, date, start_time, end_time").in("event_id", ids)),
        tolerant(() => supabase.from("aitickets_refunds").select("order_id, event_id, ticket_amount, status").eq("organization_id", orgId).in("event_id", ids)),
        tolerant(() => supabase.from("event_withdrawals").select("event_id, amount, status").in("event_id", ids)),
        tolerant(() => supabase.from("event_tickets").select("id, event_date_id").in("event_id", ids)),
        tolerant(() => supabase.from("event_attendees").select("event_order_id, event_ticket_id").in("event_id", ids).not("event_order_id", "is", null)),
    ]);

    // Función de cada orden: el conjunto de event_date_id de sus entradas (null = válida para cualquier función).
    const ticketDate = new Map<string, number | null>(tickets.map((t) => [String(t.id), t.event_date_id == null ? null : Number(t.event_date_id)]));
    const orderDates = new Map<string, Set<number | null>>();
    for (const a of attendees) {
        const key = String(a.event_order_id);
        const set = orderDates.get(key) || new Set<number | null>();
        set.add(a.event_ticket_id == null ? null : ticketDate.get(String(a.event_ticket_id)) ?? null);
        orderDates.set(key, set);
    }
    const releaseOf = (end: Date | null) => (end ? new Date(end.getTime() + RELEASE_HOURS * 3600000) : null);

    const paidOrderIds = new Set(orders.filter((o) => o.status === "paid").map((o) => String(o.id)));
    const byEvent = new Map<number, EventLedger>();
    const fnById = new Map<number, FunctionRelease>();
    const eventEnd = new Map<number, Date | null>();
    for (const e of events) {
        const eventDates = dates.filter((d) => Number(d.event_id) === Number(e.id));
        const end = lastFunctionEnd(e, eventDates);
        eventEnd.set(Number(e.id), end);
        const releasesAt = releaseOf(end);
        const cancelled = Boolean(e.cancelled_at);
        const functions: FunctionRelease[] = [];
        for (const d of eventDates) {
            const fEnd = functionEnd(d);
            if (!fEnd || d.id == null) continue;
            const fRelease = releaseOf(fEnd)!;
            const f: FunctionRelease = {
                event_date_id: Number(d.id),
                date: String(d.date).slice(0, 10),
                start_time: d.start_time ? String(d.start_time).slice(0, 5) : null,
                ends_at: fEnd.toISOString(),
                releases_at: fRelease.toISOString(),
                released: fRelease.getTime() <= now.getTime() && !cancelled,
                sales_net: 0,
                tickets: 0,
            };
            functions.push(f);
            fnById.set(f.event_date_id, f);
        }
        functions.sort((a, b) => a.ends_at.localeCompare(b.ends_at));
        byEvent.set(Number(e.id), {
            event_id: Number(e.id),
            name: e.name,
            status: e.status ?? null,
            cancelled,
            fee_absorbed: Boolean(e.fee_absorbed),
            last_function_end: end ? end.toISOString() : null,
            releases_at: releasesAt ? releasesAt.toISOString() : null,
            released: Boolean(releasesAt && releasesAt.getTime() <= now.getTime()) && !cancelled,
            next_release_at: null,
            functions,
            paid_orders: 0,
            tickets: 0,
            sales_net: 0,
            released_sales: 0,
            partial_refunds: 0,
            withdrawn: 0,
            paid_out: 0,
            net_due: 0,
            released_due: 0,
            available: 0,
            pending: 0,
            retained: 0,
            in_review: 0,
        });
    }
    /** Función de una orden si TODAS sus entradas son de la misma función conocida; si no, null (= última del evento). */
    const orderFunction = (o: any): FunctionRelease | null => {
        const set = orderDates.get(String(o.id));
        if (!set || set.size !== 1) return null;
        const [only] = [...set];
        return only == null ? null : fnById.get(only) || null;
    };
    const orderReleased = new Map<string, boolean>();
    for (const o of orders) {
        const l = byEvent.get(Number(o.event_id));
        if (!l) continue;
        if (o.status === "paid") {
            const amount = Math.round(Number(o.amount) || 0);
            const qty = Number(o.ticket_qty) || 0;
            l.sales_net += amount;
            l.paid_orders += 1;
            l.tickets += qty;
            const f = orderFunction(o);
            if (f) {
                f.sales_net += amount;
                f.tickets += qty;
            }
            const release = f ? new Date(f.releases_at) : releaseOf(eventEnd.get(l.event_id) ?? null);
            const released = !l.cancelled && Boolean(release && release.getTime() <= now.getTime());
            orderReleased.set(String(o.id), released);
            if (released) l.released_sales += amount;
        } else l.in_review += Math.round(Number(o.amount) || 0);
    }
    const releasedRefunds = new Map<number, number>();
    for (const r of refunds) {
        if (!isActiveRefund(r) || !paidOrderIds.has(String(r.order_id))) continue;
        const l = byEvent.get(Number(r.event_id));
        if (!l) continue;
        const amount = Math.round(Number(r.ticket_amount) || 0);
        l.partial_refunds += amount;
        if (orderReleased.get(String(r.order_id))) releasedRefunds.set(l.event_id, (releasedRefunds.get(l.event_id) || 0) + amount);
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
        l.released_due = l.released_sales - (releasedRefunds.get(l.event_id) || 0) - l.withdrawn;
        const positive = Math.max(0, l.net_due);
        if (l.cancelled) l.retained = positive;
        else {
            l.available = Math.min(positive, Math.max(0, l.released_due));
            l.pending = positive - l.available;
        }
        if (!l.cancelled && l.pending > 0) {
            const nowIso = now.toISOString();
            const next = l.functions.find((f) => !f.released && f.releases_at > nowIso && f.sales_net > 0)?.releases_at;
            l.next_release_at = next || (l.releases_at && l.releases_at > nowIso ? l.releases_at : null);
        }
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
