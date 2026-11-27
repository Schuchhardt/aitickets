// Datos del mapa de mercado: productoras, lugares, eventos externos y sus funciones (aitickets_external_*), eventos de
// AI Tickets (events + funciones, recinto, categoría, precios y % vendido) y el calendario de mercado
// (aitickets_market_calendar). Todo se lleva a MarketEvent (una fila por función) para el modelo de fechas y el mapa.
// Solo los usa el MCP de admin.
import { fetchAll, localDay } from "../producer-api/tools/common";
import { loadPaidOrders, loadPlatformEvents, totalsByEvent } from "../admin-api/metrics";
import { addDays, dayOfWeek, WEEKDAY_NAMES, type CalendarEntry } from "./calendar";
import { nightDate, type MarketEvent } from "./dateModel";
import { CATEGORY_INFO, categoryFromTag, cityInfo, cityLabel, isCategory, leadNicheFor, normalizeText, panoramaSlug, platformLabel, slugKey, usesTicketing } from "./taxonomy";

export const PRODUCERS_TABLE = "aitickets_external_producers";
export const VENUES_TABLE = "aitickets_external_venues";
export const EXTERNAL_EVENTS_TABLE = "aitickets_external_events";
export const EVENT_DATES_TABLE = "aitickets_external_event_dates";
export const MARKET_CALENDAR_TABLE = "aitickets_market_calendar";
export const MISSING_MIGRATION =
    "Las tablas de eventos externos no existen todavía: falta aplicar la migración 202611200100_external_events.sql (se aplica en el próximo deploy de producción).";

export const isMissingTable = (error: any) => ["42P01", "PGRST205"].includes(String(error?.code || ""));

export const PRODUCER_COLUMNS = "id, name, producer_key, instagram, website, city, city_key, region, organization_id, lead_id, notes, created_at, updated_at";
export const VENUE_COLUMNS = "id, name, venue_key, address, commune, city, city_key, region, capacity, notes, created_at, updated_at";
export const EVENT_COLUMNS =
    "id, name, name_key, category, niche, tags, producer_id, ticketing_platform, ticketing_url, price_min, price_max, is_free, announced_at, source, source_url, external_id, notes, description, image_url, public_status, created_at, updated_at";
export const DATE_COLUMNS =
    "id, event_id, event_date, start_time, end_date, venue_id, city, city_key, commune, region, capacity, status, sold_out, sold_out_at, sold_pct, attendance, ticketing_url, slot_key, notes, created_at, updated_at";

export const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
export const hhmm = (v: unknown) => (v ? String(v).slice(0, 5) : null);
const categoryLabel = (c: unknown) => (isCategory(c) ? CATEGORY_INFO[c].label : c);

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------

export type ExternalBundle = { events: any[]; dates: any[]; venues: Map<number, any>; producers: Map<number, any> };

const CHUNK = 150;
async function inChunks<T>(ids: (number | string)[], fn: (chunk: (number | string)[]) => Promise<T[]>): Promise<T[]> {
    const out: T[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await fn(ids.slice(i, i + CHUNK))));
    return out;
}
const uniqueIds = (values: unknown[]) => [...new Set(values.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0))];

/** Lugares y productoras por id. */
export async function loadVenuesAndProducers(supabase: any, venueIds: number[], producerIds: number[]) {
    const [venues, producers] = await Promise.all([
        inChunks(venueIds, (c) => fetchAll<any>(() => supabase.from(VENUES_TABLE).select(VENUE_COLUMNS).in("id", c).order("id", { ascending: true }))),
        inChunks(producerIds, (c) => fetchAll<any>(() => supabase.from(PRODUCERS_TABLE).select(PRODUCER_COLUMNS).in("id", c).order("id", { ascending: true }))),
    ]);
    return { venues: new Map(venues.map((v: any) => [Number(v.id), v])), producers: new Map(producers.map((p: any) => [Number(p.id), p])) };
}

/**
 * Eventos externos con sus funciones, lugares y productoras. Con rango: los eventos con alguna función en [from, to]
 * (y todas sus funciones). Sin rango: todo. null = las tablas aún no existen.
 */
export async function loadExternalBundle(supabase: any, range: { from?: string | null; to?: string | null } = {}): Promise<ExternalBundle | null> {
    try {
        let events: any[];
        let dates: any[];
        if (range.from || range.to) {
            const inRange = await fetchAll<any>(
                () => {
                    let q = supabase.from(EVENT_DATES_TABLE).select("event_id");
                    if (range.from) q = q.gte("event_date", range.from);
                    if (range.to) q = q.lte("event_date", range.to);
                    return q.order("id", { ascending: true });
                },
                { max: 100000 },
            );
            const ids = uniqueIds(inRange.map((d) => d.event_id));
            events = await inChunks(ids, (c) => fetchAll<any>(() => supabase.from(EXTERNAL_EVENTS_TABLE).select(EVENT_COLUMNS).in("id", c).order("id", { ascending: true })));
            dates = await inChunks(ids, (c) => fetchAll<any>(() => supabase.from(EVENT_DATES_TABLE).select(DATE_COLUMNS).in("event_id", c).order("id", { ascending: true }), { max: 100000 }));
        } else {
            events = await fetchAll<any>(() => supabase.from(EXTERNAL_EVENTS_TABLE).select(EVENT_COLUMNS).order("id", { ascending: true }), { max: 50000 });
            dates = await fetchAll<any>(() => supabase.from(EVENT_DATES_TABLE).select(DATE_COLUMNS).order("id", { ascending: true }), { max: 200000 });
        }
        const { venues, producers } = await loadVenuesAndProducers(
            supabase,
            uniqueIds(dates.map((d) => d.venue_id)),
            uniqueIds(events.map((e) => e.producer_id)),
        );
        return { events, dates, venues, producers };
    } catch (err: any) {
        if (isMissingTable(err)) return null;
        throw err;
    }
}

export function datesByEvent(dates: any[]) {
    const map = new Map<number, any[]>();
    for (const d of dates) {
        const list = map.get(Number(d.event_id)) || [];
        list.push(d);
        map.set(Number(d.event_id), list);
    }
    for (const list of map.values()) list.sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)) || String(a.start_time || "").localeCompare(String(b.start_time || "")));
    return map;
}

/**
 * Una fila de MarketEvent por función (evento × noche × ciudad: dos funciones del mismo show la misma noche en la
 * misma ciudad cuentan una vez, con la capacidad mayor). Una gira aporta competencia en cada ciudad donde se presenta.
 */
export function bundleToMarket(bundle: ExternalBundle): MarketEvent[] {
    const eventById = new Map(bundle.events.map((e) => [Number(e.id), e]));
    const out = new Map<string, MarketEvent>();
    for (const d of bundle.dates) {
        const e = eventById.get(Number(d.event_id));
        if (!e) continue;
        const venue = d.venue_id ? bundle.venues.get(Number(d.venue_id)) : null;
        const producer = e.producer_id ? bundle.producers.get(Number(e.producer_id)) : null;
        const startTime = hhmm(d.start_time);
        const night = nightDate(d.event_date, startTime);
        const cityKey = d.city_key || venue?.city_key || null;
        const key = `ext:${e.id}:${night}:${cityKey || "-"}`;
        const capacity = num(d.capacity) ?? num(venue?.capacity);
        const prev = out.get(key);
        if (prev) {
            prev.capacity = Math.max(prev.capacity || 0, capacity || 0) || null;
            if (d.sold_out) prev.sold_out = true;
            continue;
        }
        out.set(key, {
            key,
            source: "external",
            id: Number(e.id),
            name: e.name,
            category: isCategory(e.category) ? e.category : "otro",
            niche: e.niche || null,
            date: d.event_date,
            night_date: night,
            start_time: startTime,
            city_key: cityKey,
            city: d.city || venue?.city || null,
            region: d.region || venue?.region || null,
            venue_name: venue?.name || null,
            capacity,
            producer_key: producer?.producer_key || null,
            producer_name: producer?.name || null,
            ticketing_platform: e.ticketing_platform ?? null,
            price_min: num(e.price_min),
            price_max: num(e.price_max),
            is_free: e.is_free ?? null,
            status: d.status || "scheduled",
            sold_out: d.sold_out ?? null,
            sold_pct: num(d.sold_pct),
            announced_at: e.announced_at || null,
            show_key: `ext:${e.id}`,
            organization_id: num(producer?.organization_id),
            lead_id: producer?.lead_id || null,
        });
    }
    return [...out.values()];
}

// ---------------------------------------------------------------------------
// Presentación
// ---------------------------------------------------------------------------

export const presentProducer = (p: any) =>
    p
        ? {
              id: Number(p.id),
              name: p.name,
              instagram: p.instagram || null,
              website: p.website || null,
              city: p.city || null,
              region: p.region || null,
              organization_id: num(p.organization_id),
              lead_id: p.lead_id || null,
              notes: p.notes || null,
          }
        : null;

export const presentVenue = (v: any) =>
    v
        ? {
              id: Number(v.id),
              name: v.name,
              address: v.address || null,
              commune: v.commune || null,
              city: v.city || null,
              city_key: v.city_key || null,
              region: v.region || null,
              capacity: num(v.capacity),
              notes: v.notes || null,
          }
        : null;

export function presentDate(d: any, venue: any) {
    return {
        id: Number(d.id),
        date: d.event_date,
        weekday: WEEKDAY_NAMES[dayOfWeek(d.event_date)],
        start_time: hhmm(d.start_time),
        end_date: d.end_date || null,
        night_of: nightDate(d.event_date, hhmm(d.start_time)),
        venue: venue ? { id: Number(venue.id), name: venue.name, capacity: num(venue.capacity) } : null,
        city: d.city || venue?.city || null,
        city_key: d.city_key || venue?.city_key || null,
        commune: d.commune || venue?.commune || null,
        region: d.region || venue?.region || null,
        capacity: num(d.capacity) ?? num(venue?.capacity),
        status: d.status,
        outcome: { sold_out: d.sold_out ?? null, sold_out_at: d.sold_out_at || null, sold_pct: num(d.sold_pct), attendance: num(d.attendance) },
        ticketing_url: d.ticketing_url || null,
        notes: d.notes || null,
    };
}

/** Resumen de las funciones: cuántas, primera, última, próxima, ciudades, lugares y si es gira. */
export function datesSummary(dates: any[], venues: Map<number, any>, today: string) {
    const sorted = [...dates].sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)));
    const cityKeys = [...new Set(sorted.map((d) => d.city_key || venues.get(Number(d.venue_id))?.city_key).filter(Boolean))] as string[];
    const venueIds = [...new Set(sorted.map((d) => Number(d.venue_id)).filter(Boolean))];
    const statusCounts: Record<string, number> = {};
    for (const d of sorted) statusCounts[d.status] = (statusCounts[d.status] || 0) + 1;
    const last = sorted[sorted.length - 1];
    return {
        functions: sorted.length,
        first_date: sorted[0]?.event_date || null,
        last_date: last?.end_date || last?.event_date || null,
        next_date: sorted.find((d) => d.event_date >= today && d.status !== "cancelled")?.event_date || null,
        cities: cityKeys.map((k) => cityLabel(k)),
        venues: venueIds.map((id) => venues.get(id)?.name).filter(Boolean),
        is_tour: cityKeys.length > 1,
        statuses: statusCounts,
        sold_out_functions: sorted.filter((d) => d.sold_out).length,
    };
}

const SITE_URL = (process.env.SITE_URL || "https://aitickets.cl").replace(/\/$/, "");

/** Cómo se ve en /panoramas (docs/specs/panoramas.md): estado, link público y si hoy aparece en el listado. */
function presentPublic(e: any, nextDate: string | null) {
    const status = e.public_status || "auto";
    return {
        status,
        listed: status !== "hidden" && Boolean(nextDate),
        url: status === "hidden" ? null : `${SITE_URL}/panoramas/evento/${panoramaSlug(e.name, e.id)}`,
        description: e.description || null,
        image_url: e.image_url || null,
    };
}

export function presentEvent(e: any, dates: any[], bundle: Pick<ExternalBundle, "venues" | "producers">, today: string, compact = false) {
    const producer = e.producer_id ? bundle.producers.get(Number(e.producer_id)) : null;
    const summary = datesSummary(dates, bundle.venues, today);
    if (compact) {
        return {
            id: Number(e.id),
            name: e.name,
            category: e.category,
            niche: e.niche || null,
            producer: producer?.name || null,
            ticketing_platform: e.ticketing_platform ?? null,
            functions: summary.functions,
            first_date: summary.first_date,
            last_date: summary.last_date,
            cities: summary.cities,
            is_tour: summary.is_tour,
            public_status: e.public_status || "auto",
        };
    }
    return {
        id: Number(e.id),
        name: e.name,
        category: e.category,
        category_label: categoryLabel(e.category),
        niche: e.niche || null,
        tags: e.tags || [],
        producer: presentProducer(producer),
        ticketing: {
            platform: e.ticketing_platform ?? null,
            label: platformLabel(e.ticketing_platform),
            uses_ticketing: usesTicketing(e.ticketing_platform),
            url: e.ticketing_url || null,
        },
        price: { min: num(e.price_min), max: num(e.price_max), is_free: e.is_free ?? null },
        ...summary,
        dates: dates.map((d) => presentDate(d, d.venue_id ? bundle.venues.get(Number(d.venue_id)) : null)),
        announced_at: e.announced_at || null,
        source: { source: e.source, url: e.source_url || null, external_id: e.external_id || null },
        lead_niche: leadNicheFor(e.category),
        public: presentPublic(e, summary.next_date),
        notes: e.notes || null,
        created_at: e.created_at,
        updated_at: e.updated_at,
    };
}

/** Texto para buscar en nombre, nicho, etiquetas, productora y lugares. */
export function searchableText(e: any, dates: any[], bundle: Pick<ExternalBundle, "venues" | "producers">) {
    const producer = e.producer_id ? bundle.producers.get(Number(e.producer_id)) : null;
    const venueNames = dates.map((d) => bundle.venues.get(Number(d.venue_id))?.name);
    return normalizeText([e.name, e.niche, (e.tags || []).join(" "), producer?.name, producer?.instagram, ...venueNames, ...dates.map((d) => d.city)].filter(Boolean).join(" "));
}

// ---------------------------------------------------------------------------
// Calendario
// ---------------------------------------------------------------------------

export async function loadCalendarEntries(supabase: any, range: { from?: string | null; to?: string | null } = {}): Promise<CalendarEntry[] | null> {
    let q = supabase.from(MARKET_CALENDAR_TABLE).select("id, kind, label, date_from, date_to, region, city_key, categories, impact, notes, created_at, updated_at");
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

const soft = async <T>(p: Promise<T[]>): Promise<T[]> => p.catch(() => [] as T[]);

/**
 * Eventos publicados de AI Tickets (sin demo ni cancelados) con funciones en [from, to], uno por función, día y ciudad.
 * Categoría desde su category_tag, ciudad y capacidad desde el recinto, precios desde sus entradas y, si ya pasó y
 * tiene una sola función con capacidad conocida, el % vendido (resultado para el modelo). Productora = la organización.
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
        soft(inChunks(uniqueIds(events.map((e) => e.organization_id)), (c) => fetchAll<any>(() => supabase.from("organizations").select("id, public_name").in("id", c).order("id", { ascending: true })))),
    ]);
    const venueIds = [...new Set(locations.map((l: any) => l.venue_id).filter(Boolean))];
    const tagIds = uniqueIds(tags.map((t: any) => t.tag_id));
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
    const fnsByEvent = new Map<number, any[]>();
    for (const d of dates) {
        const list = fnsByEvent.get(Number(d.event_id)) || [];
        list.push(d);
        fnsByEvent.set(Number(d.event_id), list);
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
        const past = events.filter((e) => localDay(e.end_date || e.start_date) < opts.today && (fnsByEvent.get(Number(e.id))?.length ?? 1) <= 1).map((e) => Number(e.id));
        if (past.length) {
            const totals = totalsByEvent(await loadPaidOrders(supabase, past).catch(() => []));
            soldByEvent = new Map([...totals.entries()].map(([id, t]) => [id, t.tickets_sold]));
        }
    }

    const out: MarketEvent[] = [];
    for (const e of events) {
        const id = Number(e.id);
        const fns = fnsByEvent.get(id)?.length ? fnsByEvent.get(id)! : [{ date: localDay(e.start_date), start_time: null, event_location_id: null }];
        const prices = pricesByEvent.get(id) || [];
        const paid = prices.filter((p) => p > 0);
        const category = categoryFromTag(categoryOf.get(id));
        const seen = new Set<string>();
        for (const f of fns) {
            const date = String(f.date).slice(0, 10);
            const loc = (f.event_location_id && locationById.get(f.event_location_id)) || firstLocation.get(id) || null;
            const venue = loc ? venueById.get(loc.venue_id) : null;
            const city = cityInfo(loc?.city_override || venue?.city || null);
            if (date < range.from || date > range.to || seen.has(`${date}|${city.key}`)) continue;
            seen.add(`${date}|${city.key}`);
            const capacity = Number(e.capacity) || Number(loc?.capacity_override) || Number(venue?.capacity) || null;
            const startTime = hhmm(f.start_time);
            const sold = soldByEvent.get(id);
            out.push({
                key: `ait:${id}:${date}:${city.key || "-"}`,
                source: "aitickets",
                id,
                name: e.name,
                category,
                niche: null,
                date,
                night_date: nightDate(date, startTime),
                start_time: startTime,
                city_key: city.key,
                city: city.label,
                region: city.region,
                venue_name: loc?.display_name || loc?.name || venue?.name || null,
                capacity,
                producer_key: e.organization_id ? `ait:${e.organization_id}` : null,
                producer_name: orgName.get(Number(e.organization_id)) || null,
                ticketing_platform: "aitickets",
                price_min: paid.length ? Math.min(...paid) : null,
                price_max: paid.length ? Math.max(...paid) : null,
                is_free: prices.length ? paid.length === 0 : null,
                status: date < opts.today ? "completed" : "scheduled",
                sold_out: null,
                sold_pct: sold != null && capacity ? Math.min(100, Math.round((sold / capacity) * 1000) / 10) : null,
                announced_at: e.created_at || null,
                show_key: `ait:${id}`,
                organization_id: e.organization_id ? Number(e.organization_id) : null,
                lead_id: null,
            });
        }
    }
    return out;
}

/** Externos + AI Tickets, sin contar dos veces un evento de AI Tickets que también se registró como externo. */
export function mergeMarketEvents(external: MarketEvent[], internal: MarketEvent[]): MarketEvent[] {
    const keyOf = (e: MarketEvent) => `${slugKey(e.name)}|${e.date}|${e.city_key || "-"}`;
    const keys = new Set(external.map(keyOf));
    return [...external, ...internal.filter((e) => !keys.has(keyOf(e)))];
}
