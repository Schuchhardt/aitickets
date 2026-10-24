// Herramientas de admin: finanzas de plataforma (lectura). Retiros por transferir, datos para la transferencia,
// reembolsos por devolver en Flow y el resumen de plata de la plataforma (ingresos de AI Tickets, IVA, costo Flow,
// saldo adeudado a productores). Definiciones de métricas: src/lib/admin-api/metrics.ts.
import { ToolError, type JsonSchema } from "../../producer-api/registry";
import { fetchAll } from "../../producer-api/tools/common";
import { presentAccount } from "../../producer-api/tools/finance";
import { computeOrgLedger } from "../../producer-api/ledger";
import type { AdminToolDef } from "../registry";
import { loadPaidOrders, loadPlatformEvents, periodSchema, resolvePeriod, totalsByEvent, totalsByOrg, totalsFromOrders, emptyTotals } from "../metrics";
import { mapLimit } from "./events";

const isMissing = (error: any) => ["42P01", "PGRST205", "42703", "PGRST204"].includes(String(error?.code || ""));

async function tolerant(build: () => any): Promise<any[]> {
    const { data, error } = await build();
    if (error) {
        if (isMissing(error)) return [];
        throw error;
    }
    return data || [];
}

const clp = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")} CLP`;
const shortId = (id: unknown) => String(id || "").slice(0, 8);
const LEDGER_CONCURRENCY = 4;

export const payoutIdSchema: JsonSchema = { type: "string", pattern: "^[0-9a-fA-F-]{36}$", description: "ID del retiro (uuid, ver list_payout_requests)." };
export const refundIdSchema: JsonSchema = { type: "string", pattern: "^[0-9a-fA-F-]{36}$", description: "ID del reembolso (uuid, ver list_refund_requests)." };

export const PAYOUT_SELECT = "id, organization_id, amount, status, bank_name, bank_account_type, bank_account_last4, requested_via, estimated_payment_date, paid_at, cancelled_at, failure_reason, reference, created_at";

/** Retiro por id o not_found. */
export async function loadPayout(supabase: any, payoutId: string): Promise<any> {
    const { data, error } = await supabase.from("aitickets_payouts").select(PAYOUT_SELECT).eq("id", payoutId).maybeSingle();
    if (error) {
        if (isMissing(error)) throw new ToolError("unavailable", "Los retiros aún no están disponibles en esta base.");
        throw error;
    }
    if (!data) throw new ToolError("not_found", `No existe el retiro ${payoutId}. Usa list_payout_requests para ver los IDs.`);
    return data;
}

/** Cuenta bancaria completa de una organización (uso interno: nunca se devuelve tal cual salvo en get_payout_transfer_details). */
export async function loadPayoutAccountRow(supabase: any, orgId: number): Promise<any | null> {
    const rows = await tolerant(() => supabase.from("organization_payout_accounts").select("*").eq("organization_id", orgId));
    return rows[0] || null;
}

const digitsOf = (v: unknown) => String(v || "").replace(/\D/g, "");

/** Señales de riesgo antes de transferir: las mismas que revisa aitickets_set_payout_status al marcar pagado. */
export function payoutFlags(payout: any, acc: any) {
    const last4 = digitsOf(acc?.bank_account_number).slice(-4) || null;
    return {
        account_missing: !acc?.bank_account_number,
        account_not_verified: !acc?.verified_at,
        account_changed_after_request: Boolean(acc?.bank_changed_at && payout?.created_at && Date.parse(acc.bank_changed_at) > Date.parse(payout.created_at)),
        last4_mismatch: Boolean(payout?.bank_account_last4 && last4 && last4 !== String(payout.bank_account_last4)),
    };
}

/** Advertencias legibles de las señales (para resúmenes de confirmación y listados). */
export function payoutWarnings(payout: any, acc: any): string[] {
    const f = payoutFlags(payout, acc);
    const out: string[] = [];
    if (f.account_missing) out.push("La organización ya no tiene cuenta bancaria registrada.");
    else if (f.account_not_verified) out.push("La cuenta bancaria NO está verificada: verifícala (verify_payout_account) antes de transferir.");
    if (f.account_changed_after_request) out.push("La cuenta bancaria cambió DESPUÉS de pedir el retiro: confirma con el productor a qué cuenta transferir.");
    if (f.last4_mismatch) out.push(`El retiro se pidió a la cuenta terminada en ${payout.bank_account_last4} y la registrada termina en ${digitsOf(acc?.bank_account_number).slice(-4)}.`);
    return out;
}

/** Nombres de organizaciones por id. */
export async function orgNames(supabase: any, ids: number[]): Promise<Map<number, string>> {
    const unique = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
    if (!unique.length) return new Map();
    const rows = await fetchAll<any>(() => supabase.from("organizations").select("id, public_name").in("id", unique).order("id", { ascending: true }));
    return new Map(rows.map((o: any) => [Number(o.id), o.public_name]));
}

/** Saldo de cada organización (computeOrgLedger), con concurrencia acotada. null si falla. */
export async function ledgerTotals(supabase: any, orgIds: number[]): Promise<Map<number, any | null>> {
    const unique = [...new Set(orgIds)];
    const results = await mapLimit(unique, LEDGER_CONCURRENCY, async (orgId) => {
        try {
            return (await computeOrgLedger(supabase, orgId)).totals;
        } catch (err: any) {
            console.warn(`admin ledger org ${orgId}:`, err?.message || err);
            return null;
        }
    });
    return new Map(unique.map((id, i) => [id, results[i]]));
}

const OPEN_PAYOUT = ["requested", "processing"];
const PAYOUT_STATUSES = ["requested", "processing", "paid", "failed", "cancelled"] as const;

const listPayoutRequests: AdminToolDef = {
    name: "list_payout_requests",
    title: "Retiros por transferir",
    description:
        "Retiros de todas las organizaciones (por defecto los pendientes: requested y processing), del más antiguo al más nuevo. " +
        "Por retiro: productor, monto, días esperando, fecha estimada, banco y últimos 4 dígitos, estado de verificación de la cuenta, " +
        "señales de riesgo (cuenta no verificada, cambiada después de pedirlo, últimos 4 distintos), saldo disponible hoy, reparto por evento " +
        "y si event_withdrawals cuadra con el retiro. Para transferir: get_payout_transfer_details y luego mark_payout_paid con el comprobante.",
    readOnly: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            statuses: { type: "array", items: { type: "string", enum: PAYOUT_STATUSES }, minItems: 1, maxItems: 5, description: "Estados a listar. Por defecto requested y processing." },
            organization_id: { type: "integer", minimum: 1, description: "Solo esta organización." },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        },
    },
    async handler(args, actx) {
        const { supabase } = actx;
        const statuses: string[] = args.statuses?.length ? args.statuses : OPEN_PAYOUT;
        let q = supabase.from("aitickets_payouts").select(PAYOUT_SELECT).in("status", statuses).order("created_at", { ascending: true }).limit(args.limit);
        if (args.organization_id) q = q.eq("organization_id", args.organization_id);
        const payouts = await tolerant(() => q);
        const orgIds = payouts.map((p: any) => Number(p.organization_id));
        const ids = payouts.map((p: any) => p.id);
        const [names, accounts, ledgers, splits] = await Promise.all([
            orgNames(supabase, orgIds),
            orgIds.length ? tolerant(() => supabase.from("organization_payout_accounts").select("*").in("organization_id", [...new Set(orgIds)])) : Promise.resolve([]),
            ledgerTotals(supabase, orgIds),
            ids.length ? tolerant(() => supabase.from("event_withdrawals").select("payout_id, event_id, amount, status").in("payout_id", ids)) : Promise.resolve([]),
        ]);
        const accountByOrg = new Map(accounts.map((a: any) => [Number(a.organization_id), a]));
        const eventIds = [...new Set(splits.map((s: any) => Number(s.event_id)))];
        const events = eventIds.length ? await tolerant(() => supabase.from("events").select("id, name").in("id", eventIds)) : [];
        const eventName = new Map(events.map((e: any) => [Number(e.id), e.name]));
        const nowMs = Date.now();
        let openAmount = 0;
        const items = payouts.map((p: any) => {
            const acc = accountByOrg.get(Number(p.organization_id)) || null;
            const parts = splits.filter((s: any) => s.payout_id === p.id);
            const balance = ledgers.get(Number(p.organization_id));
            if (OPEN_PAYOUT.includes(p.status)) openAmount += Number(p.amount) || 0;
            return {
                payout_id: p.id,
                short_id: shortId(p.id),
                organization: { id: Number(p.organization_id), name: names.get(Number(p.organization_id)) || null },
                amount_clp: Number(p.amount) || 0,
                status: p.status,
                requested_at: p.created_at,
                days_waiting: OPEN_PAYOUT.includes(p.status) ? Math.floor((nowMs - Date.parse(p.created_at)) / 86400000) : null,
                estimated_payment_date: p.estimated_payment_date ?? null,
                requested_via: p.requested_via ?? null,
                bank: p.bank_name ?? null,
                account_type: p.bank_account_type ?? null,
                account_last4: p.bank_account_last4 ?? null,
                ...(p.paid_at ? { paid_at: p.paid_at, reference: p.reference ?? null } : {}),
                ...(p.failure_reason ? { failure_reason: p.failure_reason } : {}),
                payout_account: presentAccount(acc),
                flags: payoutFlags(p, acc),
                warnings: payoutWarnings(p, acc),
                available_balance_now_clp: balance ? balance.available : null,
                events: parts.map((s: any) => ({ event_id: Number(s.event_id), name: eventName.get(Number(s.event_id)) || null, amount_clp: Number(s.amount) || 0, status: s.status })),
                // event_withdrawals debe tener el mismo estado que el retiro (un trigger lo mantiene desde 202610240100)
                consistent: parts.every((s: any) => s.status === p.status),
            };
        });
        return {
            count: items.length,
            open_total_clp: openAmount,
            payouts: items,
            how_to_pay:
                "1) get_payout_transfer_details(payout_id) → datos de la cuenta. 2) Transfiere desde el banco. 3) mark_payout_paid(payout_id, reference = n° de comprobante). " +
                "Si no se pudo transferir: mark_payout_failed con el motivo (el monto vuelve al saldo disponible del productor).",
        };
    },
};

const getPayoutTransferDetails: AdminToolDef = {
    name: "get_payout_transfer_details",
    title: "Datos para transferir un retiro",
    description:
        "Todo lo necesario para hacer la transferencia bancaria de un retiro pendiente: banco, tipo de cuenta, número de cuenta COMPLETO, titular, " +
        "RUT del titular, correo para el aviso de transferencia, monto y un comentario sugerido, más las señales de riesgo. " +
        "Expone datos bancarios: solo con la llave completa y queda en la bitácora de admin. Úsala justo antes de transferir; no repitas estos datos sin necesidad.",
    readOnly: true,
    sensitive: true,
    inputSchema: { type: "object", additionalProperties: false, required: ["payout_id"], properties: { payout_id: payoutIdSchema } },
    audit: (args, result: any) => ({ organization_id: result?.organization?.id ?? null, target: `payout:${args.payout_id}`, summary: `Datos de transferencia del retiro ${shortId(args.payout_id)}` }),
    async handler(args, actx) {
        const { supabase } = actx;
        const payout = await loadPayout(supabase, args.payout_id);
        if (!OPEN_PAYOUT.includes(payout.status)) {
            throw new ToolError("conflict", `El retiro ${shortId(payout.id)} está '${payout.status}': solo uno requested o processing se transfiere.`);
        }
        const orgId = Number(payout.organization_id);
        const [acc, names, orgRows] = await Promise.all([
            loadPayoutAccountRow(supabase, orgId),
            orgNames(supabase, [orgId]),
            tolerant(() => supabase.from("organizations").select("id, email").eq("id", orgId)),
        ]);
        if (!acc?.bank_account_number) throw new ToolError("conflict", "La organización no tiene cuenta bancaria registrada: no hay a dónde transferir.");
        const warnings = payoutWarnings(payout, acc);
        return {
            payout_id: payout.id,
            organization: { id: orgId, name: names.get(orgId) || null },
            amount_clp: Number(payout.amount) || 0,
            requested_at: payout.created_at,
            transfer: {
                bank: acc.bank_name ?? null,
                account_type: acc.bank_account_type ?? null,
                account_number: acc.bank_account_number,
                holder_name: acc.bank_account_holder ?? null,
                holder_rut: acc.bank_account_rut ?? null,
                notify_email: orgRows[0]?.email ?? null,
                suggested_comment: `AI Tickets retiro ${shortId(payout.id)}`,
            },
            account_verified_at: acc.verified_at ?? null,
            flags: payoutFlags(payout, acc),
            warnings,
            next_step:
                warnings.length
                    ? "Hay advertencias: resuélvelas antes de transferir (o confirma con el productor). Después de transferir, mark_payout_paid con el n° de comprobante."
                    : "Transfiere ese monto exacto y luego llama a mark_payout_paid con el número de comprobante (reference).",
        };
    },
};

const REFUND_STATUSES = ["requested", "processing", "completed", "failed", "cancelled"] as const;

const listRefundRequests: AdminToolDef = {
    name: "list_refund_requests",
    title: "Reembolsos por devolver",
    description:
        "Reembolsos de todas las organizaciones (por defecto requested y processing), del más antiguo al más nuevo: productor, evento, orden, " +
        "referencia de Flow (payment_external_id) y correo del comprador para encontrarlo en el panel de Flow, tipo (total o parcial), " +
        "monto a devolver (entradas + cargo) y quién lo pidió. Tras devolver en Flow: mark_refund_completed con el id del reembolso de Flow.",
    readOnly: true,
    sensitive: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            statuses: { type: "array", items: { type: "string", enum: REFUND_STATUSES }, minItems: 1, maxItems: 5, description: "Por defecto requested y processing." },
            organization_id: { type: "integer", minimum: 1 },
            event_id: { type: "integer", minimum: 1 },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        },
    },
    async handler(args, actx) {
        const { supabase } = actx;
        const statuses: string[] = args.statuses?.length ? args.statuses : ["requested", "processing"];
        let q = supabase
            .from("aitickets_refunds")
            .select("id, organization_id, event_id, order_id, kind, ticket_amount, fee_amount, total_amount, reason, source, status, requested_via, provider_reference, processed_at, created_at")
            .in("status", statuses)
            .order("created_at", { ascending: true })
            .limit(args.limit);
        if (args.organization_id) q = q.eq("organization_id", args.organization_id);
        if (args.event_id) q = q.eq("event_id", args.event_id);
        const refunds = await tolerant(() => q);
        const orderIds = [...new Set(refunds.map((r: any) => r.order_id))];
        const eventIds = [...new Set(refunds.map((r: any) => Number(r.event_id)))];
        const [names, orders, events] = await Promise.all([
            orgNames(supabase, refunds.map((r: any) => Number(r.organization_id))),
            orderIds.length ? tolerant(() => supabase.from("event_orders").select("id, payment_external_id, payment_provider, buyer_email, total_payment, created_at").in("id", orderIds)) : Promise.resolve([]),
            eventIds.length ? tolerant(() => supabase.from("events").select("id, name").in("id", eventIds)) : Promise.resolve([]),
        ]);
        const orderById = new Map(orders.map((o: any) => [o.id, o]));
        const eventName = new Map(events.map((e: any) => [Number(e.id), e.name]));
        let pendingTotal = 0;
        const items = refunds.map((r: any) => {
            const o = orderById.get(r.order_id) || {};
            if (["requested", "processing"].includes(r.status)) pendingTotal += Number(r.total_amount) || 0;
            return {
                refund_id: r.id,
                organization: { id: Number(r.organization_id), name: names.get(Number(r.organization_id)) || null },
                event: { id: Number(r.event_id), name: eventName.get(Number(r.event_id)) || null },
                order_id: r.order_id,
                flow_reference: (o as any).payment_external_id ?? null,
                payment_provider: (o as any).payment_provider ?? null,
                buyer_email: (o as any).buyer_email ?? null,
                order_paid_clp: (o as any).total_payment ?? null,
                kind: r.kind,
                source: r.source,
                status: r.status,
                ticket_amount_clp: Number(r.ticket_amount) || 0,
                fee_amount_clp: Number(r.fee_amount) || 0,
                total_amount_clp: Number(r.total_amount) || 0,
                requested_at: r.created_at,
                requested_via: r.requested_via ?? null,
                ...(r.provider_reference ? { provider_reference: r.provider_reference } : {}),
                ...(r.processed_at ? { processed_at: r.processed_at } : {}),
            };
        });
        return {
            count: items.length,
            pending_total_clp: pendingTotal,
            refunds: items,
            how_to_process: "Devuelve total_amount_clp en el panel de Flow (busca la orden por flow_reference) y luego mark_refund_completed(refund_id, provider_reference). Si Flow no lo permite: mark_refund_failed con el motivo.",
        };
    },
};

const ACTIVE_REFUND = ["requested", "processing", "completed"];

const getPlatformFinance: AdminToolDef = {
    name: "get_platform_finance",
    title: "Finanzas de la plataforma",
    description:
        "Plata de AI Tickets en un período (por defecto 30 días, hora de Chile): ventas brutas, cargo por servicio neto (ingreso de AI Tickets), IVA del cargo " +
        "(se declara), costo de Flow, reembolsos (y el cargo que asume AI Tickets) y margen; saldo adeudado HOY a los productores (disponible, " +
        "pendiente y retenido); retiros pedidos y pagados en el período y retiros abiertos; desglose por productor. Sin cortesías, transferencias ni eventos demo.",
    readOnly: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { ...periodSchema, top: { type: "integer", minimum: 1, maximum: 500, default: 50, description: "Productores en el desglose." } },
    },
    async handler(args, actx) {
        const { supabase } = actx;
        const { current } = resolvePeriod(args);
        const events = await loadPlatformEvents(supabase);
        const eventIds = events.map((e) => Number(e.id));
        const eventSet = new Set(eventIds);
        const [periodOrders, refundRows, payoutsCreated, payoutsPaid, payoutsOpen, paidEventRows] = await Promise.all([
            loadPaidOrders(supabase, eventIds, current),
            tolerant(() =>
                supabase.from("aitickets_refunds").select("organization_id, event_id, ticket_amount, fee_amount, total_amount, status").gte("created_at", current.fromIso).lt("created_at", current.toIso),
            ),
            tolerant(() => supabase.from("aitickets_payouts").select("amount, status").gte("created_at", current.fromIso).lt("created_at", current.toIso)),
            tolerant(() => supabase.from("aitickets_payouts").select("organization_id, amount").eq("status", "paid").gte("paid_at", current.fromIso).lt("paid_at", current.toIso)),
            tolerant(() => supabase.from("aitickets_payouts").select("amount").in("status", OPEN_PAYOUT)),
            // Organizaciones con ventas alguna vez: las que pueden tener saldo
            fetchAll<any>(() => supabase.from("event_orders").select("event_id").eq("status", "paid").order("id", { ascending: true }), { max: 1000000 }),
        ]);
        const totals = totalsFromOrders(periodOrders);
        const refunds = refundRows.filter((r: any) => ACTIVE_REFUND.includes(r.status) && eventSet.has(Number(r.event_id)));
        const refundTotal = refunds.reduce((s: number, r: any) => s + (Number(r.total_amount) || 0), 0);
        const refundFeeAbsorbed = refunds.reduce((s: number, r: any) => s + (Number(r.fee_amount) || 0), 0);
        const refundTickets = refunds.reduce((s: number, r: any) => s + (Number(r.ticket_amount) || 0), 0);

        const orgOfEvent = new Map(events.map((e) => [Number(e.id), Number(e.organization_id)]));
        const orgsWithSales = [...new Set(paidEventRows.map((r: any) => orgOfEvent.get(Number(r.event_id))).filter((n): n is number => n != null))];
        const ledgers = await ledgerTotals(supabase, orgsWithSales);
        const owed = { available_clp: 0, pending_clp: 0, retained_clp: 0, negative_balance_clp: 0, organizations: orgsWithSales.length, ledger_errors: 0 };
        for (const t of ledgers.values()) {
            if (!t) {
                owed.ledger_errors += 1;
                continue;
            }
            owed.available_clp += Number(t.available) || 0;
            owed.pending_clp += Number(t.pending) || 0;
            owed.retained_clp += Number(t.retained) || 0;
            owed.negative_balance_clp += Number(t.negative_balance) || 0;
        }

        const byOrg = totalsByOrg(events, totalsByEvent(periodOrders));
        const refundsByOrg = new Map<number, number>();
        for (const r of refunds) refundsByOrg.set(Number(r.organization_id), (refundsByOrg.get(Number(r.organization_id)) || 0) + (Number(r.total_amount) || 0));
        const paidByOrg = new Map<number, number>();
        for (const p of payoutsPaid) paidByOrg.set(Number(p.organization_id), (paidByOrg.get(Number(p.organization_id)) || 0) + (Number(p.amount) || 0));
        const orgIds = [...new Set([...byOrg.keys(), ...refundsByOrg.keys(), ...paidByOrg.keys()])];
        const names = await orgNames(supabase, orgIds);
        const breakdown = orgIds
            .map((id) => {
                const t = byOrg.get(id) || emptyTotals();
                const ledger = ledgers.get(id);
                return {
                    organization: { id, name: names.get(id) || null },
                    paid_orders: t.paid_orders,
                    gross_sales_clp: t.gross_sales_clp,
                    producer_net_clp: t.producer_net_clp,
                    aitickets_fee_net_clp: t.aitickets_fee_net_clp,
                    fee_iva_clp: t.fee_iva_clp,
                    flow_cost_clp: t.flow_cost_clp,
                    refunds_clp: refundsByOrg.get(id) || 0,
                    payouts_paid_clp: paidByOrg.get(id) || 0,
                    available_now_clp: ledger ? ledger.available : null,
                };
            })
            .sort((a, b) => b.gross_sales_clp - a.gross_sales_clp)
            .slice(0, args.top);

        const sum = (rows: any[]) => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        return {
            period: { from: current.from, to: current.to, timezone: "America/Santiago" },
            sales: {
                paid_orders: totals.paid_orders,
                tickets_sold: totals.tickets_sold,
                gross_sales_clp: totals.gross_sales_clp,
                producer_net_clp: totals.producer_net_clp,
                discounts_clp: totals.discounts_clp,
            },
            aitickets: {
                service_fee_net_clp: totals.aitickets_fee_net_clp,
                service_fee_iva_clp: totals.fee_iva_clp,
                flow_cost_clp: totals.flow_cost_clp,
                refunded_fee_absorbed_clp: refundFeeAbsorbed,
                margin_clp: totals.aitickets_fee_net_clp - totals.flow_cost_clp - refundFeeAbsorbed,
                note: "margin = cargo neto − costo Flow − cargo devuelto en reembolsos (lo asume AI Tickets). El IVA del cargo no es ingreso: se declara.",
            },
            refunds: { count: refunds.length, total_clp: refundTotal, tickets_clp: refundTickets, fee_clp: refundFeeAbsorbed },
            owed_to_producers_now: owed,
            payouts: {
                requested_in_period: { count: payoutsCreated.length, total_clp: sum(payoutsCreated) },
                paid_in_period: { count: payoutsPaid.length, total_clp: sum(payoutsPaid) },
                open_now: { count: payoutsOpen.length, total_clp: sum(payoutsOpen) },
            },
            by_organization: breakdown,
            for_the_accountant:
                `Período ${current.from} a ${current.to}: AI Tickets cobró ${clp(totals.aitickets_fee_net_clp)} de cargo por servicio neto más ${clp(totals.fee_iva_clp)} de IVA (débito fiscal). ` +
                `Costo de Flow: ${clp(totals.flow_cost_clp)}. Reembolsos: ${clp(refundTotal)} (de ellos ${clp(refundFeeAbsorbed)} de cargo). ` +
                `Retiros pagados a productores: ${clp(sum(payoutsPaid))}. Ventas por fecha de la orden (created_at, hora de Chile).`,
        };
    },
};

export const financeTools: AdminToolDef[] = [listPayoutRequests, getPayoutTransferDetails, listRefundRequests, getPlatformFinance];

