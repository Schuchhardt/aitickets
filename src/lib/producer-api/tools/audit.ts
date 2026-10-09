// Herramientas: auditoría (bitácora de acciones) y exportación contable de órdenes.
import { ToolError, type ToolContext, type ToolDef } from "../registry";
import { eventIdSchema, loadOwnedEvent, DATE_PATTERN, TZ } from "./common";
import { buildOrderExportRows, rowsToCsv, signExportToken, EXPORT_TTL_SECONDS } from "../../ordersExport";
import { addDays, zonedDateTimeToUtc } from "../../../../netlify/lib/dates.mjs";

const fmt = (iso: string) => new Date(iso).toLocaleString("es-CL", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });
const isMissing = (error: any) => ["42P01", "PGRST205", "42703", "PGRST204"].includes(String(error?.code || ""));

type Entry = {
    at: string;
    at_local: string;
    type: "api" | "payout" | "refund";
    action: string;
    user_id: number | null;
    user: string | null;
    channel: string | null;
    ok: boolean;
    error_code?: string | null;
    event_id: number | null;
    summary: string | null;
    target?: string | null;
};

async function loadAuditRows(ctx: ToolContext, args: any, limit: number) {
    const build = (cols: string) => {
        let q = ctx.supabase
            .from("aitickets_api_audit")
            .select(cols)
            .eq("organization_id", ctx.actor.orgId)
            .order("created_at", { ascending: false })
            .limit(limit);
        if (args.tool) q = q.eq("tool", args.tool);
        if (args.event_id) q = q.eq("event_id", args.event_id);
        if (args.user_id) q = q.eq("user_id", args.user_id);
        if (args.since) q = q.gte("created_at", args.since);
        if (ctx.actor.eventIds) q = q.in("event_id", ctx.actor.eventIds);
        return q;
    };
    let { data, error } = await build("id, created_at, tool, channel, ok, error_code, event_id, user_id, summary, target");
    if (error && isMissing(error)) ({ data, error } = await build("id, created_at, tool, channel, ok, error_code, event_id, user_id"));
    if (error) throw error;
    return data || [];
}

async function loadMoneyEntries(ctx: ToolContext, args: any, limit: number): Promise<Omit<Entry, "user" | "at_local">[]> {
    const out: Omit<Entry, "user" | "at_local">[] = [];
    const sinceOk = (iso: string | null) => Boolean(iso) && (!args.since || iso! >= new Date(args.since).toISOString());

    if (!args.event_id && !ctx.actor.eventIds) {
        const q = ctx.supabase
            .from("aitickets_payouts")
            .select("id, created_at, amount, status, requested_by, requested_via, paid_at, cancelled_at, cancelled_by, failure_reason")
            .eq("organization_id", ctx.actor.orgId)
            .order("created_at", { ascending: false })
            .limit(limit);
        const { data, error } = await q;
        if (error && !isMissing(error)) throw error;
        for (const p of data || []) {
            const amount = `$${Number(p.amount || 0).toLocaleString("es-CL")} CLP`;
            if (sinceOk(p.created_at)) out.push({ at: p.created_at, type: "payout", action: "payout_requested", user_id: p.requested_by ?? null, channel: p.requested_via, ok: true, event_id: null, summary: `Retiro solicitado por ${amount} (estado: ${p.status})`, target: p.id });
            if (p.paid_at && sinceOk(p.paid_at)) out.push({ at: p.paid_at, type: "payout", action: "payout_paid", user_id: null, channel: "aitickets", ok: true, event_id: null, summary: `Retiro de ${amount} transferido`, target: p.id });
            if (p.cancelled_at && sinceOk(p.cancelled_at)) out.push({ at: p.cancelled_at, type: "payout", action: "payout_cancelled", user_id: p.cancelled_by ?? null, channel: null, ok: true, event_id: null, summary: `Retiro de ${amount} anulado`, target: p.id });
            if (p.status === "failed") out.push({ at: p.paid_at || p.created_at, type: "payout", action: "payout_failed", user_id: null, channel: "aitickets", ok: false, event_id: null, summary: `Retiro de ${amount} falló${p.failure_reason ? `: ${p.failure_reason}` : ""}`, target: p.id });
        }
    }

    let rq = ctx.supabase
        .from("aitickets_refunds")
        .select("id, created_at, event_id, order_id, kind, total_amount, status, source, requested_by, requested_via, processed_at")
        .eq("organization_id", ctx.actor.orgId)
        .order("created_at", { ascending: false })
        .limit(limit);
    if (args.event_id) rq = rq.eq("event_id", args.event_id);
    if (ctx.actor.eventIds) rq = rq.in("event_id", ctx.actor.eventIds);
    const { data: refunds, error: rError } = await rq;
    if (rError && !isMissing(rError)) throw rError;
    for (const r of refunds || []) {
        const amount = `$${Number(r.total_amount || 0).toLocaleString("es-CL")} CLP`;
        const what = r.source === "cancel_event" ? "por cancelación del evento" : r.kind === "partial" ? "parcial" : "total";
        if (sinceOk(r.created_at)) out.push({ at: r.created_at, type: "refund", action: "refund_requested", user_id: r.requested_by ?? null, channel: r.requested_via, ok: true, event_id: Number(r.event_id), summary: `Reembolso ${what} de ${amount} (estado: ${r.status})`, target: r.order_id });
        if (r.processed_at && sinceOk(r.processed_at)) out.push({ at: r.processed_at, type: "refund", action: `refund_${r.status}`, user_id: null, channel: "aitickets", ok: r.status === "completed", event_id: Number(r.event_id), summary: `Reembolso de ${amount} ${r.status === "completed" ? "devuelto al comprador" : r.status}`, target: r.order_id });
    }
    return out;
}

const listAuditLog: ToolDef = {
    name: "list_audit_log",
    title: "Bitácora de acciones",
    description:
        "Quién hizo qué y cuándo: acciones hechas vía API/MCP (publicar, editar, reembolsar, retirar, invitar…, con usuario, canal y resultado) " +
        "más los movimientos de plata (retiros y reembolsos solicitados, pagados o anulados). Más reciente primero. " +
        "Las acciones hechas en el panel web solo aparecen si mueven plata.",
    scope: "read",
    permission: "audit.read",
    annotations: { readOnlyHint: true },
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            tool: { type: "string", maxLength: 60, pattern: "^[a-z_]+$", description: "Filtrar por herramienta (ej. refund_order). Omite los movimientos de plata." },
            event_id: { ...eventIdSchema, description: "Filtrar por evento." },
            user_id: { type: "integer", minimum: 1, description: "Filtrar por usuario (list_members)." },
            since: { type: "string", format: "date-time", description: "Desde (ISO 8601)." },
            include_money: { type: "boolean", default: true, description: "Incluir retiros y reembolsos." },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        },
    },
    async handler(args, ctx) {
        if (args.event_id) await loadOwnedEvent(ctx, args.event_id, "id");
        const auditRows = await loadAuditRows(ctx, args, args.limit);
        const money = args.include_money && !args.tool ? await loadMoneyEntries(ctx, args, args.limit) : [];
        const entries: Omit<Entry, "user" | "at_local">[] = [
            ...auditRows.map((r: any) => ({
                at: r.created_at,
                type: "api" as const,
                action: r.tool,
                user_id: r.user_id ?? null,
                channel: r.channel,
                ok: r.ok !== false,
                error_code: r.error_code ?? null,
                event_id: r.event_id != null ? Number(r.event_id) : null,
                summary: r.summary ?? null,
                target: r.target ?? null,
            })),
            ...money.filter((m) => !args.user_id || Number(m.user_id) === Number(args.user_id)),
        ]
            .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
            .slice(0, args.limit);

        const userIds = [...new Set(entries.map((e) => e.user_id).filter((id): id is number => id != null))];
        const names = new Map<number, string>();
        if (userIds.length) {
            const { data: users } = await ctx.supabase.from("users").select("id, name, email").eq("organization_id", ctx.actor.orgId).in("id", userIds);
            for (const u of users || []) names.set(Number(u.id), u.name || u.email || `Usuario ${u.id}`);
        }
        return {
            count: entries.length,
            entries: entries.map((e) => ({ ...e, at_local: fmt(e.at), user: e.user_id != null ? names.get(Number(e.user_id)) || `Usuario ${e.user_id}` : e.channel === "aitickets" ? "AI Tickets" : null })),
        };
    },
};

// ---------------------------------------------------------------------------
// export_orders
// ---------------------------------------------------------------------------

const INLINE_MAX_ROWS = 50;

const exportOrders: ToolDef = {
    name: "export_orders",
    title: "Exportar órdenes (contabilidad)",
    description:
        "Planilla CSV (separador ;, abre en Excel) de órdenes pagadas y reembolsadas para contabilidad: fecha, comprador, entradas, subtotal, descuento, " +
        "cargo por servicio e IVA, total pagado, neto del productor, cargo absorbido, medio de pago, canal y reembolsos. " +
        `Devuelve un link de descarga privado que vence en ${EXPORT_TTL_SECONDS / 60} minutos (entrégalo al productor) y los totales; ` +
        `si son ≤ ${INLINE_MAX_ROWS} filas incluye además el CSV. Contiene datos personales.`,
    scope: "attendees",
    permission: "attendees.read",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            event_id: { ...eventIdSchema, description: "Solo este evento. Omitir = todos los eventos." },
            from: { type: "string", pattern: DATE_PATTERN, description: "Desde (YYYY-MM-DD, hora de Chile, inclusive)." },
            to: { type: "string", pattern: DATE_PATTERN, description: "Hasta (YYYY-MM-DD, hora de Chile, inclusive)." },
        },
    },
    async handler(args, ctx) {
        if (args.from && args.to && args.to < args.from) throw new ToolError("invalid_input", "to debe ser igual o posterior a from.");
        let eventIds: number[] | null = ctx.actor.eventIds || null;
        if (args.event_id) {
            await loadOwnedEvent(ctx, args.event_id, "id");
            eventIds = [Number(args.event_id)];
        }
        const from = args.from ? (zonedDateTimeToUtc(args.from, "00:00") as Date).toISOString() : null;
        const to = args.to ? (zonedDateTimeToUtc(addDays(args.to, 1), "00:00") as Date).toISOString() : null;

        const rows = await buildOrderExportRows(ctx.supabase, { orgId: ctx.actor.orgId, eventIds, from, to });
        const totals = rows.reduce(
            (t, r) => ({
                orders: t.orders + 1,
                tickets: t.tickets + (Number(r.quantity) || 0),
                total_paid_clp: t.total_paid_clp + r.total_paid,
                producer_net_clp: t.producer_net_clp + (r.status === "Pagada" ? r.producer_net : 0),
                service_fees_clp: t.service_fees_clp + r.fee_net + r.fee_iva,
                discounts_clp: t.discounts_clp + r.discount,
                refunded_clp: t.refunded_clp + r.refunded,
            }),
            { orders: 0, tickets: 0, total_paid_clp: 0, producer_net_clp: 0, service_fees_clp: 0, discounts_clp: 0, refunded_clp: 0 },
        );
        const { token, expiresAt } = signExportToken({ org: ctx.actor.orgId, uid: ctx.actor.userId, events: eventIds, from, to });
        return {
            ...(args.event_id ? { event_id: Number(args.event_id) } : {}),
            row_count: rows.length,
            totals,
            download_url: `${ctx.origin}/api/exports/orders?token=${encodeURIComponent(token)}`,
            expires_at: expiresAt,
            ...(rows.length <= INLINE_MAX_ROWS ? { csv: rowsToCsv(rows).replace(/^﻿/, "") } : {}),
            note: `Link privado: vence en ${EXPORT_TTL_SECONDS / 60} minutos y solo funciona mientras tengas acceso. Contiene datos personales de compradores.`,
        };
    },
    audit: (args, result: any) => ({ summary: `Exportación de ${result.row_count} órdenes${args.from || args.to ? ` (${args.from || "…"} a ${args.to || "…"})` : ""}` }),
};

export const auditTools: ToolDef[] = [listAuditLog, exportOrders];
