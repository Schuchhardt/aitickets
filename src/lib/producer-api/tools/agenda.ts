// Herramientas: agenda del evento (bloques con hora, expositores y sala por función; src/lib/eventAgenda.mjs). La
// página del evento la muestra por día cuando hay bloques. El panel usa estas mismas herramientas
// (/api/events/agenda).
import { ToolError, type ToolDef } from "../registry";
import { eventIdSchema, loadOwnedEvent } from "./common";
import { formatFunctionLabel } from "../../../../netlify/lib/dates.mjs";
import {
    AGENDA_LIMITS, AgendaError, MAX_AGENDA_BLOCKS, agendaGroups, agendaText, loadAgenda, normalizeAgenda, saveAgenda,
} from "../../eventAgenda.mjs";

async function loadFunctions(ctx: any, eventId: number) {
    const { data, error } = await ctx.supabase
        .from("event_dates")
        .select("id, date, start_time, end_time")
        .eq("event_id", eventId)
        .order("date", { ascending: true })
        .order("start_time", { ascending: true });
    if (error) throw error;
    return (data || []) as any[];
}

function present(event: any, dates: any[], blocks: any[]) {
    const groups = agendaGroups(blocks, dates);
    return {
        event_id: Number(event.id),
        event_name: event.name,
        functions: dates.map((d) => ({ id: Number(d.id), label: formatFunctionLabel(d, { withPlace: false }) })),
        blocks: blocks.map((b) => ({ function_id: b.function_id, start: b.start, end: b.end, title: b.title, speakers: b.speakers, room: b.room })),
        total_blocks: blocks.length,
        // Lo mismo que ve el público en la página del evento (sección "Agenda")
        as_text: agendaText(groups) || null,
    };
}

const getEventAgenda: ToolDef = {
    name: "get_event_agenda",
    title: "Ver agenda del evento",
    description:
        "Agenda del evento: bloques con hora de inicio y término, título, expositores y sala, cada uno de una función (día) o de todas " +
        "(function_id null). La página del evento la muestra agrupada por día. Devuelve también las funciones del evento (para function_id).",
    scope: "read",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", required: ["event_id"], additionalProperties: false, properties: { event_id: eventIdSchema } },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, name");
        const [dates, blocks] = await Promise.all([loadFunctions(ctx, event.id), loadAgenda(ctx.supabase, event.id)]);
        return present(event, dates, blocks);
    },
};

const updateEventAgenda: ToolDef = {
    name: "update_event_agenda",
    title: "Actualizar agenda del evento",
    description:
        "Reemplaza la agenda completa del evento con `blocks` (manda TODOS los bloques, también los que no cambian; una lista vacía la borra). " +
        "Cada bloque: start (HH:MM, hora de Chile), end opcional, title, speakers (texto: \"Ana Pérez (Empresa X), Juan Soto\"), room y " +
        "function_id (get_event_agenda → functions; null = todos los días). Lee primero con get_event_agenda. La página del evento se actualiza al instante.",
    scope: "write",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id", "blocks"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            blocks: {
                type: "array",
                maxItems: MAX_AGENDA_BLOCKS,
                items: {
                    type: "object",
                    required: ["start", "title"],
                    additionalProperties: false,
                    properties: {
                        function_id: { type: "integer", minimum: 1, nullable: true, description: "Función (día) del bloque; null = todos los días." },
                        start: { type: "string", pattern: "^\\d{1,2}:\\d{2}(:\\d{2})?$", description: "Hora de inicio, HH:MM." },
                        end: { type: "string", pattern: "^\\d{1,2}:\\d{2}(:\\d{2})?$", nullable: true, description: "Hora de término, HH:MM (opcional)." },
                        title: { type: "string", minLength: 1, maxLength: AGENDA_LIMITS.title },
                        speakers: { type: "string", maxLength: AGENDA_LIMITS.speakers, nullable: true },
                        room: { type: "string", maxLength: AGENDA_LIMITS.room, nullable: true },
                    },
                },
            },
        },
    },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, name");
        const dates = await loadFunctions(ctx, event.id);
        try {
            const blocks = normalizeAgenda(args.blocks, dates.map((d) => Number(d.id)));
            const saved = await saveAgenda(ctx.supabase, Number(event.id), blocks);
            return present(event, dates, saved);
        } catch (err) {
            if (err instanceof AgendaError) throw new ToolError(err.unavailable ? "unavailable" : "invalid_input", err.message);
            throw err;
        }
    },
    audit: (args) => ({ summary: `Agenda: ${args.blocks?.length || 0} bloque(s)` }),
};

export const agendaTools: ToolDef[] = [getEventAgenda, updateEventAgenda];
