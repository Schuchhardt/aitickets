// Herramientas de admin: eventos de toda la plataforma.
import { eventDateFields, eventPublicUrl, fetchAll } from "../../producer-api/tools/common";
import { eventVisitCounts } from "../../eventAnalytics";
import type { AdminToolDef } from "../registry";
import { emptyTotals, loadPaidOrders, loadPlatformEvents, pct, totalsByEvent } from "../metrics";
import { organizationIdSchema } from "./organizations";

const WHEN = ["upcoming", "live_today", "past", "all"] as const;
const SORTS = ["sales", "date", "created"] as const;
const VISIT_CONCURRENCY = 5;

/** Ejecuta fn sobre items con concurrencia acotada. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i]);
        }
    });
    await Promise.all(workers);
    return out;
}

const searchEvents: AdminToolDef = {
    name: "search_events",
    title: "Buscar eventos (toda la plataforma)",
    description:
        "Todos los eventos de todos los productores. Filtra por texto (nombre o slug), organización, estado, momento " +
        "(upcoming = terminan en el futuro, live_today = hoy en Chile, past) y rango de fechas de inicio. Por evento: productor, fechas, " +
        "estado, entradas vendidas, ventas brutas, neto del productor, visitas, visitantes únicos y conversión. " +
        "Excluye los eventos demo salvo include_demo. Para la analítica completa de un evento usa org_get_event_performance.",
    readOnly: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            query: { type: "string", minLength: 2, maxLength: 120, description: "Texto del nombre o slug, o el ID del evento." },
            organization_id: organizationIdSchema,
            status: { type: "string", enum: ["published", "draft", "all"], default: "all" },
            when: { type: "string", enum: WHEN, default: "all" },
            start_from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Empiezan desde (YYYY-MM-DD, UTC)." },
            start_to: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Empiezan hasta (YYYY-MM-DD, inclusive)." },
            include_archived: { type: "boolean", default: false },
            include_demo: { type: "boolean", default: false },
            sort: { type: "string", enum: SORTS, default: "date", description: "date = próximos primero y luego los pasados más recientes; sales = ventas brutas; created = creados más recientes." },
            limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        },
    },
    async handler(args, actx) {
        const { supabase } = actx;
        let events = await loadPlatformEvents(supabase, { orgIds: args.organization_id ? [args.organization_id] : null, includeDemo: args.include_demo });
        const nowMs = Date.now();
        const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
        if (!args.include_archived) events = events.filter((e) => !e.archived_at);
        if (args.status !== "all") events = events.filter((e) => e.status === args.status);
        if (args.query) {
            const q = args.query.toLowerCase();
            events = events.filter((e) => String(e.id) === args.query.trim() || String(e.name || "").toLowerCase().includes(q) || String(e.slug || "").toLowerCase().includes(q));
        }
        if (args.when === "upcoming") events = events.filter((e) => !e.end_date || Date.parse(e.end_date) >= nowMs);
        if (args.when === "past") events = events.filter((e) => e.end_date && Date.parse(e.end_date) < nowMs);
        if (args.when === "live_today") {
            events = events.filter((e) => {
                const start = e.start_date ? new Date(e.start_date).toLocaleDateString("en-CA", { timeZone: "America/Santiago" }) : null;
                const end = e.end_date ? new Date(e.end_date).toLocaleDateString("en-CA", { timeZone: "America/Santiago" }) : start;
                return start != null && start <= today && (end || start) >= today;
            });
        }
        if (args.start_from) events = events.filter((e) => e.start_date && String(e.start_date).slice(0, 10) >= args.start_from);
        if (args.start_to) events = events.filter((e) => e.start_date && String(e.start_date).slice(0, 10) <= args.start_to);

        const orders = await loadPaidOrders(supabase, events.map((e) => Number(e.id)));
        const byEvent = totalsByEvent(orders);
        const sorters: Record<string, (a: any, b: any) => number> = {
            sales: (a, b) => (byEvent.get(Number(b.id))?.gross_sales_clp || 0) - (byEvent.get(Number(a.id))?.gross_sales_clp || 0),
            created: (a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")),
            date: (a, b) => {
                const upA = !a.end_date || Date.parse(a.end_date) >= nowMs;
                const upB = !b.end_date || Date.parse(b.end_date) >= nowMs;
                if (upA !== upB) return upA ? -1 : 1;
                const sa = String(a.start_date || "");
                const sb = String(b.start_date || "");
                return upA ? sa.localeCompare(sb) : sb.localeCompare(sa);
            },
        };
        events.sort(sorters[args.sort] || sorters.date);
        const page = events.slice(0, args.limit);

        const orgIds = [...new Set(page.map((e) => Number(e.organization_id)))];
        const orgs = orgIds.length ? await fetchAll<any>(() => supabase.from("organizations").select("id, public_name").in("id", orgIds).order("id", { ascending: true })) : [];
        const orgName = new Map(orgs.map((o: any) => [Number(o.id), o.public_name]));
        const visits = await mapLimit(page, VISIT_CONCURRENCY, (e) => eventVisitCounts(supabase, Number(e.id)));

        return {
            total: events.length,
            returned: page.length,
            dates_note: "start_date/end_date en UTC; start_local/end_local en hora de Chile.",
            events: page.map((e, i) => {
                const t = byEvent.get(Number(e.id)) || emptyTotals();
                return {
                    id: Number(e.id),
                    name: e.name,
                    organization: { id: Number(e.organization_id), name: orgName.get(Number(e.organization_id)) || null },
                    status: e.status,
                    visibility: e.accessibility === "private" ? "private" : "public",
                    ...(e.archived_at ? { archived: true } : {}),
                    ...(e.cancelled_at ? { cancelled_at: e.cancelled_at } : {}),
                    ...eventDateFields(e),
                    public_url: e.status === "published" ? eventPublicUrl({ origin: actx.origin } as any, e.slug) : null,
                    paid_orders: t.paid_orders,
                    tickets_sold: t.tickets_sold,
                    courtesy_tickets: t.courtesy_tickets,
                    gross_sales_clp: t.gross_sales_clp,
                    producer_net_clp: t.producer_net_clp,
                    last_sale_at: t.last_sale_at,
                    visits: visits[i].visits,
                    unique_visitors: visits[i].unique_visitors,
                    conversion_pct: pct(t.paid_orders, visits[i].unique_visitors),
                };
            }),
        };
    },
};

export const eventTools: AdminToolDef[] = [searchEvents];
