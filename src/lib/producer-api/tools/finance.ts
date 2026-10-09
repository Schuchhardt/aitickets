// Herramientas: cuenta de pago, comisiones, saldo y retiros (scope "finance").
// Los datos bancarios NUNCA pasan por el chat: se ingresan en el panel (requiere sesión) y aquí solo se exponen
// banco, tipo y últimos 4 dígitos. Los retiros se solicitan aquí y AI Tickets los transfiere manualmente.
// Saldo: ver src/lib/producer-api/ledger.ts.
import { randomUUID } from "node:crypto";
import { ToolError, type ToolDef, type ToolContext } from "../registry";
import { eventIdSchema, loadOwnedEvent, clp, fetchAll } from "./common";
import { computeOrgLedger, addBusinessDays, loadOrgEvents, RELEASE_HOURS, WITHDRAWN_STATUSES, isActiveRefund } from "../ledger";
import { computeFeeSplit, SERVICE_FEE_RATE, IVA_RATE, SERVICE_FEE_PERCENT_LABEL, IVA_PERCENT_LABEL } from "../../../../netlify/lib/fees.mjs";
import { computeDiscountAmount } from "../../../../netlify/lib/discounts.mjs";
import { notifySlack } from "../../../pages/api/_lib/server-utils";

export const BANK_CHANGE_HOLD_HOURS = 72;
const PAYOUT_BUSINESS_DAYS = 2;
const isMissing = (error: any) => ["42P01", "PGRST205", "42703", "PGRST204"].includes(String(error?.code || ""));

// ---------------------------------------------------------------------------
// Cuenta de pago
// ---------------------------------------------------------------------------

const PAYOUT_COLUMNS = "legal_name, legal_rut, bank_name, bank_account_type, bank_account_number, bank_account_holder, bank_account_rut, updated_at";
const PAYOUT_V2_COLUMNS = `${PAYOUT_COLUMNS}, verified_at, verified_by, bank_changed_at, removed_at`;

export async function loadPayoutAccount(ctx: ToolContext): Promise<any | null> {
    const run = (cols: string) => ctx.supabase.from("organization_payout_accounts").select(cols).eq("organization_id", ctx.actor.orgId).maybeSingle();
    let { data, error } = await run(PAYOUT_V2_COLUMNS);
    if (error && isMissing(error)) ({ data, error } = await run(PAYOUT_COLUMNS));
    if (error) throw error;
    return data || null;
}

const last4 = (v: unknown) => {
    const digits = String(v || "").replace(/\D/g, "");
    return digits ? digits.slice(-4) : null;
};
const maskName = (v: unknown) =>
    String(v || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => `${w[0]}${"*".repeat(Math.max(2, w.length - 1))}`)
        .join(" ") || null;
const maskRut = (v: unknown) => {
    const s = String(v || "").replace(/[^0-9kK]/g, "");
    return s.length >= 2 ? `••••${s.slice(-4, -1)}-${s.slice(-1).toUpperCase()}` : null;
};

export function payoutAccountState(acc: any, now = new Date()) {
    const complete = Boolean(acc?.bank_name && acc?.bank_account_number && acc?.bank_account_holder && acc?.bank_account_rut);
    const holdUntil = acc?.bank_changed_at ? new Date(new Date(acc.bank_changed_at).getTime() + BANK_CHANGE_HOLD_HOURS * 3600000) : null;
    const coolingActive = Boolean(holdUntil && holdUntil.getTime() > now.getTime());
    let status: "missing" | "pending_verification" | "verified" | "removed";
    if (!complete) status = acc?.removed_at ? "removed" : "missing";
    else if (acc?.verified_at) status = "verified";
    else status = "pending_verification";
    return { complete, status, holdUntil, coolingActive, canPayout: status === "verified" && !coolingActive };
}

function presentAccount(acc: any) {
    const state = payoutAccountState(acc);
    return {
        status: state.status,
        bank: acc?.bank_name || null,
        account_type: acc?.bank_account_type || null,
        account_last4: last4(acc?.bank_account_number),
        holder: maskName(acc?.bank_account_holder),
        holder_rut: maskRut(acc?.bank_account_rut),
        legal_name: acc?.legal_name || null,
        verified_at: acc?.verified_at || null,
        last_changed_at: acc?.bank_changed_at || acc?.updated_at || null,
        payouts_blocked_until: state.coolingActive ? state.holdUntil!.toISOString() : null,
        can_request_payout: state.canPayout,
    };
}

const settingsUrl = (ctx: ToolContext) => `${ctx.origin}/dashboard/settings#datos-bancarios`;

const getPayoutAccount: ToolDef = {
    name: "get_payout_account",
    title: "Ver cuenta de pago",
    description:
        "Muestra si hay una cuenta bancaria registrada para recibir los pagos y su estado (missing, pending_verification, verified, removed). " +
        "Solo expone banco, tipo de cuenta y últimos 4 dígitos: nunca el número completo ni el RUT.",
    scope: "finance",
    permission: "finance.read",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
        const acc = await loadPayoutAccount(ctx);
        return {
            account: presentAccount(acc),
            manage_url: settingsUrl(ctx),
            note:
                "Los datos bancarios se ingresan o cambian solo en el panel (con sesión iniciada), nunca por el chat. " +
                `Un cambio de cuenta requiere nueva verificación de AI Tickets y bloquea los retiros por ${BANK_CHANGE_HOLD_HOURS} h.`,
        };
    },
};

const createPayoutAccountLink: ToolDef = {
    name: "create_payout_account_link",
    title: "Link para ingresar datos bancarios",
    description:
        "Entrega el link seguro del panel donde el productor ingresa o cambia sus datos bancarios. Requiere iniciar sesión en AI Tickets: " +
        "los datos bancarios NO deben pedirse ni escribirse en el chat. Úsala cuando falte la cuenta o haya que cambiarla.",
    scope: "finance",
    permission: "finance.manage",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
        const acc = await loadPayoutAccount(ctx);
        return {
            url: settingsUrl(ctx),
            current_status: payoutAccountState(acc).status,
            instructions:
                "Abre el link, inicia sesión con tu cuenta de AI Tickets y completa la sección 'Datos para pagos'. No compartas tu número de cuenta en el chat. " +
                `Después de guardar, AI Tickets verifica la cuenta y los retiros quedan habilitados ${BANK_CHANGE_HOLD_HOURS} h después del último cambio.`,
        };
    },
};

const getVerificationStatus: ToolDef = {
    name: "get_verification_status",
    title: "Estado de verificación para retiros",
    description: "Indica qué falta para poder retirar dinero: correo verificado, términos aceptados, datos bancarios completos, verificación de AI Tickets y espera tras cambios.",
    scope: "finance",
    permission: "finance.read",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
        let { data: org, error } = await ctx.supabase.from("organizations").select("id, email_verified_at, terms_accepted_at").eq("id", ctx.actor.orgId).maybeSingle();
        if (error && isMissing(error)) org = { id: ctx.actor.orgId, email_verified_at: true, terms_accepted_at: true };
        const acc = await loadPayoutAccount(ctx);
        const state = payoutAccountState(acc);
        const checks = [
            { item: "email_verified", label: "Correo de la organización verificado", ok: Boolean(org?.email_verified_at), required: true },
            { item: "terms_accepted", label: "Términos para productores aceptados", ok: Boolean(org?.terms_accepted_at), required: false },
            { item: "legal_identity", label: "Razón social y RUT de la empresa (recomendado para la boleta/factura)", ok: Boolean(acc?.legal_name && acc?.legal_rut), required: false },
            { item: "bank_account", label: "Datos bancarios completos (banco, número, titular y RUT del titular)", ok: state.complete, required: true },
            { item: "bank_verified", label: "Cuenta verificada por AI Tickets", ok: state.status === "verified", required: true },
            {
                item: "bank_change_hold",
                label: `Espera de ${BANK_CHANGE_HOLD_HOURS} h tras cambiar la cuenta`,
                ok: !state.coolingActive,
                required: true,
                ...(state.coolingActive ? { until: state.holdUntil!.toISOString() } : {}),
            },
        ];
        const missing = checks.filter((c) => !c.ok).map(({ item, label, required, ...rest }) => ({ item, label, blocks_payouts: required, ...rest }));
        return {
            can_request_payout: checks.every((c) => !c.required || c.ok),
            missing,
            checks,
            manage_url: settingsUrl(ctx),
            note: state.status === "pending_verification" ? "AI Tickets revisa las cuentas nuevas o modificadas, normalmente en 1 día hábil." : undefined,
        };
    },
};

async function activePayoutsCount(ctx: ToolContext): Promise<number> {
    const { count, error } = await ctx.supabase
        .from("aitickets_payouts")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", ctx.actor.orgId)
        .in("status", ["requested", "processing"]);
    if (error && !isMissing(error)) throw error;
    return count || 0;
}

const removePayoutAccount: ToolDef = {
    name: "remove_payout_account",
    title: "Dar de baja la cuenta de pago",
    description: "Elimina los datos bancarios registrados. No se puede si hay retiros solicitados o en proceso. Hasta registrar otra cuenta no se pueden pedir retiros.",
    scope: "finance",
    permission: "finance.manage",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async confirm(_args, ctx) {
        const acc = await loadPayoutAccount(ctx);
        if (!payoutAccountState(acc).complete) throw new ToolError("not_found", "No hay una cuenta bancaria registrada.");
        if (await activePayoutsCount(ctx)) throw new ToolError("conflict", "Hay retiros solicitados o en proceso: espera a que se paguen o anúlalos (cancel_payout) antes de dar de baja la cuenta.");
        return {
            message: `Se eliminará la cuenta ${acc.bank_name || ""} terminada en ${last4(acc.bank_account_number) || "—"}. No podrás pedir retiros hasta registrar y verificar otra cuenta.`,
            details: { bank: acc.bank_name, account_last4: last4(acc.bank_account_number) },
        };
    },
    async handler(_args, ctx) {
        if (await activePayoutsCount(ctx)) throw new ToolError("conflict", "Hay retiros solicitados o en proceso.");
        const patch: Record<string, unknown> = {
            bank_name: null,
            bank_account_type: null,
            bank_account_number: null,
            bank_account_holder: null,
            bank_account_rut: null,
            updated_at: new Date().toISOString(),
            updated_by: ctx.actor.userId,
            removed_at: new Date().toISOString(),
        };
        let { error } = await ctx.supabase.from("organization_payout_accounts").update(patch).eq("organization_id", ctx.actor.orgId);
        if (error && isMissing(error)) {
            delete patch.removed_at;
            ({ error } = await ctx.supabase.from("organization_payout_accounts").update(patch).eq("organization_id", ctx.actor.orgId));
        }
        if (error) throw error;
        await notifySlack(`🏦 *Cuenta de pago dada de baja vía ${ctx.channel === "mcp" ? "MCP" : "API"}*\n• *Org:* ${ctx.actor.orgId}\n• *Por usuario:* ${ctx.actor.userId}`);
        return { status: "removed", manage_url: settingsUrl(ctx) };
    },
    audit: () => ({ summary: "Cuenta de pago dada de baja", target: "payout_account" }),
};

// ---------------------------------------------------------------------------
// Comisiones
// ---------------------------------------------------------------------------

const getFeeSchedule: ToolDef = {
    name: "get_fee_schedule",
    title: "Comisiones vigentes",
    description: "¿Cuánto me cobran? Cargo por servicio vigente, quién lo paga, eventos donde lo absorbe el productor y plazos de pago.",
    scope: "finance",
    permission: "finance.read",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
        const events = await loadOrgEvents(ctx.supabase, ctx.actor.orgId, ctx.actor.eventIds);
        const example = computeFeeSplit(10000);
        const exampleAbsorbed = computeFeeSplit(10000, { absorbed: true });
        return {
            service_fee: {
                rate: SERVICE_FEE_RATE,
                label: `${SERVICE_FEE_PERCENT_LABEL} del valor de las entradas`,
                vat_on_fee: { rate: IVA_RATE, label: `IVA ${IVA_PERCENT_LABEL} sobre el cargo` },
                effective_rate_label: `≈ ${(SERVICE_FEE_RATE * (1 + IVA_RATE) * 100).toFixed(2).replace(".", ",")}% del precio`,
                free_tickets: "Las entradas gratis no pagan cargo.",
            },
            default_payer: "buyer",
            default_payer_note: "Por defecto el cargo lo paga el comprador y el productor recibe el 100% del valor de sus entradas. Con set_fee_absorption el productor puede absorberlo en un evento.",
            examples: {
                buyer_pays: { ticket_price: 10000, buyer_pays: example.total, producer_receives: example.producerNet },
                producer_absorbs: { ticket_price: 10000, buyer_pays: exampleAbsorbed.total, producer_receives: exampleAbsorbed.producerNet },
            },
            events_with_absorbed_fee: events.filter((e) => e.fee_absorbed).map((e) => ({ id: Number(e.id), name: e.name })),
            payouts: {
                schedule: `El saldo de un evento queda disponible ${RELEASE_HOURS} h después de su última función. AI Tickets transfiere los retiros solicitados en hasta ${PAYOUT_BUSINESS_DAYS} días hábiles.`,
                payment_processor_fee: "Sin costo adicional para el productor: el cargo por servicio cubre el procesamiento del pago.",
            },
        };
    },
};

const quoteFees: ToolDef = {
    name: "quote_fees",
    title: "Simular cobro",
    description:
        "Simula una compra: cuánto paga el comprador y cuánto recibe el productor por un precio de entrada, en ambos modos (el comprador paga el cargo o lo absorbe el productor). " +
        "Acepta un descuento opcional y un event_id para usar el modo configurado en ese evento.",
    scope: "finance",
    permission: "finance.read",
    annotations: { readOnlyHint: true },
    inputSchema: {
        type: "object",
        required: ["price"],
        additionalProperties: false,
        properties: {
            price: { type: "integer", minimum: 0, maximum: 100_000_000, description: "Precio de la entrada en CLP." },
            quantity: { type: "integer", minimum: 1, maximum: 1000, default: 1 },
            discount_percent: { type: "number", minimum: 0, maximum: 100, description: "Descuento porcentual a simular (ej. 20)." },
            discount_amount: { type: "integer", minimum: 0, maximum: 100_000_000, description: "Descuento fijo en CLP a simular (alternativa a discount_percent)." },
            event_id: { ...eventIdSchema, description: "Opcional: usa el modo (fee_absorbed) de este evento." },
            absorbed: { type: "boolean", description: "Opcional: fuerza el modo (true = lo absorbe el productor)." },
        },
    },
    async handler(args, ctx) {
        let absorbed: boolean | undefined = args.absorbed;
        if (args.event_id) {
            const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, name");
            if (absorbed === undefined) {
                const { data } = await ctx.supabase.from("events").select("fee_absorbed").eq("id", event.id).maybeSingle();
                absorbed = Boolean(data?.fee_absorbed);
            }
        }
        const gross = args.price * args.quantity;
        if (args.discount_percent !== undefined && args.discount_amount !== undefined) {
            throw new ToolError("invalid_input", "Usa discount_percent o discount_amount, no ambos.");
        }
        const discount =
            args.discount_percent !== undefined ? { kind: "percent" as const, value: args.discount_percent } : args.discount_amount !== undefined ? { kind: "fixed" as const, value: args.discount_amount } : null;
        const discountAmount = discount ? computeDiscountAmount(discount, gross) : 0;
        const subtotal = gross - discountAmount;
        const mode = (abs: boolean) => {
            const s = computeFeeSplit(subtotal, { absorbed: abs });
            return { buyer_pays: s.total, producer_receives: s.producerNet, service_fee_net: s.feeNet, service_fee_vat: s.feeIva, service_fee_total: s.fee };
        };
        const buyer = mode(false);
        const producer = mode(true);
        return {
            ticket_price: args.price,
            quantity: args.quantity,
            gross_subtotal: gross,
            discount: discountAmount,
            subtotal,
            buyer_pays_fee: buyer,
            producer_absorbs_fee: producer,
            ...(absorbed !== undefined ? { selected_mode: absorbed ? "producer_absorbs_fee" : "buyer_pays_fee", selected: absorbed ? producer : buyer } : {}),
            summary:
                `Entrada ${clp(args.price)} × ${args.quantity}${discountAmount ? ` con descuento de ${clp(discountAmount)}` : ""}: ` +
                `si paga el comprador, paga ${clp(buyer.buyer_pays)} y el productor recibe ${clp(buyer.producer_receives)}; ` +
                `si lo absorbe el productor, el comprador paga ${clp(producer.buyer_pays)} y el productor recibe ${clp(producer.producer_receives)}.`,
        };
    },
};

const setFeeAbsorption: ToolDef = {
    name: "set_fee_absorption",
    title: "Quién paga el cargo por servicio",
    description:
        "Define si en un evento el cargo por servicio lo paga el comprador (absorbed=false, por defecto) o lo absorbe el productor (absorbed=true: el comprador paga el precio publicado " +
        "y el cargo se descuenta de lo que recibe el productor). Cambia el precio que ve el público: aplica solo a compras nuevas.",
    scope: "finance",
    permission: "finance.manage",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id", "absorbed"],
        additionalProperties: false,
        properties: { event_id: eventIdSchema, absorbed: { type: "boolean", description: "true = lo absorbe el productor; false = lo paga el comprador." } },
    },
    async confirm(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, name");
        const { data, error } = await ctx.supabase.from("events").select("fee_absorbed").eq("id", event.id).maybeSingle();
        if (error && isMissing(error)) throw new ToolError("unavailable", "Esta opción aún no está disponible. Intenta en unos minutos.");
        const current = Boolean(data?.fee_absorbed);
        const ex = computeFeeSplit(10000, { absorbed: args.absorbed });
        return {
            message:
                `Evento "${event.name}": el cargo por servicio pasará a ${args.absorbed ? "ser absorbido por el productor" : "pagarlo el comprador"}` +
                `${current === args.absorbed ? " (ya está así; no cambia nada)" : ""}. Ejemplo con una entrada de $10.000: el comprador paga ${clp(ex.total)} y tú recibes ${clp(ex.producerNet)}. ` +
                "Aplica solo a compras nuevas.",
            details: { event_id: Number(event.id), current_absorbed: current, new_absorbed: args.absorbed },
        };
    },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, name");
        const { error } = await ctx.supabase.from("events").update({ fee_absorbed: args.absorbed }).eq("id", event.id).eq("organization_id", ctx.actor.orgId);
        if (error) {
            if (isMissing(error)) throw new ToolError("unavailable", "Esta opción aún no está disponible. Intenta en unos minutos.");
            throw error;
        }
        return { event_id: Number(event.id), fee_absorbed: args.absorbed, applies_to: "compras nuevas" };
    },
    audit: (args) => ({ summary: `Cargo por servicio ${args.absorbed ? "absorbido por el productor" : "pagado por el comprador"}`, target: `event:${args.event_id}` }),
};

// ---------------------------------------------------------------------------
// Saldo y movimientos
// ---------------------------------------------------------------------------

const presentLedgerEvent = (l: any) => ({
    event_id: l.event_id,
    name: l.name,
    cancelled: l.cancelled,
    last_function_end: l.last_function_end,
    available_from: l.releases_at,
    sales_net: l.sales_net,
    partial_refunds: l.partial_refunds,
    withdrawn: l.withdrawn,
    paid_out: l.paid_out,
    balance: l.net_due,
    available: l.available,
    pending: l.pending,
    retained: l.retained,
});

const getBalance: ToolDef = {
    name: "get_balance",
    title: "Saldo",
    description:
        `Saldo del productor en CLP: disponible para retirar (eventos cuya última función terminó hace ≥ ${RELEASE_HOURS} h), pendiente (eventos por realizarse) ` +
        "y retenido (pagos en revisión o eventos cancelados). Incluye el detalle por evento.",
    scope: "finance",
    permission: "finance.read",
    annotations: { readOnlyHint: true },
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { include_settled: { type: "boolean", default: false, description: "true = incluye eventos sin saldo pendiente." } },
    },
    async handler(args, ctx) {
        const ledger = await computeOrgLedger(ctx.supabase, ctx.actor.orgId, { eventIds: ctx.actor.eventIds });
        const events = ledger.events.filter((l) => args.include_settled || l.net_due !== 0 || l.retained > 0).map(presentLedgerEvent);
        return {
            currency: "CLP",
            available: ledger.totals.available,
            pending: ledger.totals.pending,
            retained: ledger.totals.retained,
            ...(ledger.totals.negative_balance ? { negative_balance: ledger.totals.negative_balance, negative_balance_note: "Hay reembolsos posteriores a un retiro: se descuentan del disponible." } : {}),
            total_paid_out: ledger.totals.paid_out,
            events,
            summary: `Disponible ${clp(ledger.totals.available)} · Pendiente ${clp(ledger.totals.pending)} · Retenido ${clp(ledger.totals.retained)}.`,
        };
    },
};

const TX_TYPES = ["sale", "absorbed_fee", "refund", "payout", "all"] as const;

const listBalanceTransactions: ToolDef = {
    name: "list_balance_transactions",
    title: "Movimientos del saldo",
    description:
        "Movimientos que afectan el saldo, del más reciente al más antiguo: ventas (neto productor), cargos absorbidos, reembolsos y retiros. " +
        "Montos en CLP: positivos suman, negativos restan.",
    scope: "finance",
    permission: "finance.read",
    annotations: { readOnlyHint: true },
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            event_id: { ...eventIdSchema, description: "Opcional: solo un evento." },
            type: { type: "string", enum: TX_TYPES, default: "all" },
            from: { type: "string", format: "date-time", description: "Desde (ISO)." },
            to: { type: "string", format: "date-time", description: "Hasta (ISO)." },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
            offset: { type: "integer", minimum: 0, maximum: 100000, default: 0 },
        },
    },
    async handler(args, ctx) {
        if (args.event_id) await loadOwnedEvent(ctx, args.event_id, "id");
        const events = await loadOrgEvents(ctx.supabase, ctx.actor.orgId, args.event_id ? [args.event_id] : ctx.actor.eventIds);
        const names = new Map(events.map((e) => [Number(e.id), e.name]));
        const ids = [...names.keys()];
        if (!ids.length) return { total: 0, transactions: [] };

        const txs: any[] = [];
        const want = (t: string) => args.type === "all" || args.type === t;
        if (want("sale") || want("absorbed_fee") || want("refund")) {
            const run = (cols: string) => fetchAll<any>(() => ctx.supabase.from("event_orders").select(cols).in("event_id", ids).in("status", ["paid", "refunded"]));
            let orders: any[];
            try {
                orders = await run("id, event_id, created_at, status, amount, ticket_qty, ticket_fee, service_fee_tax, discount_amount, fee_absorbed, refunded_at");
            } catch (err: any) {
                if (!isMissing(err)) throw err;
                orders = await run("id, event_id, created_at, status, amount, ticket_qty, ticket_fee");
            }
            let refunds: any[] = [];
            try {
                refunds = await fetchAll<any>(() => ctx.supabase.from("aitickets_refunds").select("id, order_id, event_id, created_at, ticket_amount, status, kind").eq("organization_id", ctx.actor.orgId).in("event_id", ids));
            } catch (err: any) {
                if (!isMissing(err)) throw err;
            }
            const refundedWithRow = new Set(refunds.filter((r) => isActiveRefund(r)).map((r) => String(r.order_id)));
            for (const o of orders) {
                const amount = Math.round(Number(o.amount) || 0);
                if (amount === 0 && !o.fee_absorbed) continue; // cortesías y gratis
                if (want("sale")) txs.push({ type: "sale", date: o.created_at, event_id: Number(o.event_id), event: names.get(Number(o.event_id)), order_id: o.id, tickets: o.ticket_qty, amount });
                if (o.fee_absorbed && want("absorbed_fee")) {
                    const fee = (Number(o.ticket_fee) || 0) + (Number(o.service_fee_tax) || 0);
                    txs.push({ type: "absorbed_fee", date: o.created_at, event_id: Number(o.event_id), event: names.get(Number(o.event_id)), order_id: o.id, amount: -fee, note: "Informativo: ya descontado del neto de la venta." });
                }
                if (o.status === "refunded" && !refundedWithRow.has(String(o.id)) && want("refund")) {
                    txs.push({ type: "refund", date: o.refunded_at || o.created_at, event_id: Number(o.event_id), event: names.get(Number(o.event_id)), order_id: o.id, amount: -amount, kind: "full" });
                }
            }
            if (want("refund")) {
                for (const r of refunds) {
                    if (!isActiveRefund(r)) continue;
                    txs.push({ type: "refund", date: r.created_at, event_id: Number(r.event_id), event: names.get(Number(r.event_id)), order_id: r.order_id, refund_id: r.id, amount: -Math.round(Number(r.ticket_amount) || 0), kind: r.kind, status: r.status });
                }
            }
        }
        if (want("payout")) {
            let rows: any[] = [];
            try {
                rows = await fetchAll<any>(() => ctx.supabase.from("event_withdrawals").select("id, event_id, created_at, amount, status, paid_at, payout_id").in("event_id", ids));
            } catch (err: any) {
                if (!isMissing(err)) throw err;
                rows = await fetchAll<any>(() => ctx.supabase.from("event_withdrawals").select("id, event_id, created_at, amount, status, paid_at").in("event_id", ids));
            }
            for (const w of rows) {
                if (!WITHDRAWN_STATUSES.includes(String(w.status))) continue;
                txs.push({ type: "payout", date: w.paid_at || w.created_at, event_id: Number(w.event_id), event: names.get(Number(w.event_id)), payout_id: w.payout_id || null, amount: -Math.round(Number(w.amount) || 0), status: w.status });
            }
        }
        const fromT = args.from ? new Date(args.from).getTime() : -Infinity;
        const toT = args.to ? new Date(args.to).getTime() : Infinity;
        const filtered = txs
            .filter((t) => {
                const d = new Date(t.date).getTime();
                return d >= fromT && d <= toT;
            })
            .sort((a, b) => String(b.date).localeCompare(String(a.date)));
        return { currency: "CLP", total: filtered.length, offset: args.offset, transactions: filtered.slice(args.offset, args.offset + args.limit) };
    },
};

// ---------------------------------------------------------------------------
// Retiros
// ---------------------------------------------------------------------------

type Allocation = { event_id: number; name: string; amount: number };

function allocateFifo(ledgerEvents: any[], amount: number): Allocation[] {
    const sorted = ledgerEvents
        .filter((l) => l.available > 0)
        .sort((a, b) => String(a.releases_at || "").localeCompare(String(b.releases_at || "")) || a.event_id - b.event_id);
    const out: Allocation[] = [];
    let left = amount;
    for (const l of sorted) {
        if (left <= 0) break;
        const take = Math.min(left, l.available);
        out.push({ event_id: l.event_id, name: l.name, amount: take });
        left -= take;
    }
    return out;
}

async function planPayout(args: any, ctx: ToolContext) {
    const acc = await loadPayoutAccount(ctx);
    const state = payoutAccountState(acc);
    if (!state.complete) throw new ToolError("conflict", `No hay una cuenta bancaria registrada. Regístrala en ${settingsUrl(ctx)} (create_payout_account_link).`);
    if (state.status !== "verified") throw new ToolError("conflict", "La cuenta bancaria aún no está verificada por AI Tickets. Revisa get_verification_status.");
    if (state.coolingActive) {
        throw new ToolError("conflict", `La cuenta bancaria cambió hace poco: por seguridad los retiros quedan habilitados desde ${state.holdUntil!.toISOString()}.`);
    }
    const ledger = await computeOrgLedger(ctx.supabase, ctx.actor.orgId);
    const available = ledger.totals.available;
    if (available <= 0) throw new ToolError("conflict", `No hay saldo disponible para retirar (pendiente ${clp(ledger.totals.pending)}, retenido ${clp(ledger.totals.retained)}).`);
    const amount = args.amount ?? available;
    if (amount > available) throw new ToolError("conflict", `El monto supera el saldo disponible (${clp(available)}).`);
    const allocations = allocateFifo(ledger.events, amount);
    const allocated = allocations.reduce((s, a) => s + a.amount, 0);
    if (allocated < amount) throw new ToolError("conflict", `Solo se pueden asignar ${clp(allocated)} a eventos con saldo disponible.`);
    return { acc, amount, available, allocations, estimated: addBusinessDays(new Date(), PAYOUT_BUSINESS_DAYS) };
}

const requestPayout: ToolDef = {
    name: "request_payout",
    title: "Solicitar retiro",
    description:
        "Solicita transferir saldo disponible a la cuenta bancaria verificada de la organización. amount opcional (por defecto todo lo disponible). " +
        "Solo a cuenta verificada y sin cambios en las últimas 72 h. AI Tickets realiza la transferencia (hasta 2 días hábiles).",
    scope: "finance",
    permission: "finance.manage",
    idempotent: true,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { amount: { type: "integer", minimum: 1, maximum: 10_000_000_000, description: "CLP. Omitir = todo el saldo disponible." } },
    },
    async confirm(args, ctx) {
        const plan = await planPayout(args, ctx);
        return {
            message:
                `Retiro de ${clp(plan.amount)} a ${plan.acc.bank_name} (${plan.acc.bank_account_type || "cuenta"}) terminada en ${last4(plan.acc.bank_account_number)}. ` +
                `Fecha estimada de depósito: ${plan.estimated}. Saldo disponible hoy: ${clp(plan.available)}.`,
            details: { amount: plan.amount, bank: plan.acc.bank_name, account_last4: last4(plan.acc.bank_account_number), estimated_payment_date: plan.estimated, events: plan.allocations },
        };
    },
    async handler(args, ctx) {
        const plan = await planPayout(args, ctx);
        // Sin amount explícito se retira "todo lo disponible": debe ser EXACTAMENTE el monto que el productor confirmó
        const confirmedAmount = Number((ctx.confirmed?.details as any)?.amount);
        if (args.amount === undefined && Number.isFinite(confirmedAmount) && confirmedAmount !== plan.amount) {
            throw new ToolError(
                "conflict",
                `El saldo disponible cambió desde la confirmación (${clp(confirmedAmount)} → ${clp(plan.amount)}). Pide un resumen nuevo y vuelve a confirmar con el productor.`,
            );
        }
        const { acc } = plan;
        const { data: payout, error } = await ctx.supabase
            .from("aitickets_payouts")
            .insert({
                id: randomUUID(),
                organization_id: ctx.actor.orgId,
                amount: plan.amount,
                status: "requested",
                bank_name: acc.bank_name,
                bank_account_type: acc.bank_account_type || null,
                bank_account_last4: last4(acc.bank_account_number),
                requested_by: ctx.actor.userId,
                requested_via: ctx.channel,
                estimated_payment_date: plan.estimated,
            })
            .select("id, created_at")
            .single();
        if (error) {
            if (isMissing(error)) throw new ToolError("unavailable", "Los retiros aún no están disponibles. Intenta en unos minutos.");
            throw error;
        }
        const rows = plan.allocations.map((a) => ({
            event_id: a.event_id,
            user_id: ctx.actor.userId,
            amount: a.amount,
            status: "requested",
            estimated_payment_date: plan.estimated,
            account_number: acc.bank_account_number,
            bank_name: acc.bank_name,
            account_holder_name: acc.bank_account_holder,
            account_holder_rut: acc.bank_account_rut,
            payout_id: payout.id,
        }));
        const { error: wError } = await ctx.supabase.from("event_withdrawals").insert(rows);
        const rollback = async () => {
            await ctx.supabase.from("event_withdrawals").delete().eq("payout_id", payout.id);
            await ctx.supabase.from("aitickets_payouts").delete().eq("id", payout.id).eq("organization_id", ctx.actor.orgId);
        };
        if (wError) {
            await rollback();
            throw wError;
        }
        // Dos solicitudes simultáneas podrían asignar el mismo saldo: se revisa después de insertar.
        const after = await computeOrgLedger(ctx.supabase, ctx.actor.orgId);
        if (after.events.some((l) => l.net_due < 0 && plan.allocations.some((a) => a.event_id === l.event_id))) {
            await rollback();
            throw new ToolError("conflict", "El saldo cambió mientras se procesaba el retiro (¿otra solicitud en curso?). Revisa get_balance y vuelve a intentarlo.");
        }
        await notifySlack(
            `💸 *Retiro solicitado vía ${ctx.channel === "mcp" ? "MCP" : "API"}*\n• *Org:* ${ctx.actor.orgId}\n• *Monto:* ${clp(plan.amount)}\n` +
                `• *Cuenta:* ${acc.bank_name} ****${last4(acc.bank_account_number)}\n• *Payout:* ${payout.id}\n• *Eventos:* ${plan.allocations.map((a) => `#${a.event_id} ${clp(a.amount)}`).join(", ")}\n• *Estimado:* ${plan.estimated}`,
        );
        return {
            payout_id: payout.id,
            status: "requested",
            amount: plan.amount,
            bank: acc.bank_name,
            account_last4: last4(acc.bank_account_number),
            estimated_payment_date: plan.estimated,
            events: plan.allocations,
            note: `Solicitud registrada. AI Tickets hace la transferencia manualmente; llegará a más tardar el ${plan.estimated}. Puedes anularla con cancel_payout mientras esté 'requested'.`,
        };
    },
    audit: (_args, result) => ({ summary: `Retiro solicitado por ${clp(Number(result.amount))}`, target: `payout:${result.payout_id}` }),
};

const PAYOUT_SELECT = "id, amount, status, bank_name, bank_account_type, bank_account_last4, requested_by, requested_via, estimated_payment_date, paid_at, cancelled_at, failure_reason, reference, created_at";

const presentPayout = (p: any, items?: any[]) => ({
    id: p.id,
    amount: Number(p.amount),
    status: p.status,
    bank: p.bank_name,
    account_type: p.bank_account_type,
    account_last4: p.bank_account_last4,
    requested_at: p.created_at,
    requested_via: p.requested_via,
    estimated_payment_date: p.estimated_payment_date,
    paid_at: p.paid_at,
    cancelled_at: p.cancelled_at,
    failure_reason: p.failure_reason || null,
    transfer_reference: p.reference || null,
    ...(items ? { events: items.map((w) => ({ event_id: Number(w.event_id), amount: Number(w.amount), status: w.status })) } : {}),
});

const listPayouts: ToolDef = {
    name: "list_payouts",
    title: "Listar retiros",
    description: "Retiros de la organización con su estado (requested, processing, paid, cancelled, failed) y fecha estimada de depósito. Incluye las transferencias manuales antiguas por evento.",
    scope: "finance",
    permission: "finance.read",
    annotations: { readOnlyHint: true },
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            status: { type: "string", enum: ["requested", "processing", "paid", "cancelled", "failed", "all"], default: "all" },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        },
    },
    async handler(args, ctx) {
        let q = ctx.supabase.from("aitickets_payouts").select(PAYOUT_SELECT).eq("organization_id", ctx.actor.orgId).order("created_at", { ascending: false }).limit(args.limit);
        if (args.status !== "all") q = q.eq("status", args.status);
        const { data, error } = await q;
        if (error && !isMissing(error)) throw error;
        // Transferencias manuales antiguas (sin payout_id)
        const events = await loadOrgEvents(ctx.supabase, ctx.actor.orgId, ctx.actor.eventIds);
        const names = new Map(events.map((e) => [Number(e.id), e.name]));
        let legacy: any[] = [];
        if (names.size) {
            const { data: w, error: wErr } = await ctx.supabase
                .from("event_withdrawals")
                .select("id, event_id, amount, status, estimated_payment_date, paid_at, created_at, payout_id")
                .in("event_id", [...names.keys()])
                .is("payout_id", null)
                .order("created_at", { ascending: false })
                .limit(args.limit);
            if (!wErr) legacy = (w || []).filter((r: any) => args.status === "all" || r.status === args.status);
        }
        return {
            payouts: (data || []).map((p: any) => presentPayout(p)),
            manual_transfers: legacy.map((w) => ({
                withdrawal_id: Number(w.id),
                event_id: Number(w.event_id),
                event: names.get(Number(w.event_id)),
                amount: Number(w.amount),
                status: w.status,
                estimated_payment_date: w.estimated_payment_date,
                paid_at: w.paid_at,
                created_at: w.created_at,
            })),
        };
    },
};

async function loadPayout(ctx: ToolContext, payoutId: string) {
    const { data, error } = await ctx.supabase.from("aitickets_payouts").select(PAYOUT_SELECT).eq("id", payoutId).eq("organization_id", ctx.actor.orgId).maybeSingle();
    if (error && !isMissing(error)) throw error;
    if (!data) throw new ToolError("not_found", "Retiro no encontrado en tu organización (ver list_payouts).");
    return data;
}

const payoutIdSchema = { type: "string" as const, pattern: "^[0-9a-fA-F-]{36}$", description: "ID del retiro (ver list_payouts)." };

const getPayout: ToolDef = {
    name: "get_payout",
    title: "Detalle de retiro",
    description: "Estado de un retiro, fecha estimada o real de depósito y reparto por evento.",
    scope: "finance",
    permission: "finance.read",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", required: ["payout_id"], additionalProperties: false, properties: { payout_id: payoutIdSchema } },
    async handler(args, ctx) {
        const p = await loadPayout(ctx, args.payout_id);
        const { data: items } = await ctx.supabase.from("event_withdrawals").select("event_id, amount, status").eq("payout_id", p.id);
        return { payout: presentPayout(p, items || []) };
    },
};

const cancelPayout: ToolDef = {
    name: "cancel_payout",
    title: "Anular retiro",
    description: "Anula un retiro que aún no se procesa (status 'requested'). El monto vuelve al saldo disponible.",
    scope: "finance",
    permission: "finance.manage",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    inputSchema: { type: "object", required: ["payout_id"], additionalProperties: false, properties: { payout_id: payoutIdSchema } },
    async handler(args, ctx) {
        const p = await loadPayout(ctx, args.payout_id);
        if (p.status === "cancelled") return { payout_id: p.id, status: "cancelled", note: "Ya estaba anulado." };
        if (p.status !== "requested") throw new ToolError("conflict", `El retiro está '${p.status}' y ya no se puede anular. Contacta a AI Tickets si hay un problema.`);
        const now = new Date().toISOString();
        const { data: updated, error } = await ctx.supabase
            .from("aitickets_payouts")
            .update({ status: "cancelled", cancelled_at: now, cancelled_by: ctx.actor.userId, updated_at: now })
            .eq("id", p.id)
            .eq("organization_id", ctx.actor.orgId)
            .eq("status", "requested")
            .select("id");
        if (error) throw error;
        if (!updated?.length) throw new ToolError("conflict", "El retiro cambió de estado mientras se anulaba. Revisa get_payout.");
        const { error: wError } = await ctx.supabase.from("event_withdrawals").update({ status: "cancelled" }).eq("payout_id", p.id);
        if (wError) throw wError;
        await notifySlack(`↩️ *Retiro anulado* ${p.id} (org ${ctx.actor.orgId}, ${clp(Number(p.amount))}). No transferir.`);
        return { payout_id: p.id, status: "cancelled", amount: Number(p.amount), note: "El monto vuelve al saldo disponible." };
    },
    audit: (_args, result) => ({ summary: `Retiro anulado (${clp(Number(result.amount) || 0)})`, target: `payout:${result.payout_id}` }),
};

// ---------------------------------------------------------------------------
// Liquidación por evento
// ---------------------------------------------------------------------------

const getSettlementReport: ToolDef = {
    name: "get_settlement_report",
    title: "Liquidación por evento",
    description:
        "Liquidación para cuadrar con el contador: por evento, ventas brutas, descuentos, cargo por servicio pagado por compradores, cargo absorbido por el productor, " +
        "reembolsos, neto del productor, retirado y pendiente de pago. Sin event_id: todos los eventos con ventas.",
    scope: "finance",
    permission: "finance.read",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", additionalProperties: false, properties: { event_id: { ...eventIdSchema, description: "Opcional: un solo evento." } } },
    async handler(args, ctx) {
        if (args.event_id) await loadOwnedEvent(ctx, args.event_id, "id");
        const ledger = await computeOrgLedger(ctx.supabase, ctx.actor.orgId, { eventIds: args.event_id ? [args.event_id] : ctx.actor.eventIds });
        const ids = ledger.events.map((l) => l.event_id);
        const run = (cols: string) => fetchAll<any>(() => ctx.supabase.from("event_orders").select(cols).in("event_id", ids).in("status", ["paid", "refunded"]));
        let orders: any[] = [];
        if (ids.length) {
            try {
                orders = await run("id, event_id, status, amount, ticket_qty, ticket_fee, service_fee_tax, discount_amount, fee_absorbed, payment_provider");
            } catch (err: any) {
                if (!isMissing(err)) throw err;
                orders = await run("id, event_id, status, amount, ticket_qty, ticket_fee");
            }
        }
        let refunds: any[] = [];
        if (ids.length) {
            try {
                refunds = await fetchAll<any>(() => ctx.supabase.from("aitickets_refunds").select("order_id, event_id, ticket_amount, fee_amount, status").eq("organization_id", ctx.actor.orgId).in("event_id", ids));
            } catch (err: any) {
                if (!isMissing(err)) throw err;
            }
        }
        const rows = ledger.events.map((l) => {
            const r = {
                event_id: l.event_id,
                event: l.name,
                last_function_end: l.last_function_end,
                cancelled: l.cancelled,
                paid_orders: 0,
                tickets: 0,
                complimentary_or_free_orders: 0,
                gross_ticket_sales: 0,
                discounts: 0,
                service_fee_paid_by_buyers: 0,
                service_fee_absorbed_by_producer: 0,
                refunds_to_buyers: 0,
                producer_net: 0,
                withdrawn: l.withdrawn,
                paid_out: l.paid_out,
                pending_payment: l.net_due,
            };
            for (const o of orders.filter((o) => Number(o.event_id) === l.event_id)) {
                const amount = Math.round(Number(o.amount) || 0);
                const fee = Math.round((Number(o.ticket_fee) || 0) + (Number(o.service_fee_tax) || 0));
                const discount = Math.round(Number(o.discount_amount) || 0);
                if (o.status === "paid") {
                    r.paid_orders += 1;
                    r.tickets += Number(o.ticket_qty) || 0;
                    if (amount === 0 && !o.fee_absorbed) r.complimentary_or_free_orders += 1;
                }
                // Venta original (también de órdenes luego reembolsadas: el reembolso va en su propia columna)
                r.gross_ticket_sales += amount + discount + (o.fee_absorbed ? fee : 0);
                r.discounts += discount;
                if (o.fee_absorbed) r.service_fee_absorbed_by_producer += fee;
                else r.service_fee_paid_by_buyers += fee;
            }
            const eventRefunds = refunds.filter((x) => Number(x.event_id) === l.event_id && x.status !== "cancelled");
            const refundedOrderIds = new Set(eventRefunds.map((x) => String(x.order_id)));
            r.refunds_to_buyers = eventRefunds.reduce((s, x) => s + Math.round(Number(x.ticket_amount) || 0), 0);
            // Reembolsos totales históricos sin fila en aitickets_refunds
            for (const o of orders.filter((o) => Number(o.event_id) === l.event_id && o.status === "refunded" && !refundedOrderIds.has(String(o.id)))) {
                r.refunds_to_buyers += Math.round(Number(o.amount) || 0);
            }
            r.producer_net = r.gross_ticket_sales - r.discounts - r.service_fee_absorbed_by_producer - r.refunds_to_buyers;
            return r;
        });
        const visible = rows.filter((r) => args.event_id || r.gross_ticket_sales > 0 || r.withdrawn > 0);
        const sum = (k: keyof (typeof rows)[number]) => visible.reduce((s, r) => s + (Number(r[k]) || 0), 0);
        return {
            currency: "CLP",
            generated_at: new Date().toISOString(),
            definitions: {
                gross_ticket_sales: "Valor de lista de las entradas vendidas (incluye órdenes luego reembolsadas).",
                service_fee_paid_by_buyers: "Cargo por servicio + IVA cobrado a los compradores (ingreso de AI Tickets, no del productor).",
                service_fee_absorbed_by_producer: "Cargo + IVA descontado al productor en eventos con fee_absorbed.",
                producer_net: "gross_ticket_sales − discounts − service_fee_absorbed_by_producer − refunds_to_buyers.",
                pending_payment: "producer_net − retirado (negativo = reembolsos posteriores a un retiro).",
            },
            events: visible,
            totals: {
                gross_ticket_sales: sum("gross_ticket_sales"),
                discounts: sum("discounts"),
                service_fee_paid_by_buyers: sum("service_fee_paid_by_buyers"),
                service_fee_absorbed_by_producer: sum("service_fee_absorbed_by_producer"),
                refunds_to_buyers: sum("refunds_to_buyers"),
                producer_net: sum("producer_net"),
                withdrawn: sum("withdrawn"),
                paid_out: sum("paid_out"),
                pending_payment: sum("pending_payment"),
            },
        };
    },
};

export const financeTools: ToolDef[] = [
    getPayoutAccount, createPayoutAccountLink, getVerificationStatus, removePayoutAccount,
    getFeeSchedule, quoteFees, setFeeAbsorption,
    getBalance, listBalanceTransactions, requestPayout, listPayouts, getPayout, cancelPayout, getSettlementReport,
];
