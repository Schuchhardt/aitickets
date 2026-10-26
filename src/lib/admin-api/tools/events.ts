// Herramientas de admin: eventos de toda la plataforma.
import { eventDateFields, eventPublicUrl, fetchAll } from "../../producer-api/tools/common";
import { ToolError } from "../../producer-api/registry";
import { eventVisitCounts, getEventAnalytics } from "../../eventAnalytics";
import { isDemoEventSlug } from "../../demoEvent.mjs";
import type { AdminToolDef } from "../registry";
import { seriesSummaryForEvent } from "../../socialSeries";
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

const isMissing = (error: any) => ["42P01", "PGRST205", "42703", "PGRST204"].includes(String(error?.code || ""));

const getEventAnalyticsTool: AdminToolDef = {
    name: "get_event_analytics",
    title: "Analítica completa de un evento",
    description:
        "La misma vista de analítica que ve el productor en su panel, para cualquier evento de la plataforma (la organización se infiere del evento): " +
        "visitas y visitantes únicos, conversión (órdenes ÷ visitantes únicos), ocupación (emitidas ÷ capacidad), serie diaria en hora de Chile, " +
        "horas pico, fuentes de tráfico, ubicación de visitantes, ventas y conversión por canal (ref/UTM), por medio de pago y por tipo de entrada, " +
        "reembolsos, más el resumen de check-in, de reseñas (sin datos personales) y de la difusión automática en Instagram (piezas publicadas, " +
        "DMs y ventas por DM). Ventas sin cortesías ni transferencias.",
    readOnly: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["event_id"],
        properties: {
            event_id: { type: "integer", minimum: 1, description: "ID del evento (ver search_events)." },
            include_demo: { type: "boolean", default: false, description: "true = permitir eventos demo." },
        },
    },
    async handler(args, actx) {
        const { supabase } = actx;
        const load = (cols: string) => supabase.from("events").select(cols).eq("id", args.event_id).maybeSingle();
        let { data: event, error } = await load("id, name, slug, status, organization_id, start_date, end_date, capacity, archived_at, cancelled_at");
        if (error && isMissing(error)) ({ data: event, error } = await load("id, name, slug, status, organization_id, start_date, end_date, capacity"));
        if (error) throw error;
        if (!event) throw new ToolError("not_found", `No existe el evento ${args.event_id}. Usa search_events para ver los IDs.`);
        if (isDemoEventSlug(event.slug) && !args.include_demo) {
            throw new ToolError("invalid_input", `El evento ${args.event_id} es un evento demo. Pasa include_demo = true si de verdad quieres su analítica.`);
        }
        const [analytics, { data: org }, attendees, reviews, socialSeries] = await Promise.all([
            getEventAnalytics(supabase, { id: Number(event.id), status: event.status }),
            supabase.from("organizations").select("id, public_name").eq("id", event.organization_id).maybeSingle(),
            fetchAll<any>(() => supabase.from("event_attendees").select("id, status, validated_at, is_complimentary").eq("event_id", event.id).order("id", { ascending: true })).catch((err: any) => {
                if (isMissing(err)) return [];
                throw err;
            }),
            fetchAll<any>(() => supabase.from("aitickets_event_reviews").select("rating").eq("event_id", event.id).order("id", { ascending: true })).catch((err: any) => {
                if (isMissing(err)) return [];
                throw err;
            }),
            seriesSummaryForEvent(supabase, Number(event.id)).catch(() => null),
        ]);
        const active = attendees.filter((a: any) => a.status !== "cancelled");
        const checkedIn = active.filter((a: any) => a.validated_at || a.status === "validated").length;
        const ratings = reviews.map((r: any) => Number(r.rating)).filter((n: number) => n >= 1 && n <= 5);
        const distribution = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, ratings.filter((r: number) => r === n).length]));
        return {
            event: {
                id: Number(event.id),
                name: event.name,
                status: event.status,
                ...(event.archived_at ? { archived: true } : {}),
                ...(event.cancelled_at ? { cancelled_at: event.cancelled_at } : {}),
                ...eventDateFields(event),
                public_url: event.status === "published" ? eventPublicUrl({ origin: actx.origin } as any, event.slug) : null,
            },
            organization: { id: Number(event.organization_id), name: org?.public_name ?? null },
            ...analytics,
            checkin: {
                issued_tickets: active.length,
                checked_in: checkedIn,
                pending: active.length - checkedIn,
                complimentary_issued: active.filter((a: any) => a.is_complimentary === true).length,
                checked_in_pct: pct(checkedIn, active.length),
            },
            reviews: {
                count: ratings.length,
                average: ratings.length ? Math.round((ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length) * 10) / 10 : null,
                distribution,
            },
            social_series: socialSeries,
            definitions:
                "Ventas sin cortesías ni transferencias; revenue_clp = neto del productor. Conversión = órdenes vendidas ÷ visitantes únicos; " +
                "ocupación = emitidas ÷ capacidad a la venta. Días y horas en hora de Chile.",
        };
    },
};

export const eventTools: AdminToolDef[] = [searchEvents, getEventAnalyticsTool];
