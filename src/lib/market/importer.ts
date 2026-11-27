// Importadores automáticos de eventos externos (para /panoramas y el mapa de mercado). Todo pasa por el MISMO registro
// del MCP de admin (importExternalEvents → register_external_events): misma validación, normalización y deduplicación.
//
//   1. syncCompetitorEvents: los eventos que el vigía de Passline guardó para los leads (aitickets_competitor_events,
//      netlify/lib/leads/passline-watch.mjs, SOLO resultados de búsqueda) pasan a eventos externos, enlazados a su lead.
//   2. importEventItems: lotes que mandan los recolectores de netlify/lib/market/ticketing-watch.mjs (búsqueda en varias
//      ticketeras y la Discovery API de Ticketmaster) por POST /api/internal/market-import.
//
// Las funciones síncronas de Netlify cortan a los 10 s y cada evento hace varias consultas a Supabase (otra región):
// todo se procesa en lotes chicos con un plazo (deadline) y devuelve dónde seguir.
// Spec: docs/specs/panoramas.md §9.
import { importExternalEvents } from "../admin-api/tools/market";
import { PANORAMA_PAGES_TAG, purgeCacheTags } from "../cdnCache";
import { addDays, todayChile } from "./calendar";
import { isMissingTable } from "./data";

export const COMPETITOR_EVENTS_TABLE = "aitickets_competitor_events";
const LEADS_TABLE = "aitickets_leads";
/** Eventos por llamada al registro: cada uno hace ~10 consultas (~1,5 s desde Netlify a Supabase). */
export const IMPORT_CHUNK = 4;
const HORIZON_DAYS = 365;

type Item = Record<string, any>;
export type ImportTotals = { events_created: number; events_updated: number; events_unchanged: number; events_skipped: number; dates_added: number; errors: number };
const emptyTotals = (): ImportTotals => ({ events_created: 0, events_updated: 0, events_unchanged: 0, events_skipped: 0, dates_added: 0, errors: 0 });

/** Categoría del vigía de Passline (stand_up, comedia, teatro, musica, fiesta, otro) → taxonomía del mapa de mercado. */
const COMPETITOR_CATEGORY: Record<string, string> = { stand_up: "stand_up", comedia: "stand_up", teatro: "teatro", musica: "concierto", fiesta: "fiesta", otro: "otro" };

/** Último segmento de la URL del evento (id estable en la fuente). */
export function slugFromUrl(url: string): string | null {
    try {
        const parts = new URL(url).pathname.split("/").filter(Boolean);
        const last = parts[parts.length - 1];
        return last ? last.slice(0, 120) : null;
    } catch {
        return null;
    }
}

const clean = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : null);

/**
 * Un evento del vigía → ítem de register_external_events, o el motivo por el que no se puede registrar.
 * Lead productora → producer.lead_id; lead sala → la sala de la función + nota (los lugares no se enlazan a leads).
 */
export function competitorToExternal(row: any, lead: any | null, today: string): { item: Item } | { skip: string } {
    const name = clean(row.title, 200);
    if (!name) return { skip: "sin_nombre" };
    if (!row.event_date) return { skip: "sin_fecha" };
    const date = String(row.event_date).slice(0, 10);
    if (date < today || date > addDays(today, HORIZON_DAYS)) return { skip: "fuera_de_rango" };
    const city = clean(row.city, 80);
    if (!city) return { skip: "sin_ciudad" };
    const platform = /^[a-z0-9_.-]{2,40}$/.test(String(row.platform || "")) ? String(row.platform) : "passline";
    const url = /^https?:\/\//.test(String(row.url || "")) ? String(row.url).slice(0, 500) : null;
    const venue = clean(row.venue, 160);
    const producerName = clean(row.producer_name, 160);
    const isProducerLead = lead && lead.lead_type !== "venue";
    const item: Item = {
        name,
        category: COMPETITOR_CATEGORY[String(row.category)] || "otro",
        ticketing_platform: platform,
        source: platform,
        ...(url ? { ticketing_url: url, source_url: url } : {}),
        ...(url && slugFromUrl(url) ? { external_id: slugFromUrl(url) } : {}),
        ...(row.first_seen_at ? { announced_at: new Date(row.first_seen_at).toISOString() } : {}),
        dates: [{ date, city, ...(venue ? { venue: { name: venue, city } } : {}) }],
    };
    if (isProducerLead && clean(lead.org_name, 160)) item.producer = { name: clean(lead.org_name, 160), lead_id: lead.id };
    else if (producerName) item.producer = { name: producerName };
    if (lead && !isProducerLead) item.notes = `Lead sala: ${clean(lead.org_name, 120) || "?"} (${lead.id})`;
    return { item };
}

/**
 * Registra ítems en lotes de IMPORT_CHUNK hasta `deadline` (ms epoch). Devuelve los totales, los errores por ítem y
 * cuántos se procesaron (el que llama reenvía el resto). Los ítems inválidos cuentan como error sin cortar el lote.
 */
export async function importEventItems(supabase: any, items: Item[], { deadline = Date.now() + 7000, dryRun = false } = {}) {
    const totals = emptyTotals();
    const errors: { name: string | null; error: string }[] = [];
    let processed = 0;
    for (let i = 0; i < items.length; i += IMPORT_CHUNK) {
        if (Date.now() > deadline) break;
        const chunk = items.slice(i, i + IMPORT_CHUNK);
        try {
            const r: any = await importExternalEvents(supabase, { events: chunk, on_duplicate: "merge", dry_run: dryRun }, { purge: false });
            for (const k of Object.keys(totals) as (keyof ImportTotals)[]) totals[k] += Number(r[k]) || 0;
            for (const x of r.results || []) if (x.status === "error") errors.push({ name: x.name ?? null, error: String(x.error).slice(0, 200) });
        } catch (err: any) {
            // Un ítem que no pasa el esquema invalida el lote entero: se reintenta de a uno para no perder los buenos
            if (err?.code !== "invalid_input" || chunk.length === 1) {
                if (err?.code === "unavailable") throw err;
                totals.errors += chunk.length;
                errors.push(...chunk.map((c) => ({ name: c?.name ?? null, error: String(err?.message || err).slice(0, 200) })));
            } else {
                for (const one of chunk) {
                    const r1 = await importEventItems(supabase, [one], { deadline: Number.MAX_SAFE_INTEGER, dryRun });
                    for (const k of Object.keys(totals) as (keyof ImportTotals)[]) totals[k] += r1.totals[k];
                    errors.push(...r1.errors);
                }
            }
        }
        processed = Math.min(items.length, i + chunk.length);
    }
    if (!dryRun && (totals.events_created || totals.events_updated)) await purgeCacheTags([PANORAMA_PAGES_TAG]);
    return { totals, errors: errors.slice(0, 50), processed, remaining: items.length - processed };
}

/**
 * Pasa los eventos del vigía de Passline con fecha próxima a eventos externos, de a `limit` desde `offset` (orden por
 * fecha y url). Devuelve next_offset (null = terminó). Sin la tabla del vigía, no hace nada.
 */
export async function syncCompetitorEvents(supabase: any, { offset = 0, limit = 24, dryRun = false, deadline = Date.now() + 7000, today = todayChile() } = {}) {
    const { data: rows, error, count } = await supabase
        .from(COMPETITOR_EVENTS_TABLE)
        .select("id, platform, url, title, venue, city, event_date, category, producer_name, lead_id, first_seen_at", { count: "exact" })
        .gte("event_date", today)
        .lte("event_date", addDays(today, HORIZON_DAYS))
        .order("event_date", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + limit - 1);
    if (error) {
        if (isMissingTable(error)) return { total: 0, checked: 0, totals: emptyTotals(), skipped: {}, errors: [], next_offset: null, dry_run: dryRun };
        throw error;
    }
    const list = rows || [];
    const leadIds = [...new Set(list.map((r: any) => r.lead_id).filter(Boolean))];
    const leads = new Map<string, any>();
    if (leadIds.length) {
        const { data, error: lErr } = await supabase.from(LEADS_TABLE).select("id, org_name, lead_type, status").in("id", leadIds);
        if (lErr) throw lErr;
        for (const l of data || []) leads.set(String(l.id), l);
    }
    const skipped: Record<string, number> = {};
    const items: Item[] = [];
    const rowOf: number[] = [];
    list.forEach((row: any, index: number) => {
        const lead = row.lead_id ? leads.get(String(row.lead_id)) || null : null;
        const r = competitorToExternal(row, lead && lead.status !== "invalid" ? lead : null, today);
        if ("skip" in r) skipped[r.skip] = (skipped[r.skip] || 0) + 1;
        else {
            items.push(r.item);
            rowOf.push(index);
        }
    });
    const res = await importEventItems(supabase, items, { deadline, dryRun });
    // Si el plazo cortó, se retoma desde la fila del primer ítem que no alcanzó a registrarse
    const consumed = res.remaining === 0 ? list.length : rowOf[res.processed] ?? list.length;
    const end = offset + consumed;
    const nextOffset = res.remaining === 0 && (list.length < limit || end >= (count ?? 0)) ? null : end;
    return { total: count ?? list.length, checked: list.length, totals: res.totals, skipped, errors: res.errors, next_offset: nextOffset, dry_run: dryRun };
}
