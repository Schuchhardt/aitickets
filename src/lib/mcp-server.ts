// Servidor MCP (Model Context Protocol) genérico, sin estado, sobre Streamable HTTP: cada POST trae un mensaje
// JSON-RPC (o un lote) y se responde con JSON (sin SSE ni sesiones). Implementa initialize, ping, tools/*, prompts/*.
// Lo usan el MCP de productores (src/lib/producer-api/mcp.ts) y el de administración (src/lib/admin-api/mcp.ts):
// cada uno aporta sus herramientas, instrucciones y prompts.
// Spec: https://modelcontextprotocol.io/specification

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

type JsonRpcId = string | number | null;
type JsonRpcRequest = { jsonrpc: "2.0"; id?: JsonRpcId; method: string; params?: any };
export type JsonRpcResponse = { jsonrpc: "2.0"; id: JsonRpcId; result?: unknown; error?: { code: number; message: string; data?: unknown } };

export type McpPrompt = {
    name: string;
    title: string;
    description: string;
    arguments: Array<{ name: string; description: string; required: boolean }>;
    render: (args: Record<string, string>) => string;
};

/** Resultado de una herramienta: el mismo formato que devuelve runTool. null = herramienta desconocida. */
export type McpToolOutcome = { ok: true; result: Record<string, unknown> } | { ok: false; code: string; message: string };

export type McpServerSpec<C> = {
    serverInfo: Record<string, unknown>;
    instructions: string;
    prompts: McpPrompt[];
    /** Herramientas que ve este contexto (tools/list). */
    listTools: (ctx: C) => unknown[];
    callTool: (name: string, args: unknown, ctx: C) => Promise<McpToolOutcome | null>;
};

const rpcError = (id: JsonRpcId, code: number, message: string): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });
const rpcResult = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });

/** Lotes: se procesan como máximo estos mensajes por POST. */
export const MAX_BATCH = 20;

export function createMcpHandler<C>(spec: McpServerSpec<C>) {
    async function handleOne(msg: any, ctx: C): Promise<JsonRpcResponse | null> {
        // Respuestas del cliente a peticiones del servidor (este servidor no hace ninguna): se ignoran
        if (msg && typeof msg === "object" && msg.jsonrpc === "2.0" && msg.method === undefined && ("result" in msg || "error" in msg)) return null;
        if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
            return rpcError(msg?.id ?? null, -32600, "Invalid Request");
        }
        const req = msg as JsonRpcRequest;
        // Notificaciones (sin id): no llevan respuesta
        if (req.id === undefined) return null;
        const id = req.id ?? null;

        switch (req.method) {
            case "initialize": {
                const requested = String(req.params?.protocolVersion || "");
                return rpcResult(id, {
                    protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
                    capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
                    serverInfo: spec.serverInfo,
                    instructions: spec.instructions,
                });
            }
            case "ping":
                return rpcResult(id, {});
            case "tools/list":
                return rpcResult(id, { tools: spec.listTools(ctx) });
            case "tools/call": {
                const name = String(req.params?.name || "");
                const outcome = await spec.callTool(name, req.params?.arguments ?? {}, ctx);
                if (!outcome) return rpcError(id, -32602, `Herramienta desconocida: ${name}`);
                if (!outcome.ok) {
                    return rpcResult(id, { content: [{ type: "text", text: `Error (${outcome.code}): ${outcome.message}` }], isError: true });
                }
                return rpcResult(id, {
                    content: [{ type: "text", text: JSON.stringify(outcome.result, null, 2) }],
                    structuredContent: outcome.result,
                });
            }
            case "prompts/list":
                return rpcResult(id, { prompts: spec.prompts.map(({ render, ...p }) => p) });
            case "prompts/get": {
                const prompt = spec.prompts.find((p) => p.name === req.params?.name);
                if (!prompt) return rpcError(id, -32602, `Prompt desconocido: ${req.params?.name}`);
                const args = (req.params?.arguments || {}) as Record<string, string>;
                for (const a of prompt.arguments) if (a.required && !args[a.name]) return rpcError(id, -32602, `Falta el argumento ${a.name}`);
                return rpcResult(id, {
                    description: prompt.description,
                    messages: [{ role: "user", content: { type: "text", text: prompt.render(args) } }],
                });
            }
            case "resources/list":
                return rpcResult(id, { resources: [] });
            case "resources/templates/list":
                return rpcResult(id, { resourceTemplates: [] });
            default:
                return rpcError(id, -32601, `Método no soportado: ${req.method}`);
        }
    }

    /** Procesa el cuerpo de un POST MCP. Devuelve null si solo había notificaciones/respuestas (HTTP 202 sin cuerpo). */
    return async function handleMcpPayload(payload: unknown, ctx: C): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
        if (Array.isArray(payload)) {
            if (!payload.length) return rpcError(null, -32600, "Invalid Request");
            const out: JsonRpcResponse[] = [];
            for (const msg of payload.slice(0, MAX_BATCH)) {
                const r = await handleOne(msg, ctx);
                if (r) out.push(r);
            }
            return out.length ? out : null;
        }
        return handleOne(payload, ctx);
    };
}
