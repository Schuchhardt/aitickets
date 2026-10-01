// Herramientas: códigos de descuento. Misma validación y reglas que /api/discount-codes (dashboard).
import { ToolError, type ToolDef, type ToolContext } from "../registry";
import { eventIdSchema, loadOwnedEvent } from "./common";
import { validateDiscountInput, describeDiscount, isMissingDiscountSchema, DISCOUNT_CODE_COLUMNS } from "../../../../netlify/lib/discounts.mjs";

const MAX_CODES_PER_ORG = 500;
const UNAVAILABLE = "Los códigos de descuento aún no están disponibles. Intenta nuevamente en unos minutos.";

async function statsFor(ctx: ToolContext, ids: string[]) {
    const map = new Map<string, any>();
    if (!ids.length) return map;
    const { data, error } = await ctx.supabase.rpc("aitickets_discount_code_stats", { p_code_ids: ids });
    if (error) return map;
    for (const r of data || []) map.set(String(r.code_id), r);
    return map;
}

function present(row: any, stats?: any) {
    const now = Date.now();
    const uses = Number(stats?.uses) || 0;
    let state = "active";
    if (row.active === false) state = "inactive";
    else if (row.ends_at && new Date(row.ends_at).getTime() <= now) state = "expired";
    else if (row.starts_at && new Date(row.starts_at).getTime() > now) state = "scheduled";
    else if (row.max_uses != null && uses >= row.max_uses) state = "exhausted";
    return {
        id: row.id,
        code: row.code,
        kind: row.kind,
        value: Number(row.value),
        label: describeDiscount({ kind: row.kind, value: row.value }),
        event_id: row.event_id != null ? Number(row.event_id) : null,
        applies_to: row.event_id != null ? "event" : "all_events",
        max_uses: row.max_uses ?? null,
        per_buyer_limit: row.per_buyer_limit ?? null,
        starts_at: row.starts_at ?? null,
        ends_at: row.ends_at ?? null,
        state,
        uses,
        paid_orders: Number(stats?.paid_orders) || 0,
        discount_given_clp: Number(stats?.discount_total) || 0,
        revenue_clp: Number(stats?.revenue) || 0,
    };
}

const listCodes: ToolDef = {
    name: "list_discount_codes",
    title: "Listar códigos de descuento",
    description:
        "Códigos de descuento de la organización con su estado y rendimiento (usos, órdenes pagadas, descuento otorgado, ingresos). " +
        "Con event_id: los del evento + los que aplican a todos los eventos.",
    scope: "read",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", additionalProperties: false, properties: { event_id: eventIdSchema } },
    async handler(args, ctx) {
        if (args.event_id) await loadOwnedEvent(ctx, args.event_id, "id");
        const { data, error } = await ctx.supabase
            .from("aitickets_discount_codes")
            .select(DISCOUNT_CODE_COLUMNS)
            .eq("organization_id", ctx.actor.orgId)
            .order("created_at", { ascending: false })
            .limit(MAX_CODES_PER_ORG);
        if (error) {
            if (isMissingDiscountSchema(error)) throw new ToolError("unavailable", UNAVAILABLE);
            throw error;
        }
        const rows = (data || []).filter((r: any) => !args.event_id || r.event_id == null || Number(r.event_id) === args.event_id);
        const stats = await statsFor(ctx, rows.map((r: any) => String(r.id)));
        return { count: rows.length, codes: rows.map((r: any) => present(r, stats.get(String(r.id)))) };
    },
};

const createCode: ToolDef = {
    name: "create_discount_code",
    title: "Crear código de descuento",
    description:
        "Crea un código de descuento (porcentaje o monto fijo en CLP) para un evento o para todos los eventos de la organización. " +
        "Útil para preventas, promotores, influencers o campañas. El código queda activo de inmediato (salvo que starts_at sea futuro).",
    scope: "write",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
        type: "object",
        required: ["code", "kind", "value"],
        additionalProperties: false,
        properties: {
            code: { type: "string", minLength: 3, maxLength: 30, pattern: "^[A-Za-z0-9_-]+$", description: "Se guarda en MAYÚSCULAS. Ej: PREVENTA20." },
            kind: { type: "string", enum: ["percent", "fixed"], description: "percent = % sobre las entradas; fixed = monto CLP." },
            value: { type: "number", minimum: 1, maximum: 10_000_000, description: "1-100 si percent; pesos enteros si fixed." },
            event_id: { ...eventIdSchema, description: "Omitir = aplica a todos los eventos de la organización." },
            max_uses: { type: "integer", minimum: 1, maximum: 1_000_000, nullable: true, description: "Usos totales. Omitir = sin límite." },
            per_buyer_limit: { type: "integer", minimum: 1, maximum: 1_000_000, nullable: true },
            starts_at: { type: "string", format: "date-time", nullable: true },
            ends_at: { type: "string", format: "date-time", nullable: true },
        },
    },
    async handler(args, ctx) {
        const parsed: any = validateDiscountInput({
            code: args.code, kind: args.kind, value: args.value, eventId: args.event_id ?? null,
            maxUses: args.max_uses ?? null, perBuyerLimit: args.per_buyer_limit ?? null,
            startsAt: args.starts_at ?? null, endsAt: args.ends_at ?? null, active: true,
        });
        if ("error" in parsed) throw new ToolError("invalid_input", parsed.error);
        const values = parsed.values;
        if (values.event_id != null) await loadOwnedEvent(ctx, values.event_id, "id");

        const { count, error: countError } = await ctx.supabase
            .from("aitickets_discount_codes")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", ctx.actor.orgId);
        if (countError && isMissingDiscountSchema(countError)) throw new ToolError("unavailable", UNAVAILABLE);
        if ((count || 0) >= MAX_CODES_PER_ORG) throw new ToolError("conflict", `Alcanzaste el máximo de ${MAX_CODES_PER_ORG} códigos. Desactiva alguno.`);

        const { data, error } = await ctx.supabase
            .from("aitickets_discount_codes")
            .insert([{ ...values, organization_id: ctx.actor.orgId, created_by: ctx.actor.userId }])
            .select(DISCOUNT_CODE_COLUMNS)
            .single();
        if (error) {
            if (String(error.code) === "23505") throw new ToolError("conflict", `Ya existe el código ${values.code} en tu organización.`);
            if (isMissingDiscountSchema(error)) throw new ToolError("unavailable", UNAVAILABLE);
            throw error;
        }
        return { code: present(data) };
    },
};

const updateCode: ToolDef = {
    name: "update_discount_code",
    title: "Editar código de descuento",
    description:
        "Activa/desactiva un código o cambia sus límites y vigencia. El código, tipo, valor y evento NO se editan " +
        "(las órdenes ya emitidas los referencian): para eso desactívalo y crea otro.",
    scope: "write",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
        type: "object",
        required: ["id"],
        additionalProperties: false,
        properties: {
            id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$", description: "ID del código (list_discount_codes)." },
            active: { type: "boolean" },
            max_uses: { type: "integer", minimum: 1, maximum: 1_000_000, nullable: true },
            per_buyer_limit: { type: "integer", minimum: 1, maximum: 1_000_000, nullable: true },
            starts_at: { type: "string", format: "date-time", nullable: true },
            ends_at: { type: "string", format: "date-time", nullable: true },
        },
    },
    async handler(args, ctx) {
        const map: Record<string, string> = { active: "active", max_uses: "maxUses", per_buyer_limit: "perBuyerLimit", starts_at: "startsAt", ends_at: "endsAt" };
        const body = Object.fromEntries(Object.entries(map).filter(([k]) => args[k] !== undefined).map(([k, v]) => [v, args[k]]));
        if (!Object.keys(body).length) throw new ToolError("invalid_input", "No enviaste cambios.");
        const parsed: any = validateDiscountInput(body, { partial: true });
        if ("error" in parsed) throw new ToolError("invalid_input", parsed.error);
        const values = parsed.values;

        const { data: existing, error: loadError } = await ctx.supabase
            .from("aitickets_discount_codes")
            .select(DISCOUNT_CODE_COLUMNS)
            .eq("id", args.id)
            .eq("organization_id", ctx.actor.orgId)
            .maybeSingle();
        if (loadError && isMissingDiscountSchema(loadError)) throw new ToolError("unavailable", UNAVAILABLE);
        if (!existing) throw new ToolError("not_found", "Código no encontrado en tu organización.");

        const startsAt = values.starts_at !== undefined ? values.starts_at : existing.starts_at;
        const endsAt = values.ends_at !== undefined ? values.ends_at : existing.ends_at;
        if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
            throw new ToolError("invalid_input", "La fecha de término debe ser posterior a la de inicio.");
        }

        const { data, error } = await ctx.supabase
            .from("aitickets_discount_codes")
            .update({ ...values, updated_at: new Date().toISOString() })
            .eq("id", args.id)
            .eq("organization_id", ctx.actor.orgId)
            .select(DISCOUNT_CODE_COLUMNS)
            .maybeSingle();
        if (error || !data) throw error || new ToolError("internal", "No se pudo actualizar el código.");
        const stats = await statsFor(ctx, [String(data.id)]);
        return { code: present(data, stats.get(String(data.id))) };
    },
};

export const discountTools: ToolDef[] = [listCodes, createCode, updateCode];
