// Núcleo de la API de productores: definición de herramientas, validación de argumentos y ejecución.
// Las MISMAS herramientas se exponen por MCP (/api/mcp) y por REST (/api/v1/<herramienta>): una sola
// implementación, una sola fuente de verdad para permisos y validaciones.
import type { ApiActor, ApiScope } from "./keys";

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
};

export type ToolDef = {
    name: string;
    title: string;
    description: string;
    scope: ApiScope;
    inputSchema: JsonSchema;
    /** Pistas MCP para que el cliente decida si pide confirmación. */
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
    handler: (args: any, ctx: ToolContext) => Promise<Record<string, unknown>>;
};

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

export async function runTool(tool: ToolDef, rawArgs: unknown, ctx: ToolContext): Promise<ToolOutcome> {
    let outcome: ToolOutcome;
    let eventId: number | null = null;
    try {
        if (!ctx.actor.scopes.includes(tool.scope)) {
            throw new ToolError(
                "forbidden",
                `Esta llave no tiene el permiso "${tool.scope}" necesario para ${tool.name}. Crea una llave con ese permiso en el panel (Conecta tu IA).`,
            );
        }
        const args = validateArgs(tool.inputSchema, rawArgs);
        if (args && Number.isFinite(Number(args.event_id))) eventId = Number(args.event_id);
        const result = await tool.handler(args, ctx);
        if (!eventId && Number.isFinite(Number((result as any)?.event_id))) eventId = Number((result as any).event_id);
        outcome = { ok: true, result };
    } catch (err: any) {
        if (err instanceof ToolError) {
            outcome = { ok: false, code: err.code, message: err.message };
        } else {
            console.error(`API tool ${tool.name}:`, err?.message || err);
            outcome = { ok: false, code: "internal", message: "Error interno al ejecutar la acción. Intenta nuevamente." };
        }
    }
    if (tool.scope !== "read" && tool.scope !== "attendees") await audit(ctx, tool.name, outcome, eventId);
    return outcome;
}

/** Bitácora de acciones de escritura. Nunca falla la petición. */
async function audit(ctx: ToolContext, tool: string, outcome: ToolOutcome, eventId: number | null) {
    try {
        const { error } = await ctx.supabase.from("aitickets_api_audit").insert({
            organization_id: ctx.actor.orgId,
            api_key_id: ctx.actor.keyId,
            user_id: ctx.actor.userId,
            tool,
            channel: ctx.channel,
            ok: outcome.ok,
            error_code: outcome.ok ? null : outcome.code,
            event_id: eventId,
        });
        if (error) console.warn("api audit:", error.message);
    } catch (err: any) {
        console.warn("api audit:", err?.message);
    }
}
