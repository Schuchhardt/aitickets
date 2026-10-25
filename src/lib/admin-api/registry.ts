// Registro de herramientas del MCP de administración: validación, motivo obligatorio en escrituras, confirmación
// en dos pasos, idempotencia y bitácora (aitickets_admin_audit) de TODA llamada, también las lecturas.
// Reutiliza el validador y los tipos de la API de productores (src/lib/producer-api/registry.ts).
import { createHash, randomBytes } from "node:crypto";
import {
    stableStringify,
    ToolError,
    validateArgs,
    CONFIRMATION_TTL_MINUTES,
    type ConfirmationSummary,
    type JsonSchema,
    type ToolErrorCode,
    type ToolOutcome,
} from "../producer-api/registry";
import type { AdminContext } from "./context";

export type AdminToolDef = {
    name: string;
    title: string;
    description: string;
    /** true = solo lectura. false = escritura: exige la llave completa y `reason`. */
    readOnly: boolean;
    /** Lectura que expone datos sensibles (p. ej. datos bancarios completos): exige la llave completa. */
    sensitive?: boolean;
    inputSchema: JsonSchema;
    annotations?: { destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
    /**
     * Confirmación en el servidor (como la API de productores): la primera llamada arma el resumen y devuelve un
     * token de un solo uso; la acción se ejecuta al repetir la llamada con los MISMOS argumentos y el token.
     * null = esta llamada no necesita confirmación.
     */
    confirm?: (args: any, actx: AdminContext) => Promise<ConfirmationSummary | null>;
    /** Acepta idempotency_key. */
    idempotent?: boolean;
    /**
     * Herramientas org_* (mirror.ts): la confirmación y la idempotencia las hace el registro de productores con el
     * contexto de la organización, así que aquí no se agregan ni se quitan esos argumentos.
     */
    delegated?: boolean;
    /** Resumen sin datos personales para la bitácora. */
    audit?: (args: any, result: Record<string, unknown>) => { summary?: string; target?: string; organization_id?: number | null; event_id?: number | null };
    handler: (args: any, actx: AdminContext) => Promise<Record<string, unknown>>;
};

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export const REASON_SCHEMA: JsonSchema = {
    type: "string",
    minLength: 5,
    maxLength: 300,
    description: "Motivo (obligatorio en escrituras): qué pidió quién y por dónde. Ej: \"Productor pidió cambiar la hora por WhatsApp, 23-10\".",
};
const CONFIRMATION_TOKEN_SCHEMA: JsonSchema = {
    type: "string",
    pattern: "^aitadmc_[A-Za-z0-9_-]{20,80}$",
    description: "Token de la primera llamada (status = confirmation_required). Envíalo SOLO después de mostrar el resumen y de que el dueño confirme.",
};
const IDEMPOTENCY_KEY_SCHEMA: JsonSchema = {
    type: "string",
    minLength: 8,
    maxLength: 120,
    pattern: "^[A-Za-z0-9._:-]+$",
    description: "Clave única de esta operación (ej. un uuid). Un reintento con la misma clave devuelve la misma respuesta sin repetir la acción.",
};

const schemaCache = new WeakMap<AdminToolDef, JsonSchema>();
/** inputSchema + los argumentos de control que agrega el registro (reason, confirmation_token, idempotency_key). */
export function adminEffectiveSchema(tool: AdminToolDef): JsonSchema {
    const cached = schemaCache.get(tool);
    if (cached) return cached;
    const extra: Record<string, JsonSchema> = {};
    const required = [...(tool.inputSchema.required || [])];
    if (!tool.readOnly && !tool.inputSchema.properties?.reason) {
        extra.reason = REASON_SCHEMA;
        required.push("reason");
    }
    if (!tool.delegated) {
        if (tool.confirm) extra.confirmation_token = CONFIRMATION_TOKEN_SCHEMA;
        if (tool.confirm || tool.idempotent) extra.idempotency_key = IDEMPOTENCY_KEY_SCHEMA;
    }
    const schema = Object.keys(extra).length
        ? { ...tool.inputSchema, properties: { ...(tool.inputSchema.properties || {}), ...extra }, required }
        : tool.inputSchema;
    schemaCache.set(tool, schema);
    return schema;
}

/** ¿La llave puede ver/usar esta herramienta? La de solo lectura no ve escrituras ni lecturas sensibles. */
export const keyAllows = (tool: AdminToolDef, keyKind: AdminContext["keyKind"]) => keyKind === "full" || (tool.readOnly && !tool.sensitive);

const isMissingTable = (error: any) => ["42P01", "PGRST205", "42703", "PGRST204"].includes(String(error?.code || ""));

/**
 * Resultado de una RPC de operación (aitickets_set_payout_status…): sus RAISE EXCEPTION (P0001) traen un mensaje
 * escrito para quien opera y se devuelven tal cual como conflict.
 */
export function rpcResult<T = any>({ data, error }: { data: T; error: any }): T {
    if (error) {
        if (String(error.code) === "P0001") throw new ToolError("conflict", String(error.message || "La operación no se pudo completar."));
        if (["42883", "PGRST202"].includes(String(error.code || ""))) {
            throw new ToolError("unavailable", "Esta operación aún no está disponible en la base (falta una migración). Intenta después del próximo deploy.");
        }
        throw error;
    }
    return data;
}

// ---------------------------------------------------------------------------
// Confirmación e idempotencia (tablas propias del admin: no dependen de una organización)
// ---------------------------------------------------------------------------

async function requestConfirmation(tool: AdminToolDef, summary: ConfirmationSummary, argsHash: string, actx: AdminContext) {
    const token = `aitadmc_${randomBytes(24).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + CONFIRMATION_TTL_MINUTES * 60_000).toISOString();
    const { error } = await actx.supabase.from("aitickets_admin_confirmations").insert({
        token_hash: sha256(token),
        tool: tool.name,
        args_hash: argsHash,
        key_fingerprint: actx.fingerprint,
        summary,
        expires_at: expiresAt,
    });
    if (error) {
        if (isMissingTable(error)) throw new ToolError("unavailable", "Esta acción aún no está disponible (falta la migración del MCP de admin).");
        throw error;
    }
    return {
        status: "confirmation_required",
        action: tool.name,
        summary: summary.message,
        ...(summary.details ? { details: summary.details } : {}),
        ...(summary.warnings?.length ? { warnings: summary.warnings } : {}),
        confirmation_token: token,
        expires_at: expiresAt,
        next_step:
            `NADA se ha ejecutado todavía. Muestra este resumen al dueño de la plataforma y pregúntale si confirma. Solo si responde que sí, llama de nuevo a ${tool.name} ` +
            `con exactamente los mismos argumentos más confirmation_token. El token vence en ${CONFIRMATION_TTL_MINUTES} minutos y sirve una sola vez.`,
    };
}

async function consumeConfirmation(tool: AdminToolDef, token: string, argsHash: string, actx: AdminContext): Promise<ConfirmationSummary | undefined> {
    const tokenHash = sha256(token);
    const now = new Date().toISOString();
    const { count, error } = await actx.supabase
        .from("aitickets_admin_confirmations")
        .update({ used_at: now }, { count: "exact" })
        .eq("token_hash", tokenHash)
        .eq("tool", tool.name)
        .eq("args_hash", argsHash)
        .eq("key_fingerprint", actx.fingerprint)
        .is("used_at", null)
        .gt("expires_at", now);
    if (error) throw error;
    if (count) {
        const { data } = await actx.supabase.from("aitickets_admin_confirmations").select("summary").eq("token_hash", tokenHash).maybeSingle();
        return (data?.summary as ConfirmationSummary) || undefined;
    }
    const { data: row } = await actx.supabase
        .from("aitickets_admin_confirmations")
        .select("tool, args_hash, used_at, expires_at, key_fingerprint")
        .eq("token_hash", tokenHash)
        .maybeSingle();
    const again = `Llama a ${tool.name} sin confirmation_token para obtener un resumen nuevo y vuelve a confirmar.`;
    if (!row || row.tool !== tool.name || row.key_fingerprint !== actx.fingerprint) throw new ToolError("invalid_input", `confirmation_token inválido para ${tool.name}. ${again}`);
    if (row.used_at) throw new ToolError("conflict", `Este confirmation_token ya se usó. ${again}`);
    if (new Date(row.expires_at).getTime() <= Date.now()) throw new ToolError("conflict", `El confirmation_token venció. ${again}`);
    throw new ToolError("invalid_input", `Los argumentos no coinciden con los que se confirmaron. ${again}`);
}

type IdemClaim = { replay: Record<string, unknown> } | { id: number } | null;

async function claimIdempotency(tool: AdminToolDef, key: string, argsHash: string, actx: AdminContext): Promise<IdemClaim> {
    const { data, error } = await actx.supabase
        .from("aitickets_admin_idempotency")
        .insert({ tool: tool.name, idem_key: key, args_hash: argsHash, status: "in_progress" })
        .select("id")
        .single();
    if (!error) return { id: Number(data.id) };
    if (isMissingTable(error)) throw new ToolError("unavailable", "Esta acción aún no está disponible (falta la migración del MCP de admin).");
    if (String(error.code) !== "23505") throw error;
    const { data: existing } = await actx.supabase
        .from("aitickets_admin_idempotency")
        .select("args_hash, status, response")
        .eq("tool", tool.name)
        .eq("idem_key", key)
        .maybeSingle();
    if (!existing || existing.status !== "done") throw new ToolError("conflict", "La operación con esta clave de idempotencia está en curso. Consulta su estado antes de reintentar.");
    if (existing.args_hash !== argsHash) throw new ToolError("conflict", "Esta idempotency_key ya se usó con otros argumentos. Usa una clave nueva.");
    return { replay: { ...(existing.response || {}), idempotent_replay: true, replay_note: "Repetición con la misma idempotency_key: no se repitió la acción." } };
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

const positiveInt = (v: unknown) => {
    const n = Number(v);
    return v != null && v !== "" && Number.isInteger(n) && n > 0 ? n : null;
};

/** Objetivo por defecto para la bitácora: el primer id conocido de los argumentos. */
function defaultTarget(args: Record<string, unknown> | undefined): string | undefined {
    for (const key of ["payout_id", "refund_id", "order_id", "review_id", "photo_id", "ticket_type_id", "user_id", "member_id", "discount_id", "event_id", "organization_id"]) {
        const v = args?.[key];
        if (v != null && v !== "") return `${key.replace(/_id$/, "")}:${v}`;
    }
    return undefined;
}

export async function runAdminTool(tool: AdminToolDef, rawArgs: unknown, actx: AdminContext): Promise<ToolOutcome> {
    const started = Date.now();
    let outcome: ToolOutcome;
    let parsed: Record<string, unknown> | undefined;
    let reason: string | null = null;
    let argsHash: string | null = null;
    let info: ReturnType<NonNullable<AdminToolDef["audit"]>> = {};
    try {
        if (!keyAllows(tool, actx.keyKind)) {
            throw new ToolError("forbidden", `Esta llave es de solo lectura: ${tool.name} necesita la llave completa del MCP de admin.`);
        }
        const all = validateArgs(adminEffectiveSchema(tool), rawArgs) || {};
        const { reason: givenReason, ...rest } = all;
        reason = typeof givenReason === "string" ? givenReason : null;
        let confirmationToken: string | undefined;
        let idempotencyKey: string | undefined;
        if (tool.delegated) {
            parsed = rest;
        } else {
            const { confirmation_token, idempotency_key, ...args } = rest;
            confirmationToken = confirmation_token as string | undefined;
            idempotencyKey = idempotency_key as string | undefined;
            parsed = args;
        }
        argsHash = sha256(`${tool.name}:${stableStringify(parsed)}`);

        if (tool.confirm && !confirmationToken) {
            const summary = await tool.confirm(parsed, actx);
            if (summary) {
                outcome = { ok: true, result: await requestConfirmation(tool, summary, argsHash, actx) };
                info = { summary: `${tool.title}: confirmación solicitada` };
                return outcome;
            }
        }

        const idemKey = idempotencyKey || (confirmationToken ? `confirm:${sha256(confirmationToken)}` : null);
        const claim = idemKey ? await claimIdempotency(tool, idemKey, argsHash, actx) : null;
        if (claim && "replay" in claim) {
            outcome = { ok: true, result: claim.replay };
            info = { summary: `${tool.title}: repetición idempotente` };
            return outcome;
        }
        let result: Record<string, unknown>;
        try {
            const confirmed = tool.confirm && confirmationToken ? await consumeConfirmation(tool, confirmationToken, argsHash, actx) : undefined;
            result = await tool.handler(parsed, confirmed ? { ...actx, confirmed } : actx);
        } catch (err) {
            if (claim && "id" in claim) await actx.supabase.from("aitickets_admin_idempotency").delete().eq("id", claim.id);
            throw err;
        }
        if (claim && "id" in claim) {
            const { error } = await actx.supabase.from("aitickets_admin_idempotency").update({ status: "done", response: result }).eq("id", claim.id);
            if (error) console.warn("admin idempotency:", error.message);
        }
        try {
            info = tool.audit?.(parsed, result) || {};
        } catch {
            info = {};
        }
        outcome = { ok: true, result };
    } catch (err: any) {
        if (err instanceof ToolError) {
            outcome = { ok: false, code: err.code, message: err.message };
        } else {
            console.error(`admin tool ${tool.name}:`, err?.message || err);
            outcome = { ok: false, code: "internal" as ToolErrorCode, message: "Error interno al ejecutar la acción. Intenta nuevamente." };
        }
    } finally {
        // La bitácora corre siempre (también en los return anticipados de confirmación e idempotencia)
        await auditAdminCall(actx, tool, () => outcome, { parsed, rawArgs, reason, argsHash, info: () => info, started });
    }
    return outcome;
}

/** Bitácora de toda llamada. Nunca falla la petición. */
async function auditAdminCall(
    actx: AdminContext,
    tool: AdminToolDef,
    getOutcome: () => ToolOutcome | undefined,
    meta: { parsed?: Record<string, unknown>; rawArgs: unknown; reason: string | null; argsHash: string | null; info: () => ReturnType<NonNullable<AdminToolDef["audit"]>>; started: number },
) {
    try {
        const outcome = getOutcome();
        if (!outcome) return;
        const info = meta.info() || {};
        const source = meta.parsed || (meta.rawArgs && typeof meta.rawArgs === "object" ? (meta.rawArgs as Record<string, unknown>) : undefined);
        const row: Record<string, unknown> = {
            tool: tool.name,
            key_kind: actx.keyKind,
            key_fingerprint: actx.fingerprint,
            read_only: tool.readOnly,
            ok: outcome.ok,
            error_code: outcome.ok ? null : outcome.code,
            organization_id: positiveInt(info.organization_id ?? source?.organization_id),
            event_id: positiveInt(info.event_id ?? source?.event_id ?? (outcome.ok ? (outcome.result as any)?.event_id : null)),
            target: String(info.target || defaultTarget(source) || "").slice(0, 120) || null,
            reason: meta.reason ? meta.reason.slice(0, 300) : null,
            summary: String(info.summary || (outcome.ok ? tool.title : `${tool.title}: rechazado (${outcome.code})`)).slice(0, 300),
            args_hash: meta.argsHash,
            ip_hash: actx.ipHash,
            duration_ms: Date.now() - meta.started,
        };
        let { error } = await actx.supabase.from("aitickets_admin_audit").insert(row);
        // organization_id inexistente (FK): se registra igual, sin la organización
        if (error && String(error.code) === "23503") {
            row.organization_id = null;
            ({ error } = await actx.supabase.from("aitickets_admin_audit").insert(row));
        }
        if (error && !isMissingTable(error)) console.warn("admin audit:", error.message);
    } catch (err: any) {
        console.warn("admin audit:", err?.message || err);
    }
}
