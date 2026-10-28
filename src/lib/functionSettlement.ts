// Borderó por función: el documento para liquidar con la sala una función. Entradas vendidas por tipo y precio,
// cortesías, bruto, descuentos, cargo por servicio (quién lo pagó: comprador o productor, events.fee_absorbed guardado
// en cada orden) y neto al productor. Sale de las órdenes pagadas (event_orders): una orden con entradas de varias
// funciones se reparte con orderForFunction (monto, descuento y cargo según el valor de cada línea). Sin
// transferencias (la venta original ya cuenta) ni órdenes reembolsadas. Lo usan el panel (/dashboard/events/<id>/bordero,
// imprimible), /api/events/function-settlement (CSV) y get_function_settlement (asistente de IA).
import { ALL_FUNCTIONS, loadEventFunctions, orderForFunction } from "./eventAnalytics";
import { fetchAll } from "./producer-api/tools/common";
import { isCourtesyOrder, isTransferOrder, lineSoldQty, orderLines } from "./orderKinds";
import { EVENT_DATE_COLUMNS, formatEventLocation, formatFunctionLabel } from "../../netlify/lib/dates.mjs";
import { csvCell } from "../pages/api/_lib/server-utils";

const ORDER_COLUMNS = "id, created_at, amount, ticket_qty, ticket_fee, discount_amount, discount_code, ticket_details, payment_provider";
const isMissingColumn = (err: any) => ["42703", "PGRST204"].includes(String(err?.code || ""));

export type SettlementTicketRow = { ticket_type: string; unit_price_clp: number; tickets: number; gross_clp: number };
export type FunctionSettlement = {
    event: { id: number; name: string };
    /** null = entradas válidas para cualquier función (pase completo). */
    function: { id: number; label: string; date: string; start_time: string | null; venue: string } | null;
    generated_at: string;
    tickets: SettlementTicketRow[];
    courtesies: { ticket_type: string; tickets: number }[];
    discount_codes: { code: string; orders: number; discount_clp: number }[];
    totals: {
        orders: number;
        tickets_sold: number;
        courtesy_tickets: number;
        /** Valor de lista de las entradas vendidas (precio × cantidad). */
        gross_clp: number;
        discounts_clp: number;
        /** Lo que pagó el público: entradas con descuento + cargo por servicio cuando lo paga el comprador. */
        buyer_paid_clp: number;
        /** Cargo por servicio + IVA que pagaron los compradores (de AI Tickets, no entra a la liquidación). */
        service_fee_paid_by_buyers_clp: number;
        /** Cargo por servicio + IVA descontado al productor (cargo absorbido). */
        service_fee_absorbed_clp: number;
        /** Lo que recibe el productor por esta función: bruto − descuentos − cargo absorbido. */
        net_to_producer_clp: number;
    };
    /** Diferencia por redondeo al repartir órdenes de varias funciones (normalmente 0). */
    rounding_clp: number;
};

export class SettlementError extends Error {}

/** Órdenes pagadas del evento con lo que necesita el borderó (tolera columnas aún sin migrar). */
async function loadSettlementOrders(supabase: any, eventId: number): Promise<any[]> {
    const run = (cols: string) => fetchAll<any>(() => supabase.from("event_orders").select(cols).eq("event_id", eventId).eq("status", "paid").order("id", { ascending: true }));
    for (const extra of [", service_fee_tax, fee_absorbed", ", service_fee_tax", ""]) {
        try {
            return await run(`${ORDER_COLUMNS}${extra}`);
        } catch (err) {
            if (!isMissingColumn(err)) throw err;
        }
    }
    return run(ORDER_COLUMNS);
}

/** Valor de lista de una línea: su total guardado o precio × cantidad vendida. */
const lineGross = (l: any) => (Number(l?.price) || 0) * lineSoldQty(l);

/**
 * Arma el borderó de una función (`functionId`) o de las entradas válidas para cualquier función (`null`). Lanza
 * SettlementError si la función no es del evento.
 */
export async function functionSettlement(supabase: any, event: { id: number; name: string }, functionId: number | null, now = new Date()): Promise<FunctionSettlement> {
    const [{ functions, ticketFunction }, orders] = await Promise.all([loadEventFunctions(supabase, event.id), loadSettlementOrders(supabase, event.id)]);
    let fn: FunctionSettlement["function"] = null;
    if (functionId != null) {
        if (!functions.some((f) => f.id === Number(functionId))) throw new SettlementError("La función no es de este evento.");
        const { data: row } = await supabase.from("event_dates").select(EVENT_DATE_COLUMNS).eq("id", functionId).eq("event_id", event.id).maybeSingle();
        fn = {
            id: Number(functionId),
            label: formatFunctionLabel(row, { withPlace: false }),
            date: String(row?.date || "").slice(0, 10),
            start_time: row?.start_time ? String(row.start_time).slice(0, 5) : null,
            venue: formatEventLocation(row?.event_locations) || "",
        };
    }
    const key = functionId == null ? ALL_FUNCTIONS : String(functionId);

    const byType = new Map<string, SettlementTicketRow>();
    const courtesies = new Map<string, number>();
    const codes = new Map<string, { code: string; orders: number; discount_clp: number }>();
    const t = { orders: 0, tickets_sold: 0, courtesy_tickets: 0, gross_clp: 0, discounts_clp: 0, buyer_paid_clp: 0, service_fee_paid_by_buyers_clp: 0, service_fee_absorbed_clp: 0, net_to_producer_clp: 0 };

    for (const o of orders) {
        if (isTransferOrder(o)) continue;
        const part = orderForFunction(o, key, ticketFunction);
        if (!part) continue;
        const lines = orderLines(part);
        if (isCourtesyOrder(o)) {
            for (const l of lines) {
                const name = l?.name || "Cortesía";
                courtesies.set(name, (courtesies.get(name) || 0) + lineSoldQty(l));
                t.courtesy_tickets += lineSoldQty(l);
            }
            continue;
        }
        t.orders += 1;
        for (const l of lines) {
            const qty = lineSoldQty(l);
            if (!qty) continue;
            const name = l?.name || "Entrada";
            const price = Math.round(Number(l?.price) || 0);
            const k = `${name}|${price}`;
            const row = byType.get(k) || { ticket_type: name, unit_price_clp: price, tickets: 0, gross_clp: 0 };
            row.tickets += qty;
            row.gross_clp += Math.round(lineGross(l));
            byType.set(k, row);
            t.tickets_sold += qty;
            t.gross_clp += Math.round(lineGross(l));
        }
        const amount = Math.round(Number(part.amount) || 0);
        const discount = Math.round(Number(part.discount_amount) || 0);
        const fee = Math.round((Number(part.ticket_fee) || 0) + (Number(part.service_fee_tax) || 0));
        t.discounts_clp += discount;
        t.net_to_producer_clp += amount;
        // amount es lo que recibe el productor: con el cargo absorbido ya viene descontado (fees.mjs computeFeeSplit)
        t.buyer_paid_clp += amount + fee;
        if (o.fee_absorbed === true) t.service_fee_absorbed_clp += fee;
        else t.service_fee_paid_by_buyers_clp += fee;
        if (o.discount_code && discount > 0) {
            const c = codes.get(o.discount_code) || { code: o.discount_code, orders: 0, discount_clp: 0 };
            c.orders += 1;
            c.discount_clp += discount;
            codes.set(o.discount_code, c);
        }
    }

    const rounding = t.net_to_producer_clp - (t.gross_clp - t.discounts_clp - t.service_fee_absorbed_clp);
    return {
        event: { id: Number(event.id), name: event.name },
        function: fn,
        generated_at: now.toISOString(),
        tickets: [...byType.values()].sort((a, b) => b.unit_price_clp - a.unit_price_clp || a.ticket_type.localeCompare(b.ticket_type)),
        courtesies: [...courtesies.entries()].map(([ticket_type, tickets]) => ({ ticket_type, tickets })),
        discount_codes: [...codes.values()].sort((a, b) => b.discount_clp - a.discount_clp),
        totals: t,
        rounding_clp: rounding,
    };
}

const clp = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
export const settlementClp = clp;

/** Título del documento: "Borderó · <evento> · Vie 13 nov · 20:00". */
export const settlementTitle = (s: FunctionSettlement) => `Borderó · ${s.event.name} · ${s.function ? s.function.label : "Válidas para cualquier función"}`;

/** Planilla (CSV con ; y BOM, como el CSV de órdenes) del borderó. */
export function settlementCsv(s: FunctionSettlement): string {
    const rows: unknown[][] = [
        ["Borderó"],
        ["Evento", s.event.name],
        ["Función", s.function ? s.function.label : "Válidas para cualquier función"],
        ...(s.function?.venue ? [["Lugar", s.function.venue]] : []),
        ["Generado (Chile)", new Date(s.generated_at).toLocaleString("es-CL", { timeZone: "America/Santiago" })],
        [],
        ["Tipo de entrada", "Precio", "Vendidas", "Bruto"],
        ...s.tickets.map((r) => [r.ticket_type, r.unit_price_clp, r.tickets, r.gross_clp]),
        ["Total vendidas", "", s.totals.tickets_sold, s.totals.gross_clp],
        [],
        ["Cortesías", "", "Entradas"],
        ...s.courtesies.map((c) => [c.ticket_type, "", c.tickets]),
        ["Total cortesías", "", s.totals.courtesy_tickets],
        [],
        ["Concepto", "Monto"],
        ["Bruto (valor de lista)", s.totals.gross_clp],
        ["Descuentos", -s.totals.discounts_clp],
        ["Cargo por servicio + IVA absorbido por el productor", -s.totals.service_fee_absorbed_clp],
        ...(s.rounding_clp ? [["Ajuste por redondeo", s.rounding_clp]] : []),
        ["Neto al productor", s.totals.net_to_producer_clp],
        [],
        ["Cargo por servicio + IVA pagado por los compradores (no es del productor)", s.totals.service_fee_paid_by_buyers_clp],
        ["Total pagado por el público", s.totals.buyer_paid_clp],
        ["Órdenes", s.totals.orders],
        ...(s.discount_codes.length ? [[], ["Código de descuento", "Órdenes", "Descuento"], ...s.discount_codes.map((c) => [c.code, c.orders, c.discount_clp])] : []),
    ];
    return "﻿" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n");
}
