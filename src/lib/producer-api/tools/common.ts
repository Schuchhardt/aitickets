// Utilidades compartidas por las herramientas de la API de productores.
// La service role se salta RLS: TODA consulta filtra por ctx.actor.orgId (o por un evento ya verificado).
import { ToolError, type JsonSchema, type ToolContext } from "../registry";
import { getSoldCountsLegacy, isTicketOnSale } from "../../../../netlify/lib/tickets.mjs";

export const TZ = "America/Santiago";

export const eventIdSchema: JsonSchema = { type: "integer", minimum: 1, description: "ID del evento (ver list_events)." };

/** Carga un evento de la organización del actor o lanza not_found. */
export async function loadOwnedEvent<T = any>(ctx: ToolContext, eventId: number, columns = "*"): Promise<T> {
    const { data, error } = await ctx.supabase
        .from("events")
        .select(columns)
        .eq("id", eventId)
        .eq("organization_id", ctx.actor.orgId)
        .maybeSingle();
    if (error) console.error("loadOwnedEvent:", error.message);
    if (!data) throw new ToolError("not_found", `No existe el evento ${eventId} en tu organización. Usa list_events para ver los IDs.`);
    return data as T;
}

export const eventPublicUrl = (ctx: ToolContext, slug: string | null | undefined) => (slug ? `${ctx.origin}/eventos/${slug}` : null);
export const eventDashboardUrl = (ctx: ToolContext, id: number) => `${ctx.origin}/dashboard/events/${id}`;

export const clp = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")} CLP`;

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
/** YYYY-MM-DD en hora de Chile. */
export const localDay = (iso: string | Date) => dayFmt.format(new Date(iso));

/** Entradas emitidas (sold) y reservadas en checkout (pending) por tipo de entrada. */
export async function ticketAvailability(ctx: ToolContext, eventId: number, ticketIds: number[]): Promise<Map<number, { sold: number; pending: number }>> {
    const out = new Map(ticketIds.map((id) => [Number(id), { sold: 0, pending: 0 }]));
    if (!ticketIds.length) return out;
    const { data, error } = await ctx.supabase.rpc("aitickets_ticket_availability", { p_event_id: Number(eventId) });
    if (!error && Array.isArray(data)) {
        for (const row of data) {
            const entry = out.get(Number(row?.ticket_id));
            if (entry) {
                entry.sold = Number(row.sold) || 0;
                entry.pending = Number(row.pending) || 0;
            }
        }
        return out;
    }
    const sold: Map<number, number> = await getSoldCountsLegacy(ctx.supabase, eventId, ticketIds, { includePending: false });
    for (const [id, n] of sold) out.set(id, { sold: n, pending: 0 });
    return out;
}

export function presentTicket(t: any, availability?: { sold: number; pending: number }) {
    const sold = availability?.sold ?? 0;
    const pending = availability?.pending ?? 0;
    const capacity = t.total_quantity ?? null;
    return {
        id: Number(t.id),
        name: t.ticket_name,
        price: Number(t.price),
        quantity: capacity,
        sold,
        reserved_in_checkout: pending,
        remaining: capacity == null ? null : Math.max(0, capacity - sold - pending),
        on_sale_now: isTicketOnSale(t),
        status: t.status,
        sales_start: t.init_date ?? null,
        sales_end: t.end_date ?? null,
        event_date_id: t.event_date_id ?? null,
    };
}

export const TICKET_SELECT = "id, event_id, event_date_id, ticket_name, price, max_quantity, is_gift, status, init_date, end_date, total_quantity";

/** Valida fecha "YYYY-MM-DD" y horas "HH:MM". */
export const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";
export const TIME_PATTERN = "^\\d{2}:\\d{2}$";

/** Convierte un timestamp ISO opcional a ISO normalizado o null. */
export function isoOrNull(v: unknown): string | null {
    if (v === null || v === undefined || v === "") return null;
    const d = new Date(String(v));
    if (Number.isNaN(d.getTime())) throw new ToolError("invalid_input", `Fecha inválida: ${v}`);
    return d.toISOString();
}

/**
 * Lee todas las filas de una consulta paginando de a 1000 (PostgREST corta en max-rows sin avisar).
 * `build` debe devolver una consulta NUEVA cada vez. Tope `max` para no cargar tablas enormes en memoria.
 */
export async function fetchAll<T = any>(build: () => any, { pageSize = 1000, max = 20000 } = {}): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; from < max; from += pageSize) {
        const { data, error } = await build().range(from, from + pageSize - 1);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < pageSize) break;
    }
    return out;
}
