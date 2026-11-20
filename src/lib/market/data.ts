// Datos del mapa de mercado: eventos externos (aitickets_external_events), eventos de AI Tickets (events + funciones,
// recinto, categoría, precios y % vendido) y el calendario de mercado (aitickets_market_calendar), todos llevados a
// MarketEvent para el modelo de fechas y el mapa. Solo los usa el MCP de admin.
import { fetchAll, localDay } from "../producer-api/tools/common";
import { loadPaidOrders, loadPlatformEvents, totalsByEvent } from "../admin-api/metrics";
import { addDays, dayOfWeek, WEEKDAY_NAMES, type CalendarEntry } from "./calendar";
import { nightDate, type MarketEvent } from "./dateModel";
import { cityInfo, isEventType, normalizeText, platformLabel, slugKey, TYPE_INFO, typeFromCategory, usesTicketing } from "./taxonomy";

export const EXTERNAL_EVENTS_TABLE = "aitickets_external_events";
export const MARKET_CALENDAR_TABLE = "aitickets_market_calendar";
export const MISSING_MIGRATION = "Las tablas de eventos externos no existen todavía: falta aplicar la migración 202611200100_external_events.sql (se aplica en el próximo deploy de producción).";

export const isMissingTable = (error: any) => ["42P01", "PGRST205"].includes(String(error?.code || ""));

export const EXTERNAL_COLUMNS =
    "id, name, event_type, genre, tags, event_date, start_time, end_date, city, city_key, commune, region, country, venue_name, capacity, " +
    "organizer_name, organizer_key, organizer_instagram, organizer_website, ticketing_platform, ticketing_url, price_min, price_max, is_free, status, " +
    "sold_out, sold_out_at, sold_pct, attendance, announced_at, source, source_url, external_id, series_key, dedupe_key, organization_id, lead_id, notes, created_at, updated_at";

const typeLabel = (t: unknown) => (isEventType(t) ? TYPE_INFO[t].label : t);
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const hhmm = (v: unknown) => (v ? String(v).slice(0, 5) : null);

export function externalToMarket(r: any): MarketEvent {
    const startTime = hhmm(r.start_time);
    return {
        key: `ext:${r.id}`,
        source: "external",
        id: Number(r.id),
        name: r.name,
        event_type: isEventType(r.event_type) ? r.event_type : "otro",
        genre: r.genre || null,
        date: r.event_date,
        night_date: nightDate(r.event_date, startTime),
        start_time: startTime,
        city_key: r.city_key || null,
        city: r.city || null,
        region: r.region || null,
        venue_name: r.venue_name || null,
        capacity: num(r.capacity),
        organizer_key: r.organizer_key || null,
        organizer_name: r.organizer_name || null,
        ticketing_platform: r.ticketing_platform ?? null,
        price_min: num(r.price_min),
        price_max: num(r.price_max),
        is_free: r.is_free ?? null,
        status: r.status || "scheduled",
        sold_out: r.sold_out ?? null,
        sold_pct: num(r.sold_pct),
        announced_at: r.announced_at || null,
        series_key: r.series_key || null,
        organization_id: num(r.organization_id),
        lead_id: r.lead_id || null,
    };
}

/** Evento externo para las respuestas del MCP. */
export function presentExternal(r: any, compact = false) {
    const startTime = hhmm(r.start_time);
    const base = {
        id: Number(r.id),
        name: r.name,
        event_type: r.event_type,
        date: r.event_date,
        weekday: r.event_date ? WEEKDAY_NAMES[dayOfWeek(r.event_date)] : null,
        start_time: startTime,
        city: r.city || null,
        venue: r.venue_name || null,
        organizer: r.organizer_name || null,
        ticketing_platform: r.ticketing_platform ?? null,
        status: r.status,
    };
    if (compact) return { ...base, capacity: num(r.capacity), price_min: num(r.price_min), sold_out: r.sold_out ?? null };
    return {
        ...base,
        type_label: typeLabel(r.event_type),
        genre: r.genre || null,
        tags: r.tags || [],
        end_date: r.end_date || null,
        night_of: nightDate(r.event_date, startTime),
        city_key: r.city_key || null,
        commune: r.commune || null,
        region: r.region || null,
        capacity: num(r.capacity),
        organizer: {
            name: r.organizer_name || null,
            instagram: r.organizer_instagram || null,
            website: r.organizer_website || null,
            key: r.organizer_key || null,
        },
        ticketing: {
            platform: r.ticketing_platform ?? null,
            label: platformLabel(r.ticketing_platform),
            uses_ticketing: usesTicketing(r.ticketing_platform),
            url: r.ticketing_url || null,
        },
        price: { min: num(r.price_min), max: num(r.price_max), is_free: r.is_free ?? null },
        outcome: { sold_out: r.sold_out ?? null, sold_out_at: r.sold_out_at || null, sold_pct: num(r.sold_pct), attendance: num(r.attendance) },
        announced_at: r.announced_at || null,
        source: { source: r.source, url: r.source_url || null, external_id: r.external_id || null },
        series_key: r.series_key || null,
        organization_id: num(r.organization_id),
        lead_id: r.lead_id || null,
        notes: r.notes || null,
        created_at: r.created_at,
        updated_at: r.updated_at,
    };
}

/** Eventos externos con fecha en [from, to] (sin rango: todos). null = la tabla aún no existe. */
export async function loadExternalRows(supabase: any, range: { from?: string | null; to?: string | null } = {}): Promise<any[] | null> {
    try {
        return await fetchAll<any>(
            () => {
                let q = supabase.from(EXTERNAL_EVENTS_TABLE).select(EXTERNAL_COLUMNS);
                if (range.from) q = q.gte("event_date", range.from);
                if (range.to) q = q.lte("event_date", range.to);
                return q.order("event_date", { ascending: true }).order("id", { ascending: true });
            },
            { max: 50000 },
        );
    } catch (err: any) {
        if (isMissingTable(err)) return null;
        throw err;
    }
}

export async function loadCalendarEntries(supabase: any, range: { from?: string | null; to?: string | null } = {}): Promise<CalendarEntry[] | null> {
    let q = supabase.from(MARKET_CALENDAR_TABLE).select("id, kind, label, date_from, date_to, region, city_key, event_types, impact, notes, created_at, updated_at");
    if (range.to) q = q.lte("date_from", range.to);
    if (range.from) q = q.gte("date_to", range.from);
    const { data, error } = await q.order("date_from", { ascending: true }).limit(2000);
    if (error) {
        if (isMissingTable(error)) return null;
        throw error;
    }
    return (data || []).map((e: any) => ({ ...e, id: Number(e.id), impact: num(e.impact) }));
}

// ---------------------------------------------------------------------------
// Eventos de AI Tickets como datos de mercado
// ---------------------------------------------------------------------------

const CHUNK = 150;
async function inChunks<T>(ids: (number | string)[], fn: (chunk: (number | string)[]) => Promise<T[]>): Promise<T[]> {
    const out: T[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await fn(ids.slice(i, i + CHUNK))));
    return out;
}
const soft = async <T>(p: Promise<T[]>): Promise<T[]> => p.catch(() => [] as T[]);

/**
 * Eventos publicados de AI Tickets (sin demo ni cancelados) con funciones en [from, to], uno por función y día.
 * Tipo desde su categoría, ciudad y capacidad desde el recinto, precios desde sus entradas y, si ya pasó y tiene una
 * sola función con capacidad conocida, el % vendido (resultado para el modelo).
 */
export async function loadInternalMarketEvents(supabase: any, range: { from: string; to: string }, opts: { today: string; withOutcomes?: boolean }): Promise<MarketEvent[]> {
    const fromIso = `${addDays(range.from, -2)}T00:00:00Z`;
    const toIso = `${addDays(range.to, 2)}T23:59:59Z`;
    const events = (await loadPlatformEvents(supabase)).filter(
        (e) => e.status === "published" && !e.cancelled_at && e.start_date && e.start_date <= toIso && (e.end_date || e.start_date) >= fromIso,
    );
    if (!events.length) return [];
    const ids = events.map((e) => Number(e.id));

    const [dates, locations, tags, tickets, orgs] = await Promise.all([
        soft(inChunks(ids, (c) => fetchAll<any>(() => supabase.from("event_dates").select("id, event_id, date, start_time, event_location_id").in("event_id", c).order("id", { ascending: true })))),
        soft(inChunks(ids, (c) => fetchAll<any>(() => supabase.from("event_locations").select("id, event_id, venue_id, name, display_name, capacity_override, city_override").in("event_id", c).order("id", { ascending: true })))),
        soft(inChunks(ids, (c) => fetchAll<any>(() => supabase.from("event_tags").select("event_id, tag_id").in("event_id", c).order("id", { ascending: true })))),
        soft(inChunks(ids, (c) => fetchAll<any>(() => supabase.from("event_tickets").select("event_id, price, is_gift").in("event_id", c).order("id", { ascending: true })))),
        soft(inChunks([...new Set(events.map((e) => Number(e.organization_id)).filter(Boolean))], (c) => fetchAll<any>(() => supabase.from("organizations").select("id, public_name").in("id", c).order("id", { ascending: true })))),
    ]);
    const venueIds = [...new Set(locations.map((l: any) => l.venue_id).filter(Boolean))];
    const tagIds = [...new Set(tags.map((t: any) => Number(t.tag_id)).filter(Boolean))];
    const [venues, categories] = await Promise.all([
        soft(inChunks(venueIds, (c) => fetchAll<any>(() => supabase.from("venues").select("id, name, city, capacity").in("id", c).order("id", { ascending: true })))),
        soft(inChunks(tagIds, (c) => fetchAll<any>(() => supabase.from("category_tags").select("id, name").in("id", c).order("id", { ascending: true })))),
    ]);
    const venueById = new Map(venues.map((v: any) => [v.id, v]));
    const locationById = new Map(locations.map((l: any) => [l.id, l]));
    const firstLocation = new Map<number, any>();
    for (const l of locations) if (!firstLocation.has(Number(l.event_id))) firstLocation.set(Number(l.event_id), l);
    const categoryById = new Map(categories.map((c: any) => [Number(c.id), c.name]));
    const categoryOf = new Map<number, string>();
    for (const t of tags) if (!categoryOf.has(Number(t.event_id)) && categoryById.has(Number(t.tag_id))) categoryOf.set(Number(t.event_id), categoryById.get(Number(t.tag_id)));
    const orgName = new Map(orgs.map((o: any) => [Number(o.id), o.public_name]));
    const datesByEvent = new Map<number, any[]>();
    for (const d of dates) {
        const list = datesByEvent.get(Number(d.event_id)) || [];
        list.push(d);
        datesByEvent.set(Number(d.event_id), list);
    }
    const pricesByEvent = new Map<number, number[]>();
    for (const t of tickets) {
        if (t.is_gift) continue;
        const list = pricesByEvent.get(Number(t.event_id)) || [];
        list.push(Number(t.price) || 0);
        pricesByEvent.set(Number(t.event_id), list);
    }

    let soldByEvent = new Map<number, number>();
    if (opts.withOutcomes) {
        const past = events.filter((e) => localDay(e.end_date || e.start_date) < opts.today && (datesByEvent.get(Number(e.id))?.length ?? 1) <= 1).map((e) => Number(e.id));
        if (past.length) {
            const totals = totalsByEvent(await loadPaidOrders(supabase, past).catch(() => []));
            soldByEvent = new Map([...totals.entries()].map(([id, t]) => [id, t.tickets_sold]));
        }
    }

    const out: MarketEvent[] = [];
    for (const e of events) {
        const id = Number(e.id);
        const fns = datesByEvent.get(id)?.length ? datesByEvent.get(id)! : [{ date: localDay(e.start_date), start_time: null, event_location_id: null }];
        const prices = pricesByEvent.get(id) || [];
        const paid = prices.filter((p) => p > 0);
        const type = typeFromCategory(categoryOf.get(id));
        const seen = new Set<string>();
        for (const f of fns) {
            const date = String(f.date).slice(0, 10);
            if (date < range.from || date > range.to || seen.has(date)) continue;
            seen.add(date);
            const loc = (f.event_location_id && locationById.get(f.event_location_id)) || firstLocation.get(id) || null;
            const venue = loc ? venueById.get(loc.venue_id) : null;
            const city = cityInfo(loc?.city_override || venue?.city || null);
            const capacity = Number(e.capacity) || Number(loc?.capacity_override) || Number(venue?.capacity) || null;
            const startTime = hhmm(f.start_time);
            const sold = soldByEvent.get(id);
            out.push({
                key: `ait:${id}:${date}`,
                source: "aitickets",
                id,
                name: e.name,
                event_type: type,
                genre: null,
                date,
                night_date: nightDate(date, startTime),
                start_time: startTime,
                city_key: city.key,
                city: city.label,
                region: city.region,
                venue_name: loc?.display_name || loc?.name || venue?.name || null,
                capacity,
                organizer_key: e.organization_id ? `ait:${e.organization_id}` : null,
                organizer_name: orgName.get(Number(e.organization_id)) || null,
                ticketing_platform: "aitickets",
                price_min: paid.length ? Math.min(...paid) : null,
                price_max: paid.length ? Math.max(...paid) : null,
                is_free: prices.length ? paid.length === 0 : null,
                status: date < opts.today ? "completed" : "scheduled",
                sold_out: null,
                sold_pct: sold != null && capacity ? Math.min(100, Math.round((sold / capacity) * 1000) / 10) : null,
                announced_at: e.created_at || null,
                series_key: `ait:${id}`,
                organization_id: e.organization_id ? Number(e.organization_id) : null,
                lead_id: null,
            });
        }
    }
    return out;
}

/** Externos + AI Tickets, sin contar dos veces un evento de AI Tickets que también se registró como externo. */
export function mergeMarketEvents(external: MarketEvent[], internal: MarketEvent[]): MarketEvent[] {
    const keys = new Set(external.map((e) => `${slugKey(e.name)}|${e.date}|${e.city_key || "-"}`));
    return [...external, ...internal.filter((e) => !keys.has(`${slugKey(e.name)}|${e.date}|${e.city_key || "-"}`))];
}

/** Texto para buscar en nombre, organizador, recinto y género. */
export const searchableText = (r: any) => normalizeText([r.name, r.organizer_name, r.venue_name, r.genre, r.city, r.commune, (r.tags || []).join(" ")].filter(Boolean).join(" "));

