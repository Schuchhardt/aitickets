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
//   * Condiciones de liberación (Términos para productores §8). Un tramo que ya cumplió las 48 h se libera solo si:
//       1. la identidad del productor está aprobada (organizations.identity_status = 'approved', Didit);
//       2. la cuenta bancaria está verificada y a nombre de la identidad verificada (holder_match_status = 'match');
//       3. la función tiene check-ins ≥ CHECKIN_RELEASE_THRESHOLD de sus entradas pagadas, o el productor acreditó
//          que se realizó (event_dates.held_attested_at; events.held_attested_at para abonos/órdenes mixtas);
//       4. no hay reclamos ni contracargos abiertos (aitickets_disputes) sobre la función o el evento.
//     Si falla alguna, el tramo queda en held (retenido) con hold_reasons visibles en el panel.
//     Si se cumplen, se aplica la reserva por riesgo: events.reserve_pct % queda retenido hasta RESERVE_HOLD_DAYS
//     días después de la función.
//   * Los retiros solo salen de lo liberado, así que se restan de ese tramo.
//   * retained = órdenes 'review' (pago en revisión manual) + saldo de eventos cancelados + held.
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

export type HoldReasonCode =
    | "identity_pending"
    | "bank_unverified"
    | "holder_unchecked"
    | "holder_mismatch"
    | "low_checkins"
    | "open_disputes"
    | "risk_reserve"
    | "event_cancelled";

export type HoldReason = {
    code: HoldReasonCode;
    /** Texto para el panel (español). */
    label: string;
    /** Monto retenido por este motivo (CLP), cuando aplica. */
    amount?: number;
    /** Fecha en que se libera sola (solo la reserva por riesgo). */
    until?: string | null;
};

export type FunctionRelease = {
    event_date_id: number;
    date: string;
    start_time: string | null;
    ends_at: string;
    releases_at: string;
    /** true cuando lo vendido para la función está liberado: pasaron 48 h, se cumplen las condiciones y no queda reserva. */
    released: boolean;
    sales_net: number;
    tickets: number;
    /** pending: aún no cumple 48 h · held: retenida (ver hold_reasons) · released: liberada · cancelled: evento cancelado. */
    release_status: "pending" | "held" | "released" | "cancelled";
    hold_reasons: HoldReason[];
    /** Entradas pagadas de la función con ingreso registrado. */
    checkins: number;
    /** checkins / entradas pagadas de la función (null si no hay entradas pagadas asignadas a la función). */
    checkin_ratio: number | null;
    /** El productor acreditó que la función se realizó. */
    attested_at: string | null;
    reserve_amount: number;
    reserve_release_at: string | null;
};

export type EventLedger = {
    event_id: number;
    name: string;
    status: string | null;
    cancelled: boolean;
    fee_absorbed: boolean;
    last_function_end: string | null;
    releases_at: string | null;
    /** true cuando TODO el evento está liberado (terminó su última función hace ≥ 48 h y nada queda retenido). */
    released: boolean;
    /** Próxima liberación pendiente (la primera función que aún no cumple 48 h), si hay. */
    next_release_at: string | null;
    functions: FunctionRelease[];
    paid_orders: number;
    tickets: number;
    sales_net: number;
    /** Ventas de órdenes liberadas (descontada la reserva por riesgo). */
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
    /** Parte de retained que cumplió las 48 h pero no las condiciones de liberación (incluye la reserva por riesgo). */
    held: number;
    /** Reserva por riesgo retenida. */
    reserve_amount: number;
    /** Cuándo se libera la última reserva por riesgo pendiente. */
    reserve_release_at: string | null;
    reserve_pct: number;
    risk_level: string | null;
    /** Motivos de retención del evento (los de la organización y los de sus funciones). */
    hold_reasons: HoldReason[];
};

export type OrgLedger = {
    events: EventLedger[];
    totals: {
        available: number;
        pending: number;
        retained: number;
        withdrawn: number;
        paid_out: number;
        negative_balance: number;
        sales_net: number;
        partial_refunds: number;
        held: number;
        reserve: number;
    };
    /** Condiciones de la organización que retienen todo lo vendido (identidad, cuenta bancaria). */
    hold_reasons: HoldReason[];
};

/** Mínimo de check-ins (sobre entradas pagadas de la función) para liberar sin que el productor acredite la función. */
export const CHECKIN_RELEASE_THRESHOLD = 0.3;
/** Días máximos de la reserva por riesgo después de terminar la función. */
export const RESERVE_HOLD_DAYS = 60;
export const OPEN_DISPUTE_STATUSES = ["open"];

export const HOLD_LABELS: Record<HoldReasonCode, string> = {
    identity_pending: "Falta verificar la identidad del productor",
    bank_unverified: "La cuenta bancaria no está verificada",
    holder_unchecked: "Falta comprobar que la cuenta esté a nombre de la persona o empresa verificada",
    holder_mismatch: "El titular de la cuenta no coincide con la identidad verificada (en revisión)",
    low_checkins: "La función tiene pocos ingresos registrados: acredita que se realizó",
    open_disputes: "Hay reclamos o contracargos abiertos",
    risk_reserve: "Reserva por riesgo",
    event_cancelled: "Evento cancelado: retenido hasta cuadrar las devoluciones",
};

const holdReason = (code: HoldReasonCode, extra: Partial<HoldReason> = {}): HoldReason => ({ code, label: HOLD_LABELS[code], ...extra });

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

const MISSING_CODES = ["42P01", "PGRST205", "42703", "PGRST204"];
const isMissing = (err: any) => MISSING_CODES.includes(String(err?.code || ""));

/** Lee filas tolerando tabla/columna inexistente (devuelve []). */
async function tolerant(build: () => any): Promise<any[]> {
    try {
        return await fetchAllRows(build);
    } catch (err: any) {
        if (isMissing(err)) return [];
        throw err;
    }
}

/** Como tolerant, pero prueba listas de columnas de la más nueva a la más antigua (deploy sin migrar). */
async function tolerantCols(build: (cols: string) => any, colsList: string[]): Promise<any[]> {
    for (const cols of colsList) {
        try {
            return await fetchAllRows(() => build(cols));
        } catch (err: any) {
            if (!isMissing(err)) throw err;
        }
    }
    return [];
}

/** Eventos de la organización con las columnas nuevas si existen. */
export async function loadOrgEvents(supabase: any, orgId: number, eventIds?: number[] | null): Promise<any[]> {
    const run = (cols: string) => {
        let q = supabase.from("events").select(cols).eq("organization_id", orgId);
        if (eventIds) q = q.in("id", eventIds);
        return q;
    };
    for (const cols of [
        "id, name, status, start_date, end_date, cancelled_at, fee_absorbed, reserve_pct, risk_level, held_attested_at",
        "id, name, status, start_date, end_date, cancelled_at, fee_absorbed",
    ]) {
        const { data, error } = await run(cols);
        if (!error) return data || [];
        if (!isMissing(error)) throw error;
    }
    const { data: legacy, error: legacyError } = await run("id, name, status, start_date, end_date");
    if (legacyError) throw legacyError;
    return legacy || [];
}

/**
 * Condiciones de la organización para liberar fondos: identidad aprobada (Didit) y cuenta bancaria verificada a nombre
 * de la misma persona o empresa (holder_match_status = 'match'). Si las columnas aún no existen (deploy sin migrar), no se exigen.
 */
export async function loadOrgReleaseGate(supabase: any, orgId: number): Promise<HoldReason[]> {
    const reasons: HoldReason[] = [];
    const { data: org, error: orgError } = await supabase.from("organizations").select("id, identity_status, identity_verified_at").eq("id", orgId).maybeSingle();
    if (orgError && !isMissing(orgError)) throw orgError;
    if (!orgError && !(org?.identity_status === "approved" && org?.identity_verified_at)) reasons.push(holdReason("identity_pending"));

    const { data: acc, error: accError } = await supabase
        .from("organization_payout_accounts")
        .select("organization_id, verified_at, removed_at, holder_match_status")
        .eq("organization_id", orgId)
        .maybeSingle();
    if (accError && !isMissing(accError)) throw accError;
    if (!accError) {
        if (!acc?.verified_at || acc?.removed_at) reasons.push(holdReason("bank_unverified"));
        else if (acc.holder_match_status === "mismatch") reasons.push(holdReason("holder_mismatch"));
        else if (acc.holder_match_status !== "match") reasons.push(holdReason("holder_unchecked"));
    }
    return reasons;
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

const isCheckedIn = (a: any) => Boolean(a?.validated_at) || a?.status === "validated";

function mergeReason(into: HoldReason[], add: HoldReason) {
    const found = into.find((r) => r.code === add.code);
    if (!found) {
        into.push({ ...add });
        return;
    }
    if (add.amount != null) found.amount = (found.amount || 0) + add.amount;
    if (add.until && (!found.until || add.until > found.until)) found.until = add.until;
}

/** Saldo por evento de la organización (opcionalmente solo algunos eventos). */
export async function computeOrgLedger(supabase: any, orgId: number, opts: { eventIds?: number[] | null; now?: Date } = {}): Promise<OrgLedger> {
    const now = opts.now || new Date();
    const events = await loadOrgEvents(supabase, orgId, opts.eventIds);
    const ids = events.map((e) => Number(e.id));
    const empty: OrgLedger = {
        events: [],
        totals: { available: 0, pending: 0, retained: 0, withdrawn: 0, paid_out: 0, negative_balance: 0, sales_net: 0, partial_refunds: 0, held: 0, reserve: 0 },
        hold_reasons: [],
    };
    if (!ids.length) return empty;

    const [orders, dates, refunds, withdrawals, tickets, attendees, disputes, orgReasons] = await Promise.all([
        fetchAllRows(() => supabase.from("event_orders").select("id, event_id, status, amount, ticket_qty").in("event_id", ids).in("status", ["paid", "review"])),
        tolerantCols(
            (cols) => supabase.from("event_dates").select(cols).in("event_id", ids),
            ["id, event_id, date, start_time, end_time, held_attested_at", "id, event_id, date, start_time, end_time"],
        ),
        tolerant(() => supabase.from("aitickets_refunds").select("order_id, event_id, ticket_amount, status").eq("organization_id", orgId).in("event_id", ids)),
        tolerant(() => supabase.from("event_withdrawals").select("event_id, amount, status").in("event_id", ids)),
        tolerant(() => supabase.from("event_tickets").select("id, event_date_id").in("event_id", ids)),
        tolerantCols(
            (cols) => supabase.from("event_attendees").select(cols).in("event_id", ids).not("event_order_id", "is", null),
            ["event_order_id, event_ticket_id, status, validated_at", "event_order_id, event_ticket_id"],
        ),
        tolerant(() => supabase.from("aitickets_disputes").select("event_id, event_date_id, order_id, status").in("event_id", ids).in("status", OPEN_DISPUTE_STATUSES)),
        loadOrgReleaseGate(supabase, orgId),
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
    const reserveUntilOf = (end: Date | null) => (end ? new Date(end.getTime() + RESERVE_HOLD_DAYS * 86400000) : null);

    const paidOrderIds = new Set(orders.filter((o) => o.status === "paid").map((o) => String(o.id)));

    // Check-ins de entradas pagadas, por función y por evento (abonos y órdenes mixtas usan los del evento).
    const orderEvent = new Map<string, number>(orders.map((o) => [String(o.id), Number(o.event_id)]));
    const checkinsByFn = new Map<number, { sold: number; in: number }>();
    const checkinsByEvent = new Map<number, { sold: number; in: number }>();
    const bump = (map: Map<number, { sold: number; in: number }>, key: number, a: any) => {
        const c = map.get(key) || { sold: 0, in: 0 };
        c.sold += 1;
        if (isCheckedIn(a)) c.in += 1;
        map.set(key, c);
    };
    for (const a of attendees) {
        if (!paidOrderIds.has(String(a.event_order_id)) || a.status === "cancelled") continue;
        const evId = orderEvent.get(String(a.event_order_id));
        if (evId == null) continue;
        bump(checkinsByEvent, evId, a);
        const fnId = a.event_ticket_id == null ? null : ticketDate.get(String(a.event_ticket_id)) ?? null;
        if (fnId != null) bump(checkinsByFn, fnId, a);
    }
    const ratio = (c?: { sold: number; in: number }) => (c && c.sold > 0 ? c.in / c.sold : null);

    const disputedEvents = new Set<number>();
    const disputedFns = new Set<number>();
    for (const d of disputes) {
        if (d.event_date_id != null) disputedFns.add(Number(d.event_date_id));
        else disputedEvents.add(Number(d.event_id));
    }

    const byEvent = new Map<number, EventLedger>();
    const fnById = new Map<number, FunctionRelease>();
    const eventEnd = new Map<number, Date | null>();
    const eventRow = new Map<number, any>();
    for (const e of events) {
        eventRow.set(Number(e.id), e);
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
            const c = checkinsByFn.get(Number(d.id));
            const f: FunctionRelease = {
                event_date_id: Number(d.id),
                date: String(d.date).slice(0, 10),
                start_time: d.start_time ? String(d.start_time).slice(0, 5) : null,
                ends_at: fEnd.toISOString(),
                releases_at: fRelease.toISOString(),
                released: false,
                sales_net: 0,
                tickets: 0,
                release_status: cancelled ? "cancelled" : fRelease.getTime() <= now.getTime() ? "released" : "pending",
                hold_reasons: [],
                checkins: c?.in || 0,
                checkin_ratio: ratio(c),
                attested_at: d.held_attested_at || null,
                reserve_amount: 0,
                reserve_release_at: null,
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
            released: false,
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
            held: 0,
            reserve_amount: 0,
            reserve_release_at: null,
            reserve_pct: Math.max(0, Math.min(100, Math.round(Number(e.reserve_pct) || 0))),
            risk_level: e.risk_level ?? null,
            hold_reasons: [],
        });
    }
    /** Función de una orden si TODAS sus entradas son de la misma función conocida; si no, null (= última del evento). */
    const orderFunction = (o: any): FunctionRelease | null => {
        const set = orderDates.get(String(o.id));
        if (!set || set.size !== 1) return null;
        const [only] = [...set];
        return only == null ? null : fnById.get(only) || null;
    };

    /** Motivos que retienen un tramo que ya cumplió las 48 h: la función o, para abonos y órdenes mixtas, el evento. */
    const conditionsFor = (l: EventLedger, f: FunctionRelease | null): HoldReason[] => {
        const out = orgReasons.map((r) => ({ ...r }));
        let attested: boolean;
        let r: number | null;
        if (f) {
            attested = Boolean(f.attested_at);
            r = f.checkin_ratio;
        } else {
            const lastFn = l.functions[l.functions.length - 1];
            attested = Boolean(eventRow.get(l.event_id)?.held_attested_at || lastFn?.attested_at);
            r = ratio(checkinsByEvent.get(l.event_id));
        }
        if (!attested && r != null && r < CHECKIN_RELEASE_THRESHOLD) out.push(holdReason("low_checkins"));
        if (disputedEvents.has(l.event_id) || (f && disputedFns.has(f.event_date_id))) out.push(holdReason("open_disputes"));
        return out;
    };

    // Reembolsos activos por orden: se descuentan del tramo de su orden.
    const refundsByOrder = new Map<string, number>();
    for (const r of refunds) {
        if (!isActiveRefund(r) || !paidOrderIds.has(String(r.order_id))) continue;
        const l = byEvent.get(Number(r.event_id));
        if (!l) continue;
        const amount = Math.round(Number(r.ticket_amount) || 0);
        l.partial_refunds += amount;
        refundsByOrder.set(String(r.order_id), (refundsByOrder.get(String(r.order_id)) || 0) + amount);
    }

    const releasedNet = new Map<number, number>();
    const heldNet = new Map<number, number>();
    const add = (m: Map<number, number>, k: number, v: number) => m.set(k, (m.get(k) || 0) + v);
    for (const o of orders) {
        const l = byEvent.get(Number(o.event_id));
        if (!l) continue;
        const amount = Math.round(Number(o.amount) || 0);
        if (o.status !== "paid") {
            l.in_review += amount;
            continue;
        }
        const qty = Number(o.ticket_qty) || 0;
        l.sales_net += amount;
        l.paid_orders += 1;
        l.tickets += qty;
        const f = orderFunction(o);
        if (f) {
            f.sales_net += amount;
            f.tickets += qty;
        }
        if (l.cancelled) continue;
        const end = f ? new Date(f.ends_at) : eventEnd.get(l.event_id) ?? null;
        const release = releaseOf(end);
        if (!release || release.getTime() > now.getTime()) continue; // aún no cumple 48 h: pendiente

        const net = amount - (refundsByOrder.get(String(o.id)) || 0);
        const reasons = conditionsFor(l, f);
        if (reasons.length) {
            add(heldNet, l.event_id, net);
            for (const r of reasons) {
                mergeReason(l.hold_reasons, { ...r, amount: net });
                if (f) mergeReason(f.hold_reasons, { ...r, amount: net });
            }
            if (f) f.release_status = "held";
            continue;
        }
        // Reserva por riesgo: un % de lo vendido queda retenido hasta RESERVE_HOLD_DAYS días después de la función.
        const until = reserveUntilOf(end);
        const reserve = l.reserve_pct > 0 && until && until.getTime() > now.getTime() ? Math.round((Math.max(0, net) * l.reserve_pct) / 100) : 0;
        if (reserve > 0) {
            const untilIso = until!.toISOString();
            l.reserve_amount += reserve;
            if (!l.reserve_release_at || untilIso > l.reserve_release_at) l.reserve_release_at = untilIso;
            add(heldNet, l.event_id, reserve);
            const rr = holdReason("risk_reserve", { amount: reserve, until: untilIso });
            mergeReason(l.hold_reasons, rr);
            if (f) {
                f.reserve_amount += reserve;
                if (!f.reserve_release_at || untilIso > f.reserve_release_at) f.reserve_release_at = untilIso;
                mergeReason(f.hold_reasons, rr);
            }
        }
        l.released_sales += amount - Math.round((amount * (reserve > 0 ? l.reserve_pct : 0)) / 100);
        add(releasedNet, l.event_id, net - reserve);
    }
    for (const f of fnById.values()) {
        if (f.release_status === "released" && f.reserve_amount > 0) f.release_status = "held";
        f.released = f.release_status === "released";
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
    const nowIso = now.toISOString();
    for (const l of byEvent.values()) {
        l.net_due = l.sales_net - l.partial_refunds - l.withdrawn;
        l.released_due = (releasedNet.get(l.event_id) || 0) - l.withdrawn;
        const positive = Math.max(0, l.net_due);
        if (l.cancelled) {
            l.retained = positive;
            if (positive > 0) l.hold_reasons.push(holdReason("event_cancelled", { amount: positive }));
        } else {
            l.available = Math.min(positive, Math.max(0, l.released_due));
            l.held = Math.min(positive - l.available, Math.max(0, heldNet.get(l.event_id) || 0));
            l.pending = positive - l.available - l.held;
            l.retained = l.held;
        }
        const releasesAt = l.releases_at ? new Date(l.releases_at) : null;
        l.released = !l.cancelled && Boolean(releasesAt && releasesAt.getTime() <= now.getTime()) && l.held === 0;
        if (!l.cancelled && l.pending > 0) {
            const next = l.functions.find((f) => f.release_status === "pending" && f.releases_at > nowIso && f.sales_net > 0)?.releases_at;
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
        totals.held += l.held;
        totals.reserve += Math.min(l.reserve_amount, l.held);
    }
    totals.available = Math.max(0, totals.available - totals.negative_balance);
    return { events: [...byEvent.values()], totals, hold_reasons: orgReasons };
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
