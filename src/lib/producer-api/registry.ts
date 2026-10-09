// Núcleo de la API de productores: definición de herramientas, validación de argumentos y ejecución.
// Las MISMAS herramientas se exponen por MCP (/api/mcp) y por REST (/api/v1/<herramienta>): una sola
// implementación, una sola fuente de verdad para permisos y validaciones.
import { createHash, randomBytes } from "node:crypto";
import type { ApiActor, ApiScope } from "./keys";
import { roleAllows, rolesWith, ROLE_LABELS, type Permission } from "./permissions";

export type JsonSchema = {
    type?: "object" | "string" | "integer" | "number" | "boolean" | "array";
    description?: string;
    properties?: Record<string, JsonSchema>;
    required?: string[];
    additionalProperties?: boolean;
    items?: JsonSchema;
    enum?: readonly (string | number)[];
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    minItems?: number;
    maxItems?: number;
    pattern?: string;
    format?: string;
    nullable?: boolean;
    default?: unknown;
};

export type ToolContext = {
    supabase: any;
    actor: ApiActor;
    /** Origen público del sitio (SITE_URL o el de la petición), sin "/" final. */
    origin: string;
    requestUrl: URL;
    channel: "mcp" | "rest";
    /** Resumen que el productor confirmó (solo en la segunda llamada de una herramienta con confirm). */
    confirmed?: ConfirmationSummary;
};

/** Resumen que se muestra al productor antes de ejecutar una acción que mueve plata o es pública. */
export type ConfirmationSummary = { message: string; details?: Record<string, unknown>; warnings?: string[] };

export type ToolDef = {
    name: string;
    title: string;
    description: string;
    scope: ApiScope;
    /** Permiso que exige al ROL del usuario. Por defecto se deriva del scope (ver DEFAULT_PERMISSION). */
    permission?: Permission;
    /**
     * Confirmación en el servidor: la primera llamada (sin confirmation_token) ejecuta `confirm`, que valida y
     * arma el resumen, y devuelve un token de un solo uso. La acción solo se ejecuta en una segunda llamada con
     * los MISMOS argumentos y ese token. Lo usan las acciones que mueven plata o son públicas.
     */
    confirm?: (args: any, ctx: ToolContext) => Promise<ConfirmationSummary>;
    /** Acepta idempotency_key: un reintento con la misma clave devuelve la misma respuesta sin repetir la acción. */
    idempotent?: boolean;
    /** Resumen sin datos personales para la bitácora (list_audit_log). */
    audit?: (args: any, result: Record<string, unknown>) => { summary?: string; target?: string };
    inputSchema: JsonSchema;
    /** Pistas MCP para que el cliente decida si pide confirmación. */
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
    handler: (args: any, ctx: ToolContext) => Promise<Record<string, unknown>>;
};

export const DEFAULT_PERMISSION: Record<ApiScope, Permission> = {
    read: "events.read",
    write: "events.write",
    publish: "events.publish",
    attendees: "attendees.read",
    finance: "finance.read",
    team: "team.read",
};

export const toolPermission = (tool: ToolDef): Permission => tool.permission || DEFAULT_PERMISSION[tool.scope];

export const CONFIRMATION_TTL_MINUTES = 15;

const CONFIRMATION_TOKEN_SCHEMA: JsonSchema = {
    type: "string",
    pattern: "^aitconf_[A-Za-z0-9_-]{20,80}$",
    description:
        "Token de la primera llamada (status = confirmation_required). Envíalo SOLO después de mostrar el resumen al productor y de que confirme explícitamente.",
};
const IDEMPOTENCY_KEY_SCHEMA: JsonSchema = {
    type: "string",
    minLength: 8,
    maxLength: 120,
    pattern: "^[A-Za-z0-9._:-]+$",
    description: "Clave única de esta operación (ej. un uuid). Si reintentas con la misma clave no se repite la acción: se devuelve la misma respuesta.",
};

const schemaCache = new WeakMap<ToolDef, JsonSchema>();
/** inputSchema + los argumentos de control (confirmation_token, idempotency_key) que agrega el registro. */
export function effectiveSchema(tool: ToolDef): JsonSchema {
    const cached = schemaCache.get(tool);
    if (cached) return cached;
    const extra: Record<string, JsonSchema> = {};
    if (tool.confirm) extra.confirmation_token = CONFIRMATION_TOKEN_SCHEMA;
    if (tool.confirm || tool.idempotent) extra.idempotency_key = IDEMPOTENCY_KEY_SCHEMA;
    const schema = Object.keys(extra).length ? { ...tool.inputSchema, properties: { ...(tool.inputSchema.properties || {}), ...extra } } : tool.inputSchema;
    schemaCache.set(tool, schema);
    return schema;
}

export type ToolErrorCode = "invalid_input" | "not_found" | "conflict" | "forbidden" | "unavailable" | "rate_limited" | "upstream" | "internal";

export class ToolError extends Error {
    code: ToolErrorCode;
    constructor(code: ToolErrorCode, message: string) {
        super(message);
        this.code = code;
    }
}

export const HTTP_STATUS: Record<ToolErrorCode, number> = {
    invalid_input: 400,
    forbidden: 403,
    not_found: 404,
    conflict: 409,
    rate_limited: 429,
    internal: 500,
    upstream: 502,
    unavailable: 503,
};

// ---------------------------------------------------------------------------
// Validación (subconjunto de JSON Schema que usan las herramientas)
// ---------------------------------------------------------------------------

/** Valida `value` contra `schema` y devuelve una copia con defaults aplicados. Lanza ToolError. */
export function validateArgs(schema: JsonSchema, value: unknown, path = "argumentos"): any {
    if (value === undefined && schema.default !== undefined) return schema.default;
    if (value === null && schema.nullable) return null;
    const fail = (msg: string): never => {
        throw new ToolError("invalid_input", `${path}: ${msg}`);
    };

    switch (schema.type) {
        case "object": {
            // Solo los argumentos raíz se completan con {}: un objeto anidado opcional ausente queda ausente
            if (value === undefined && path !== "argumentos") return undefined;
            if (value === undefined || value === null) value = {};
            if (typeof value !== "object" || Array.isArray(value)) fail("debe ser un objeto");
            const obj = value as Record<string, unknown>;
            const out: Record<string, unknown> = {};
            for (const req of schema.required || []) {
                if (obj[req] === undefined || obj[req] === null || obj[req] === "") fail(`falta "${req}"`);
            }
            const props = schema.properties || {};
            for (const key of Object.keys(obj)) {
                if (!props[key]) {
                    if (schema.additionalProperties === false) fail(`campo desconocido "${key}"`);
                    continue;
                }
            }
            for (const [key, sub] of Object.entries(props)) {
                const v = validateArgs(sub, obj[key], `${path}.${key}`);
                if (v !== undefined) out[key] = v;
            }
            return out;
        }
        case "array": {
            if (value === undefined) return undefined;
            if (!Array.isArray(value)) fail("debe ser una lista");
            const arr = value as unknown[];
            if (schema.minItems !== undefined && arr.length < schema.minItems) fail(`debe tener al menos ${schema.minItems} elemento(s)`);
            if (schema.maxItems !== undefined && arr.length > schema.maxItems) fail(`debe tener como máximo ${schema.maxItems} elementos`);
            return arr.map((item, i) => (schema.items ? validateArgs(schema.items, item, `${path}[${i}]`) : item));
        }
        case "string": {
            if (value === undefined) return undefined;
            if (typeof value !== "string") fail("debe ser texto");
            const s = (value as string).trim();
            if (schema.minLength !== undefined && s.length < schema.minLength) fail(`debe tener al menos ${schema.minLength} caracteres`);
            if (schema.maxLength !== undefined && s.length > schema.maxLength) fail(`debe tener como máximo ${schema.maxLength} caracteres`);
            if (schema.enum && !schema.enum.includes(s)) fail(`debe ser uno de: ${schema.enum.join(", ")}`);
            if (schema.pattern && !new RegExp(schema.pattern).test(s)) fail("formato inválido");
            if (schema.format === "date-time" && s && Number.isNaN(new Date(s).getTime())) fail("debe ser una fecha ISO 8601 válida");
            return s;
        }
        case "integer":
        case "number": {
            if (value === undefined) return undefined;
            const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
            if (typeof n !== "number" || !Number.isFinite(n)) fail("debe ser un número");
            if (schema.type === "integer" && !Number.isInteger(n)) fail("debe ser un número entero");
            if (schema.minimum !== undefined && (n as number) < schema.minimum) fail(`debe ser ≥ ${schema.minimum}`);
            if (schema.maximum !== undefined && (n as number) > schema.maximum) fail(`debe ser ≤ ${schema.maximum}`);
            if (schema.enum && !schema.enum.includes(n as number)) fail(`debe ser uno de: ${schema.enum.join(", ")}`);
            return n;
        }
        case "boolean": {
            if (value === undefined) return undefined;
            if (typeof value !== "boolean") fail("debe ser true o false");
            return value;
        }
        default:
            return value;
    }
}

/** Quita las extensiones propias (nullable) para publicar el schema como JSON Schema estándar. */
export function publicSchema(schema: JsonSchema): Record<string, unknown> {
    const { nullable, ...rest } = schema;
    const out: Record<string, unknown> = { ...rest };
    if (nullable && rest.type) out.type = [rest.type, "null"];
    if (rest.properties) out.properties = Object.fromEntries(Object.entries(rest.properties).map(([k, v]) => [k, publicSchema(v)]));
    if (rest.items) out.items = publicSchema(rest.items);
    return out;
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

export type ToolOutcome =
    | { ok: true; result: Record<string, unknown> }
    | { ok: false; code: ToolErrorCode; message: string };

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** JSON con claves ordenadas: el hash de los argumentos no depende del orden en que llegan. */
export function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${stableStringify((value as any)[k])}`).join(",")}}`;
    }
    return JSON.stringify(value ?? null);
}

const isMissingTable = (error: any) => ["42P01", "PGRST205", "42703", "PGRST204"].includes(String(error?.code || ""));

function checkAccess(tool: ToolDef, ctx: ToolContext) {
    if (!ctx.actor.scopes.includes(tool.scope)) {
        throw new ToolError(
            "forbidden",
            `Esta conexión no tiene el permiso "${tool.scope}" necesario para ${tool.name}. Vuelve a conectar AI Tickets marcando ese permiso o crea una llave con él en el panel (Conecta tu IA).`,
        );
    }
    const permission = toolPermission(tool);
    if (!roleAllows(ctx.actor.role, permission)) {
        const roles = rolesWith(permission).map((r) => ROLE_LABELS[r] || r).join(", ");
        throw new ToolError(
            "forbidden",
            `Tu rol (${ROLE_LABELS[ctx.actor.role] || ctx.actor.role}) no permite ${tool.name}. Pueden hacerlo: ${roles}. Pídele al dueño de la cuenta que cambie tu rol.`,
        );
    }
}

/** Primera llamada de una acción con confirmación: valida, arma el resumen y emite un token de un solo uso. */
async function requestConfirmation(tool: ToolDef, args: any, argsHash: string, ctx: ToolContext) {
    const summary = await tool.confirm!(args, ctx);
    const token = `aitconf_${randomBytes(24).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + CONFIRMATION_TTL_MINUTES * 60_000).toISOString();
    const { error } = await ctx.supabase.from("aitickets_api_confirmations").insert({
        token_hash: sha256(token),
        organization_id: ctx.actor.orgId,
        user_id: ctx.actor.userId,
        api_key_id: ctx.actor.keyId,
        tool: tool.name,
        args_hash: argsHash,
        summary,
        expires_at: expiresAt,
    });
    if (error) {
        if (isMissingTable(error)) throw new ToolError("unavailable", "Esta acción aún no está disponible. Intenta en unos minutos.");
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
            `NADA se ha ejecutado todavía. Muestra este resumen al productor y pregúntale si confirma. Solo si responde que sí, llama de nuevo a ${tool.name} ` +
            `con exactamente los mismos argumentos más confirmation_token. El token vence en ${CONFIRMATION_TTL_MINUTES} minutos y sirve una sola vez.`,
    };
}

/** Segunda llamada: consume el token (un solo uso, misma llave/usuario/herramienta/argumentos, vigente). */
async function consumeConfirmation(tool: ToolDef, token: string, argsHash: string, ctx: ToolContext): Promise<ConfirmationSummary | undefined> {
    const tokenHash = sha256(token);
    const now = new Date().toISOString();
    const { count, error } = await ctx.supabase
        .from("aitickets_api_confirmations")
        .update({ used_at: now }, { count: "exact" })
        .eq("token_hash", tokenHash)
        .eq("organization_id", ctx.actor.orgId)
        .eq("user_id", ctx.actor.userId)
        .eq("api_key_id", ctx.actor.keyId)
        .eq("tool", tool.name)
        .eq("args_hash", argsHash)
        .is("used_at", null)
        .gt("expires_at", now);
    if (error) throw error;
    if (count) {
        const { data } = await ctx.supabase.from("aitickets_api_confirmations").select("summary").eq("token_hash", tokenHash).maybeSingle();
        return (data?.summary as ConfirmationSummary) || undefined;
    }
    const { data: row } = await ctx.supabase
        .from("aitickets_api_confirmations")
        .select("tool, args_hash, used_at, expires_at, organization_id, user_id, api_key_id")
        .eq("token_hash", tokenHash)
        .maybeSingle();
    const again = `Llama a ${tool.name} sin confirmation_token para obtener un resumen nuevo y vuelve a confirmar con el productor.`;
    if (!row || Number(row.organization_id) !== ctx.actor.orgId || Number(row.user_id) !== ctx.actor.userId || row.tool !== tool.name || String(row.api_key_id) !== String(ctx.actor.keyId)) {
        throw new ToolError("invalid_input", `confirmation_token inválido para ${tool.name}. ${again}`);
    }
    if (row.used_at) throw new ToolError("conflict", `Este confirmation_token ya se usó. ${again}`);
    if (new Date(row.expires_at).getTime() <= Date.now()) throw new ToolError("conflict", `El confirmation_token venció. ${again}`);
    throw new ToolError("invalid_input", `Los argumentos no coinciden con los que se confirmaron. ${again}`);
}

type IdemClaim = { replay: Record<string, unknown> } | { id: number } | null;

async function claimIdempotency(tool: ToolDef, key: string, argsHash: string, ctx: ToolContext): Promise<IdemClaim> {
    const { data, error } = await ctx.supabase
        .from("aitickets_api_idempotency")
        .insert({ organization_id: ctx.actor.orgId, tool: tool.name, idem_key: key, args_hash: argsHash, status: "in_progress" })
        .select("id")
        .single();
    if (!error) return { id: Number(data.id) };
    if (isMissingTable(error)) {
        if (tool.confirm || tool.idempotent) throw new ToolError("unavailable", "Esta acción aún no está disponible. Intenta en unos minutos.");
        return null;
    }
    if (String(error.code) !== "23505") throw error;
    const { data: existing } = await ctx.supabase
        .from("aitickets_api_idempotency")
        .select("args_hash, status, response")
        .eq("organization_id", ctx.actor.orgId)
        .eq("tool", tool.name)
        .eq("idem_key", key)
        .maybeSingle();
    if (!existing) throw new ToolError("conflict", "La operación con esta clave de idempotencia está en curso. Intenta de nuevo en unos segundos.");
    if (existing.args_hash !== argsHash) throw new ToolError("conflict", "Esta idempotency_key ya se usó con otros argumentos. Usa una clave nueva para una operación distinta.");
    if (existing.status !== "done") throw new ToolError("conflict", "La operación con esta clave de idempotencia está en curso. Consulta su estado antes de reintentar.");
    return { replay: { ...(existing.response || {}), idempotent_replay: true } };
}

export async function runTool(tool: ToolDef, rawArgs: unknown, ctx: ToolContext): Promise<ToolOutcome> {
    let outcome: ToolOutcome;
    let eventId: number | null = null;
    const auditable = tool.annotations?.readOnlyHint !== true;
    let auditInfo: { summary?: string; target?: string } = {};
    try {
        checkAccess(tool, ctx);
        const { confirmation_token: confirmationToken, idempotency_key: idempotencyKey, ...args } = validateArgs(effectiveSchema(tool), rawArgs) || {};
        if (args && Number.isFinite(Number(args.event_id))) eventId = Number(args.event_id);
        const argsHash = sha256(`${tool.name}:${stableStringify(args)}`);

        if (tool.confirm && !confirmationToken) {
            // Nada cambió todavía: no va a la bitácora
            return { ok: true, result: await requestConfirmation(tool, args, argsHash, ctx) };
        }

        const idemKey: string | null = idempotencyKey || (confirmationToken ? `confirm:${sha256(confirmationToken)}` : null);
        const claim = idemKey ? await claimIdempotency(tool, idemKey, argsHash, ctx) : null;
        if (claim && "replay" in claim) return { ok: true, result: claim.replay };
        const releaseClaim = async () => {
            if (claim && "id" in claim) await ctx.supabase.from("aitickets_api_idempotency").delete().eq("id", claim.id);
        };
        let result: Record<string, unknown>;
        try {
            const confirmed = tool.confirm ? await consumeConfirmation(tool, confirmationToken, argsHash, ctx) : undefined;
            result = await tool.handler(args, confirmed ? { ...ctx, confirmed } : ctx);
        } catch (err) {
            await releaseClaim();
            throw err;
        }
        if (claim && "id" in claim) {
            const { error } = await ctx.supabase.from("aitickets_api_idempotency").update({ status: "done", response: result }).eq("id", claim.id);
            if (error) console.warn("api idempotency:", error.message);
        }
        if (!eventId && Number.isFinite(Number((result as any)?.event_id))) eventId = Number((result as any).event_id);
        try {
            auditInfo = tool.audit?.(args, result) || {};
        } catch {
            auditInfo = {};
        }
        outcome = { ok: true, result };
    } catch (err: any) {
        if (err instanceof ToolError) {
            outcome = { ok: false, code: err.code, message: err.message };
        } else {
            console.error(`API tool ${tool.name}:`, err?.message || err);
            outcome = { ok: false, code: "internal", message: "Error interno al ejecutar la acción. Intenta nuevamente." };
        }
    }
    if (auditable) await audit(ctx, tool.name, outcome, eventId, auditInfo);
    return outcome;
}

/** Bitácora de acciones de escritura. Nunca falla la petición. */
async function audit(ctx: ToolContext, tool: string, outcome: ToolOutcome, eventId: number | null, info: { summary?: string; target?: string } = {}) {
    try {
        const row: Record<string, unknown> = {
            organization_id: ctx.actor.orgId,
            api_key_id: ctx.actor.keyId,
            user_id: ctx.actor.userId,
            tool,
            channel: ctx.channel,
            ok: outcome.ok,
            error_code: outcome.ok ? null : outcome.code,
            event_id: eventId,
        };
        if (info.summary) row.summary = String(info.summary).slice(0, 300);
        if (info.target) row.target = String(info.target).slice(0, 120);
        let { error } = await ctx.supabase.from("aitickets_api_audit").insert(row);
        if (error && isMissingTable(error) && (row.summary || row.target)) {
            delete row.summary;
            delete row.target;
            ({ error } = await ctx.supabase.from("aitickets_api_audit").insert(row));
        }
        if (error) console.warn("api audit:", error.message);
    } catch (err: any) {
        console.warn("api audit:", err?.message);
    }
}
