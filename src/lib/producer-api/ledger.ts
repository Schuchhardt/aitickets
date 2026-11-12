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
//       2. (la cuenta bancaria no se verifica: solo la identidad de la persona);
//       3. la función tiene al menos MIN_CHECKINS_FOR_RELEASE check-ins (o todas sus entradas pagadas, si vendió menos),
//          o el productor acreditó que se realizó (event_dates.held_attested_at; events.held_attested_at para abonos/órdenes mixtas);
//       4. no hay reclamos ni contracargos abiertos (aitickets_disputes) sobre la función o el evento.
//     Si falla alguna, el tramo queda en held (retenido) con hold_reasons visibles en el panel.
//     No hay reserva por riesgo: si se cumplen, se libera el 100% (events.reserve_pct ya no retiene nada).
//   * Los retiros solo salen de lo liberado, así que se restan de ese tramo.
//   * retained = órdenes 'review' (pago en revisión manual) + saldo de eventos cancelados + held.
//   * Un saldo negativo (reembolso después de un retiro) se informa en negative_balance y se descuenta
//     del disponible total.
// Tolera tablas/columnas que aún no existen (deploy preview sin migrar): esas partes cuentan como 0.
import { zonedDateTimeToUtc } from "../../../netlify/lib/dates.mjs";
import { PAYOUT_RELEASE_HOURS } from "../../../netlify/lib/legal.mjs";
import { orgExceedsFreeSoldTickets } from "../producerIdentity";

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
    /**
     * Ingresos de entradas pagadas del evento entero. unassigned_* son las entradas sin función asignada (válidas para
     * cualquier función, abonos): no cuentan en functions[].checkins, pero sí aquí y en la regla de liberación del evento.
     */
    checkins: { sold: number; checked_in: number; unassigned_sold: number; unassigned_checked_in: number };
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

/** Check-ins mínimos (de entradas pagadas) para liberar sin que el productor acredite la función. Basta con un par:
 *  solo prueban que la función se hizo. Si se vendieron menos entradas, basta con que entren todas. */
export const MIN_CHECKINS_FOR_RELEASE = 2;
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
        "id, name, status, start_date, end_date, cancelled_at, fee_absorbed, reserve_pct, risk_level, held_attested_at, released_early_at, release_override_at",
        "id, name, status, start_date, end_date, cancelled_at, fee_absorbed, reserve_pct, risk_level, held_attested_at, released_early_at",
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

async function loadOrgReleaseHours(supabase: any, orgId: number): Promise<number> {
    const { data, error } = await supabase.from("organizations").select("release_delay_hours").eq("id", orgId).maybeSingle();
    if (error && !isMissing(error)) throw error;
    return data?.release_delay_hours ?? RELEASE_HOURS;
}

/**
 * Condiciones de la organización para liberar fondos: si la org supera el umbral de entradas vendidas
 * (IDENTITY_FREE_SOLD_TICKETS), identidad aprobada (Didit). La cuenta bancaria no se verifica.
 * Si las columnas aún no existen (deploy sin migrar), no se exigen.
 */
export async function loadOrgReleaseGate(supabase: any, orgId: number): Promise<HoldReason[]> {
    const reasons: HoldReason[] = [];

    const identityRequired = await orgExceedsThreshold(supabase, orgId);
    if (identityRequired) {
        const { data: org, error: orgError } = await supabase.from("organizations").select("id, identity_status, identity_verified_at").eq("id", orgId).maybeSingle();
        if (orgError && !isMissing(orgError)) throw orgError;
        if (!orgError && !(org?.identity_status === "approved" && org?.identity_verified_at)) reasons.push(holdReason("identity_pending"));
    }
    return reasons;
}

/** true si la organización lleva más de IDENTITY_FREE_SOLD_TICKETS entradas vendidas. */
async function orgExceedsThreshold(supabase: any, orgId: number): Promise<boolean> {
    try {
        return await orgExceedsFreeSoldTickets(supabase, orgId);
    } catch {
        return true;
    }
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
/**
 * Liberación anticipada que se SIMULA sin escribir (release_event_funds la usa para mostrar el monto exacto antes
 * de confirmar): el evento entero o solo esas funciones, con o sin omitir las condiciones.
 */
export type AssumeEarlyRelease = { eventId: number; eventDateIds?: number[] | null; override?: boolean };

export async function computeOrgLedger(
    supabase: any,
    orgId: number,
    opts: { eventIds?: number[] | null; now?: Date; assumeEarlyRelease?: AssumeEarlyRelease | null } = {},
): Promise<OrgLedger> {
    const now = opts.now || new Date();
    const events = await loadOrgEvents(supabase, orgId, opts.eventIds);
    const simulated = opts.assumeEarlyRelease || null;
    if (simulated) {
        const nowIso = now.toISOString();
        for (const e of events) {
            if (Number(e.id) !== simulated.eventId || simulated.eventDateIds?.length) continue;
            e.released_early_at = e.released_early_at || nowIso;
            if (simulated.override) e.release_override_at = e.release_override_at || nowIso;
        }
    }
    const ids = events.map((e) => Number(e.id));
    const empty: OrgLedger = {
        events: [],
        totals: { available: 0, pending: 0, retained: 0, withdrawn: 0, paid_out: 0, negative_balance: 0, sales_net: 0, partial_refunds: 0, held: 0, reserve: 0 },
        hold_reasons: [],
    };
    if (!ids.length) return empty;

    const [orders, dates, refunds, withdrawals, tickets, attendees, disputes, orgReasons] = await Promise.all([
        fetchAllRows(() => supabase.from("event_orders").select("id, event_id, status, amount, ticket_qty, total_payment").in("event_id", ids).in("status", ["paid", "review"])),
        tolerantCols(
            (cols) => supabase.from("event_dates").select(cols).in("event_id", ids),
            [
                "id, event_id, date, start_time, end_time, held_attested_at, released_early_at, release_override_at",
                "id, event_id, date, start_time, end_time, held_attested_at, released_early_at",
                "id, event_id, date, start_time, end_time, held_attested_at",
                "id, event_id, date, start_time, end_time",
            ],
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
    const orgReleaseHours = await loadOrgReleaseHours(supabase, orgId);
    const releaseOf = (end: Date | null) => (end ? new Date(end.getTime() + orgReleaseHours * 3600000) : null);

    const paidOrderIds = new Set(orders.filter((o) => o.status === "paid").map((o) => String(o.id)));
    const courtesyOrderIds = new Set(orders.filter((o) => o.status === "paid" && o.total_payment != null && Number(o.total_payment) === 0).map((o) => String(o.id)));

    // Check-ins de entradas pagadas, por función y por evento (abonos y órdenes mixtas usan los del evento).
    const orderEvent = new Map<string, number>(orders.map((o) => [String(o.id), Number(o.event_id)]));
    const checkinsByFn = new Map<number, { sold: number; in: number }>();
    const checkinsByEvent = new Map<number, { sold: number; in: number }>();
    const checkinsUnassigned = new Map<number, { sold: number; in: number }>();
    const courtesyByFn = new Map<number, number>();
    const courtesyByEvent = new Map<number, number>();
    const bump = (map: Map<number, { sold: number; in: number }>, key: number, a: any) => {
        const c = map.get(key) || { sold: 0, in: 0 };
        c.sold += 1;
        if (isCheckedIn(a)) c.in += 1;
        map.set(key, c);
    };
    const bumpCourtesy = (map: Map<number, number>, key: number) => map.set(key, (map.get(key) || 0) + 1);
    for (const a of attendees) {
        if (!paidOrderIds.has(String(a.event_order_id)) || a.status === "cancelled") continue;
        const evId = orderEvent.get(String(a.event_order_id));
        if (evId == null) continue;
        const isCourtesy = courtesyOrderIds.has(String(a.event_order_id));
        bump(checkinsByEvent, evId, a);
        if (isCourtesy) bumpCourtesy(courtesyByEvent, evId);
        const fnId = a.event_ticket_id == null ? null : ticketDate.get(String(a.event_ticket_id)) ?? null;
        if (fnId != null) { bump(checkinsByFn, fnId, a); if (isCourtesy) bumpCourtesy(courtesyByFn, fnId); }
        else bump(checkinsUnassigned, evId, a);
    }
    if (simulated?.eventDateIds?.length) {
        const nowIso = now.toISOString();
        const wanted = new Set(simulated.eventDateIds.map(Number));
        for (const d of dates) {
            if (Number(d.event_id) !== simulated.eventId || !wanted.has(Number(d.id))) continue;
            d.released_early_at = d.released_early_at || nowIso;
            if (simulated.override) d.release_override_at = d.release_override_at || nowIso;
        }
    }
    // Liberación anticipada (release_event_funds): no espera las 48 h; con override tampoco exige condiciones.
    const earlyFns = new Set<number>(dates.filter((d) => d.released_early_at).map((d) => Number(d.id)));
    const overrideFns = new Set<number>(dates.filter((d) => d.release_override_at).map((d) => Number(d.id)));

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
                release_status: cancelled ? "cancelled" : (e.released_early_at || d.released_early_at || fRelease.getTime() <= now.getTime()) ? "released" : "pending",
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
            reserve_pct: 0, // sin reserva por riesgo: se ignora events.reserve_pct
            risk_level: e.risk_level ?? null,
            hold_reasons: [],
            checkins: {
                sold: checkinsByEvent.get(Number(e.id))?.sold || 0,
                checked_in: checkinsByEvent.get(Number(e.id))?.in || 0,
                unassigned_sold: checkinsUnassigned.get(Number(e.id))?.sold || 0,
                unassigned_checked_in: checkinsUnassigned.get(Number(e.id))?.in || 0,
            },
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
        let c: { sold: number; in: number } | undefined;
        if (f) {
            attested = Boolean(f.attested_at);
            c = checkinsByFn.get(f.event_date_id);
        } else {
            const lastFn = l.functions[l.functions.length - 1];
            attested = Boolean(eventRow.get(l.event_id)?.held_attested_at || lastFn?.attested_at);
            c = checkinsByEvent.get(l.event_id);
        }
        const courtesies = f ? (courtesyByFn.get(f.event_date_id) || 0) : (courtesyByEvent.get(l.event_id) || 0);
        const paidSold = c ? c.sold - courtesies : 0;
        if (!attested && paidSold > 0 && c!.in < Math.min(MIN_CHECKINS_FOR_RELEASE, paidSold)) out.push(holdReason("low_checkins"));
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
        const ev = eventRow.get(l.event_id);
        const early = Boolean(ev?.released_early_at || (f && earlyFns.has(f.event_date_id)));
        const override = Boolean(ev?.release_override_at || (f && overrideFns.has(f.event_date_id)));
        if (!early) {
            const end = f ? new Date(f.ends_at) : eventEnd.get(l.event_id) ?? null;
            const release = releaseOf(end);
            if (!release || release.getTime() > now.getTime()) continue; // aún no cumple 48 h: pendiente
        }

        const net = amount - (refundsByOrder.get(String(o.id)) || 0);
        const reasons = override ? [] : conditionsFor(l, f);
        if (reasons.length) {
            add(heldNet, l.event_id, net);
            for (const r of reasons) {
                mergeReason(l.hold_reasons, { ...r, amount: net });
                if (f) mergeReason(f.hold_reasons, { ...r, amount: net });
            }
            if (f) f.release_status = "held";
            continue;
        }
        l.released_sales += amount;
        add(releasedNet, l.event_id, net);
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
        const releasedEarly = Boolean(eventRow.get(l.event_id)?.released_early_at);
        l.released = !l.cancelled && (releasedEarly || Boolean(releasesAt && releasesAt.getTime() <= now.getTime())) && l.held === 0;
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

/**
 * true si lo retirado supera lo que la organización tiene para retirar: algún evento quedó con retiros por sobre su
 * saldo (o lo liberado), o la suma de lo disponible ya no cubre el saldo negativo de otros eventos (reembolsos
 * posteriores a un retiro). Se usa después de insertar un retiro para detectar dos solicitudes simultáneas.
 * `ledger` debe ser el de TODA la organización (sin eventIds).
 */
export function payoutOverdrawn(ledger: { events: Array<{ event_id: number; net_due: number; released_due: number; available: number }>; totals: { negative_balance: number } }, eventIds: number[]): boolean {
    const allocated = new Set(eventIds.map(Number));
    if (ledger.events.some((l) => allocated.has(Number(l.event_id)) && (l.net_due < 0 || l.released_due < 0))) return true;
    const available = ledger.events.reduce((sum, l) => sum + (Number(l.available) || 0), 0);
    return available < (Number(ledger.totals.negative_balance) || 0);
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
