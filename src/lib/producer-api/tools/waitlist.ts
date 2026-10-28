// Herramienta: lista de espera de un evento (aitickets_event_waitlist). Quienes pidieron aviso en la página reciben un
// solo correo cuando abre la venta o se liberan entradas (netlify/lib/waitlist.mjs, cada 15 min).
import type { ToolDef } from "../registry";
import { eventIdSchema, loadOwnedEvent, localDateTime } from "./common";
import { listWaitlist } from "../../../../netlify/lib/waitlist.mjs";

const listWaitlistTool: ToolDef = {
    name: "list_waitlist",
    title: "Ver lista de espera",
    description:
        "Personas que pidieron aviso en la página de un evento (venta por abrir, agotado o cupos llenos), por función, y si ya " +
        "se les avisó. El aviso sale solo, una vez por persona, cuando hay entradas a la venta: no hace falta escribirles. " +
        "Contiene datos personales (emails). Úsala para medir la demanda antes de abrir una tanda o agregar una función.",
    scope: "attendees",
    permission: "attendees.read",
    annotations: { readOnlyHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            only_pending: { type: "boolean", default: false, description: "Solo quienes todavía esperan el aviso." },
            limit: { type: "integer", minimum: 1, maximum: 1000, default: 200 },
        },
    },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, name");
        const { total, notified, pending, rows } = await listWaitlist(ctx.supabase, event.id);
        const byFunction = new Map<string, number>();
        for (const r of rows as any[]) if (!r.notified_at) byFunction.set(r.function_label || "Todas", (byFunction.get(r.function_label || "Todas") || 0) + 1);
        const filtered = args.only_pending ? rows.filter((r: any) => !r.notified_at) : rows;
        return {
            event: { id: event.id, name: event.name },
            summary: { total, notified, pending, pending_by_function: Object.fromEntries(byFunction) },
            entries: filtered.slice(0, args.limit ?? 200).map((r: any) => ({
                email: r.email,
                reason: r.kind_label,
                function: r.function_label || "Todas",
                event_date_id: r.event_date_id,
                joined_at_local: localDateTime(r.created_at),
                notified_at_local: localDateTime(r.notified_at),
            })),
            truncated: filtered.length > (args.limit ?? 200),
        };
    },
};

export const waitlistTools: ToolDef[] = [listWaitlistTool];
