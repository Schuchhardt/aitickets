// Servidor MCP (Model Context Protocol) sin estado sobre Streamable HTTP: cada POST trae un mensaje JSON-RPC
// (o un lote) y se responde con JSON (sin SSE ni sesiones). Implementa initialize, ping, tools/*, prompts/*.
// Spec: https://modelcontextprotocol.io/specification
import { TOOLS, getTool } from "./tools";
import { publicSchema, runTool, type ToolContext } from "./registry";

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const SERVER_INFO = { name: "aitickets", title: "AI Tickets", version: "1.0.0", websiteUrl: "https://aitickets.cl" };

export const SERVER_INSTRUCTIONS = `Eres el asistente de un productor de eventos en AI Tickets (ticketera chilena).
Con estas herramientas puedes crear y gestionar eventos, entradas y códigos de descuento, analizar ventas y crear piezas de marketing.

Reglas:
- Montos en CLP (pesos chilenos, enteros). Fechas/horas de funciones en hora de Chile (America/Santiago).
- Empieza con get_account para conocer la organización y los permisos de la llave. Usa list_events para obtener IDs.
- create_event deja el evento en BORRADOR. Publicar (set_event_status) y publicar en redes (publish_social_post) son acciones públicas: muestra un resumen y pide confirmación explícita antes.
- Borradores: su link público NO funciona (public_url = null, is_published = false). Para que el productor (o un socio/artista) vea la página sin publicarla, entrega el preview_url de create_event o crea uno con create_preview_link (privado, no indexado; por defecto 7 días; configurable con expires_in_hours, no_expiration=true o single_use=true). La página muestra "Vista previa · Evento NO publicado". Dile siempre al productor si el evento está publicado o en borrador.
- Para "¿cómo va mi evento?" usa get_event_performance y responde con diagnóstico + 2-3 acciones concretas (p. ej. código de descuento con fecha límite, reforzar el canal que más convierte, nueva preventa).
- Para marketing: get_marketing_kit → redacta tú el copy → imagen con upload_image o generate_image → create_social_post (borrador) → confirmación → publish_social_post. Usa create_tracking_link para medir cada canal.
- Imágenes: si el productor comparte una imagen por URL (flyer, logo, foto), súbela con upload_image (image_url); si la adjuntó en el chat sin URL pública, usa image_base64. Para crear una pieza nueva usa generate_image con prompt; para mantener su identidad visual pasa reference_image_urls (hasta 4, incluidas URLs de upload_image) o use_event_cover_as_reference=true; para adaptar/editar una referencia (p. ej. el flyer a formato story) dilo en prompt. set_as_cover=true la deja como portada. Muéstrala al productor antes de usarla en un post.
- list_orders entrega datos personales de compradores: úsalos solo para gestionar el evento y no los repitas innecesariamente.
- No inventes datos (artistas, precios, horarios): si falta información, pregúntala.`;

type JsonRpcId = string | number | null;
type JsonRpcRequest = { jsonrpc: "2.0"; id?: JsonRpcId; method: string; params?: any };
type JsonRpcResponse = { jsonrpc: "2.0"; id: JsonRpcId; result?: unknown; error?: { code: number; message: string; data?: unknown } };

const rpcError = (id: JsonRpcId, code: number, message: string): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });
const rpcResult = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });

// ---------------------------------------------------------------------------
// Prompts (atajos que el cliente muestra como comandos, p. ej. "/aitickets:reporte")
// ---------------------------------------------------------------------------

const PROMPTS = [
    {
        name: "lanzar_evento",
        title: "Lanzar un evento",
        description: "Guía para crear un evento completo (borrador → revisión → publicación → campaña).",
        arguments: [{ name: "descripcion", description: "Lo que sabes del evento: nombre, fecha, lugar, precios, artistas…", required: true }],
        render: (a: Record<string, string>) =>
            `Quiero lanzar este evento en AI Tickets:\n\n${a.descripcion || ""}\n\n` +
            "1) Revisa mis lugares con list_venues. 2) Si falta información clave (fecha, hora, lugar, tipos de entrada y precios), pregúntamela. " +
            "3) Crea el evento con create_event (queda en borrador) y muéstrame un resumen con el link de vista previa (preview_url). " +
            "4) Propón una imagen de portada (generate_image o upload_image) y un código de preventa. 5) Pregúntame antes de publicar.",
    },
    {
        name: "reporte_de_ventas",
        title: "Reporte de ventas",
        description: "Diagnóstico de cómo va un evento y recomendaciones accionables.",
        arguments: [{ name: "evento", description: "Nombre o ID del evento (vacío = el próximo).", required: false }],
        render: (a: Record<string, string>) =>
            `Hazme un reporte de cómo va ${a.evento ? `el evento "${a.evento}"` : "mi próximo evento"}. ` +
            "Usa list_events para identificarlo y get_event_performance para los datos. Incluye: ventas e ingresos, % de capacidad, ritmo de los últimos 7 días, " +
            "conversión, canales que más venden y 3 acciones concretas priorizadas para vender más (con lo que puedes ejecutar tú mismo).",
    },
    {
        name: "campana_redes",
        title: "Campaña en redes",
        description: "Crea una mini campaña para Instagram/Facebook de un evento.",
        arguments: [
            { name: "evento", description: "Nombre o ID del evento.", required: true },
            { name: "objetivo", description: "Ej: vender la preventa, último aviso, lanzar line-up.", required: false },
        ],
        render: (a: Record<string, string>) =>
            `Crea una campaña de 3 posts para "${a.evento}"${a.objetivo ? ` con el objetivo: ${a.objetivo}` : ""}. ` +
            "Usa get_marketing_kit, propone copies distintos (anuncio, prueba social/urgencia, último llamado), genera o sube imágenes, " +
            "créalos como borradores con create_social_post usando links con create_tracking_link, y muéstramelos antes de publicar nada.",
    },
];

// ---------------------------------------------------------------------------
// Despacho
// ---------------------------------------------------------------------------

export function toolsListPayload(scopes: string[]) {
    return {
        tools: TOOLS.map((t) => ({
            name: t.name,
            title: t.title,
            description: scopes.includes(t.scope) ? t.description : `${t.description} (Requiere el permiso "${t.scope}", que esta llave no tiene.)`,
            inputSchema: publicSchema(t.inputSchema),
            annotations: { title: t.title, ...(t.annotations || {}) },
        })),
    };
}

async function handleOne(msg: any, ctx: ToolContext): Promise<JsonRpcResponse | null> {
    // Respuestas del cliente a peticiones del servidor (este servidor no hace ninguna): se ignoran
    if (msg && typeof msg === "object" && msg.jsonrpc === "2.0" && msg.method === undefined && ("result" in msg || "error" in msg)) return null;
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
        return rpcError(msg?.id ?? null, -32600, "Invalid Request");
    }
    const req = msg as JsonRpcRequest;
    const isNotification = req.id === undefined;
    const id = req.id ?? null;

    // Notificaciones (sin id): no llevan respuesta
    if (isNotification) return null;

    switch (req.method) {
        case "initialize": {
            const requested = String(req.params?.protocolVersion || "");
            return rpcResult(id, {
                protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
                capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
                serverInfo: SERVER_INFO,
                instructions: SERVER_INSTRUCTIONS,
            });
        }
        case "ping":
            return rpcResult(id, {});
        case "tools/list":
            return rpcResult(id, toolsListPayload(ctx.actor.scopes));
        case "tools/call": {
            const name = String(req.params?.name || "");
            const tool = getTool(name);
            if (!tool) return rpcError(id, -32602, `Herramienta desconocida: ${name}`);
            const outcome = await runTool(tool, req.params?.arguments ?? {}, ctx);
            if (!outcome.ok) {
                return rpcResult(id, { content: [{ type: "text", text: `Error (${outcome.code}): ${outcome.message}` }], isError: true });
            }
            return rpcResult(id, {
                content: [{ type: "text", text: JSON.stringify(outcome.result, null, 2) }],
                structuredContent: outcome.result,
            });
        }
        case "prompts/list":
            return rpcResult(id, { prompts: PROMPTS.map(({ render, ...p }) => p) });
        case "prompts/get": {
            const prompt = PROMPTS.find((p) => p.name === req.params?.name);
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

/**
 * Procesa el cuerpo de un POST MCP. Devuelve null si solo había notificaciones/respuestas (HTTP 202 sin cuerpo).
 */
export async function handleMcpPayload(payload: unknown, ctx: ToolContext): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
    if (Array.isArray(payload)) {
        if (!payload.length) return rpcError(null, -32600, "Invalid Request");
        const out: JsonRpcResponse[] = [];
        for (const msg of payload.slice(0, 20)) {
            const r = await handleOne(msg, ctx);
            if (r) out.push(r);
        }
        return out.length ? out : null;
    }
    return handleOne(payload, ctx);
}
