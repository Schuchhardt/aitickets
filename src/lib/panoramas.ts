// Panoramas (/panoramas): la cara pública de los eventos externos (aitickets_external_events y sus funciones) que se
// registran desde el MCP de administración, y los comentarios de quienes fueron ("¿Fuiste?"), que llegan con un
// comprobante de asistencia y se publican solo cuando el admin los valida (moderate_panorama_reviews).
// Spec: docs/specs/panoramas.md.
//
// Lo público NUNCA trae notas, fuente interna, productora enlazada a un lead, correos ni comprobantes: solo las
// columnas de PUBLIC_EVENT_COLUMNS / PUBLIC_DATE_COLUMNS y los comentarios aprobados.
import { createHash } from "node:crypto";
import { fetchAll } from "./producer-api/tools/common";
import { addDays, dayOfWeek, MONTH_NAMES, WEEKDAY_NAMES } from "./market/calendar";
import { EVENT_DATES_TABLE, EXTERNAL_EVENTS_TABLE, isMissingTable, PRODUCERS_TABLE, VENUES_TABLE } from "./market/data";
import { CATEGORIES, cityInfo, cityLabel, isCategory, normalizeNiche, panoramaSlug, platformLabel, type Category } from "./market/taxonomy";

export { panoramaSlug };

export const PANORAMA_REVIEWS_TABLE = "aitickets_panorama_reviews";
export const PANORAMA_PROOFS_BUCKET = "aitickets-panorama-proofs";
export { PANORAMA_PAGES_TAG } from "./cdnCache";
export const PUBLIC_STATUSES = ["auto", "featured", "hidden"] as const;
export type PublicStatus = (typeof PUBLIC_STATUSES)[number];
export const REVIEW_STATUSES = ["pending", "approved", "rejected", "hidden"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const PANORAMAS_UNAVAILABLE = "Panoramas todavía no está disponible: falta aplicar la migración 202611270100_panoramas.sql.";
/** 5 MB: el cuerpo de una función síncrona de Netlify no pasa de ~6 MB (mismo límite que las fotos de reseñas). */
export const PROOF_MAX_BYTES = 5 * 1024 * 1024;
export const COMMENT_MIN = 15;
export const COMMENT_MAX = 1000;
export const NAME_MAX = 60;
/** Días después de la última función en que todavía se piden comentarios en el listado ("¿Fuiste?"). */
export const RECENT_DAYS = 21;
const HORIZON_DAYS = 240;
/** Un festival de varios días que empezó antes de hoy sigue vigente: se mira hasta 31 días hacia atrás. */
const LOOKBACK_DAYS = 31;

const PUBLIC_EVENT_COLUMNS =
    "id, name, category, niche, producer_id, ticketing_platform, ticketing_url, price_min, price_max, is_free, source_url, description, image_url, public_status, updated_at";
const PUBLIC_DATE_COLUMNS = "id, event_id, event_date, start_time, end_date, venue_id, city, city_key, commune, status, ticketing_url";

/** Tabla o columna que no existe todavía (deploy preview sin migrar). */
export const isPanoramaSchemaMissing = (err: any) => isMissingTable(err) || ["42703", "PGRST204"].includes(String(err?.code || ""));

// ---------------------------------------------------------------------------
// Categorías, nichos y URLs
// ---------------------------------------------------------------------------

/** Categoría del mapa de mercado → slug y nombre públicos (/panoramas/<slug>). */
export const CATEGORY_PUBLIC: Record<Category, { slug: string; name: string; singular: string }> = {
    concierto: { slug: "conciertos", name: "Conciertos", singular: "Concierto" },
    festival: { slug: "festivales", name: "Festivales", singular: "Festival" },
    fiesta: { slug: "fiestas", name: "Fiestas", singular: "Fiesta" },
    club: { slug: "clubes", name: "Clubes y DJ", singular: "Club" },
    stand_up: { slug: "stand-up", name: "Stand-up", singular: "Stand-up" },
    teatro: { slug: "teatro", name: "Teatro", singular: "Teatro" },
    danza: { slug: "danza", name: "Danza", singular: "Danza" },
    infantil: { slug: "infantil", name: "Infantil y familia", singular: "Infantil" },
    conferencia: { slug: "conferencias", name: "Conferencias", singular: "Conferencia" },
    taller: { slug: "talleres", name: "Talleres", singular: "Taller" },
    deportes: { slug: "deportes", name: "Deportes", singular: "Deportes" },
    feria: { slug: "ferias", name: "Ferias", singular: "Feria" },
    cine: { slug: "cine", name: "Cine", singular: "Cine" },
    otro: { slug: "otros", name: "Otros panoramas", singular: "Panorama" },
};
const CATEGORY_BY_SLUG = new Map(CATEGORIES.map((c) => [CATEGORY_PUBLIC[c].slug, c]));
export const categoryFromSlug = (slug: unknown): Category | null => CATEGORY_BY_SLUG.get(String(slug || "").toLowerCase()) ?? null;

const NICHE_LABELS: Record<string, string> = {
    stand_up: "Stand-up",
    hip_hop: "Hip hop",
    lgbtiq: "LGBTIQ+",
    inteligencia_artificial: "Inteligencia artificial",
    electronica: "Electrónica",
    clasica: "Clásica",
    tecnologia: "Tecnología",
    educacion: "Educación",
    diseno: "Diseño",
    gastronomica: "Gastronómica",
    gastronomico: "Gastronómico",
    ceramica: "Cerámica",
    fotografia: "Fotografía",
    musica: "Música",
    reggaeton: "Reggaetón",
    tematica: "Temática",
    open_mic: "Open mic",
    humor_politico: "Humor político",
    esports: "E-sports",
};
export function nicheLabel(niche: string | null | undefined): string | null {
    if (!niche) return null;
    if (NICHE_LABELS[niche]) return NICHE_LABELS[niche];
    const text = niche.replace(/_/g, " ");
    return text.charAt(0).toUpperCase() + text.slice(1);
}
/** "hip_hop" → "hip-hop" (URL) y de vuelta. */
export const nicheSlug = (niche: string) => niche.replace(/_/g, "-");
export const nicheFromSlug = (slug: unknown) => normalizeNiche(String(slug || "").replace(/-/g, " "));

/** Id del evento desde el slug ("…-42" o "42"); null si no trae uno. */
export function parsePanoramaSlug(slug: unknown): number | null {
    const m = /(?:^|-)(\d{1,12})$/.exec(String(slug || ""));
    if (!m) return null;
    const id = Number(m[1]);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}
export const panoramaPath = (name: unknown, id: number | string) => `/panoramas/evento/${panoramaSlug(name, id)}`;
export const categoryPath = (category: Category, niche?: string | null) =>
    `/panoramas/${CATEGORY_PUBLIC[category].slug}${niche ? `/${nicheSlug(niche)}` : ""}`;

// ---------------------------------------------------------------------------
// Fechas en español
// ---------------------------------------------------------------------------

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "2026-12-05" → "Sábado 5 de diciembre". */
export function longDate(date: string): string {
    const [, m, d] = date.split("-").map(Number);
    return capitalize(`${WEEKDAY_NAMES[dayOfWeek(date)]} ${d} de ${MONTH_NAMES[m - 1]}`);
}
/** "2026-12-05" → "sáb 5 dic". */
export function shortDate(date: string): string {
    const [, m, d] = date.split("-").map(Number);
    return `${WEEKDAY_NAMES[dayOfWeek(date)].slice(0, 3)} ${d} ${MONTH_NAMES[m - 1].slice(0, 3)}`;
}
const hhmm = (v: unknown) => (v ? String(v).slice(0, 5) : null);

// ---------------------------------------------------------------------------
// Modelo público
// ---------------------------------------------------------------------------

export type PublicPanoramaDate = {
    id: number;
    date: string;
    end_date: string | null;
    start_time: string | null;
    label: string;
    venue: string | null;
    commune: string | null;
    city: string | null;
    city_key: string | null;
    status: "scheduled" | "postponed" | "cancelled" | "completed";
    is_past: boolean;
    ticket_url: string | null;
};

export type PublicPanorama = {
    id: number;
    path: string;
    name: string;
    category: Category;
    category_name: string;
    category_path: string;
    niche: string | null;
    niche_label: string | null;
    niche_path: string | null;
    description: string | null;
    image_url: string | null;
    featured: boolean;
    producer: string | null;
    price: { min: number | null; max: number | null; is_free: boolean };
    link: { url: string; label: string; platform: string | null } | null;
    dates: PublicPanoramaDate[];
    /** Próxima función vigente (no cancelada); null si ya pasaron todas. */
    next: PublicPanoramaDate | null;
    /** Última función (para "¿Fuiste?"). */
    last: PublicPanoramaDate | null;
    cities: string[];
    city_keys: string[];
    /** Alguna función ya empezó: se pueden dejar comentarios. */
    has_started: boolean;
    is_listed: boolean;
    updated_at: string | null;
};

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const httpUrl = (v: unknown) => (typeof v === "string" && /^https?:\/\//i.test(v) ? v : null);

/** Texto del botón hacia el evento externo según la ticketera. */
function linkFor(e: any): PublicPanorama["link"] {
    const ticketUrl = httpUrl(e.ticketing_url);
    const sourceUrl = httpUrl(e.source_url);
    const platform: string | null = e.ticketing_platform ?? null;
    if (ticketUrl) {
        if (platform === "aitickets") return { url: ticketUrl, label: "Comprar entradas", platform };
        if (platform && platform !== "none" && platform !== "own_site") return { url: ticketUrl, label: `Entradas en ${platformLabel(platform)}`, platform };
        return { url: ticketUrl, label: e.is_free ? "Ver el evento" : "Ver entradas", platform };
    }
    if (sourceUrl) return { url: sourceUrl, label: platform === "none" ? "Ver cómo conseguir entradas" : "Ver el evento", platform };
    return null;
}

export function toPublicDate(d: any, venue: any, today: string): PublicPanoramaDate {
    const cityKey = d.city_key || venue?.city_key || null;
    const startTime = hhmm(d.start_time);
    const lastDay = d.end_date || d.event_date;
    const status = d.status === "postponed" || d.status === "cancelled" || d.status === "completed" ? d.status : "scheduled";
    return {
        id: Number(d.id),
        date: d.event_date,
        end_date: d.end_date || null,
        start_time: startTime,
        label: `${longDate(d.event_date)}${d.end_date && d.end_date !== d.event_date ? ` al ${longDate(d.end_date).toLowerCase()}` : ""}${startTime ? ` · ${startTime}` : ""}`,
        venue: venue?.name || null,
        commune: d.commune || venue?.commune || null,
        // La ciudad o comuna tal como se registró ("Providencia", "Valparaíso"); si falta, la del área (city_key)
        city: d.city || venue?.city || shortCityLabel(cityKey),
        city_key: cityKey,
        status,
        is_past: lastDay < today,
        ticket_url: httpUrl(d.ticketing_url),
    };
}

/** Etiqueta corta de un área ("Gran Valparaíso (Viña, Valparaíso, Concón…)" → "Gran Valparaíso"). */
export const shortCityLabel = (cityKey: string | null | undefined) => (cityKey ? (cityLabel(cityKey) || cityKey).replace(/\s*\(.*\)\s*$/, "") : null);

/** Evento externo → panorama público. `dates` = todas sus funciones. */
export function toPublicPanorama(e: any, dates: any[], venues: Map<number, any>, producers: Map<number, any>, today: string): PublicPanorama {
    const category: Category = isCategory(e.category) ? e.category : "otro";
    const pub = [...dates]
        .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)) || String(a.start_time || "").localeCompare(String(b.start_time || "")))
        .map((d) => toPublicDate(d, d.venue_id ? venues.get(Number(d.venue_id)) : null, today));
    const live = pub.filter((d) => d.status !== "cancelled");
    const next = live.find((d) => !d.is_past) || null;
    const last = live.length ? live[live.length - 1] : null;
    const cityKeys = [...new Set(pub.map((d) => d.city_key).filter(Boolean))] as string[];
    const producer = e.producer_id ? producers.get(Number(e.producer_id)) : null;
    const priceMin = num(e.price_min);
    const priceMax = num(e.price_max);
    const niche = e.niche || null;
    const status: PublicStatus = PUBLIC_STATUSES.includes(e.public_status) ? e.public_status : "auto";
    return {
        id: Number(e.id),
        path: panoramaPath(e.name, e.id),
        name: e.name,
        category,
        category_name: CATEGORY_PUBLIC[category].name,
        category_path: categoryPath(category),
        niche,
        niche_label: nicheLabel(niche),
        niche_path: niche ? categoryPath(category, niche) : null,
        description: e.description || null,
        image_url: typeof e.image_url === "string" && e.image_url.startsWith("https://") ? e.image_url : null,
        featured: status === "featured",
        producer: producer?.name || null,
        price: { min: priceMin, max: priceMax, is_free: e.is_free === true || (priceMax === 0 && priceMin === 0) },
        link: linkFor(e),
        dates: pub,
        next,
        last,
        cities: cityKeys.map((k) => shortCityLabel(k)!),
        city_keys: cityKeys,
        has_started: live.some((d) => d.date <= today),
        is_listed: status !== "hidden" && Boolean(next),
        updated_at: e.updated_at || null,
    };
}

/** "$12.000", "$12.000 – $25.000", "Gratis" o null. */
export function priceLabel(p: PublicPanorama["price"]): string | null {
    if (p.is_free) return "Gratis";
    const fmt = (n: number) => `$${n.toLocaleString("es-CL")}`;
    if (p.min != null && p.max != null && p.max > p.min) return `${fmt(p.min)} – ${fmt(p.max)}`;
    const one = p.min ?? p.max;
    return one != null ? (one === 0 ? "Gratis" : `Desde ${fmt(one)}`) : null;
}

// ---------------------------------------------------------------------------
// Carga (service role, solo columnas públicas)
// ---------------------------------------------------------------------------

async function lookups(supabase: any, venueIds: number[], producerIds: number[]) {
    const [venues, producers] = await Promise.all([
        venueIds.length
            ? supabase.from(VENUES_TABLE).select("id, name, commune, city, city_key").in("id", venueIds)
            : Promise.resolve({ data: [], error: null }),
        producerIds.length ? supabase.from(PRODUCERS_TABLE).select("id, name").in("id", producerIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (venues.error) throw venues.error;
    if (producers.error) throw producers.error;
    return {
        venues: new Map<number, any>((venues.data || []).map((v: any) => [Number(v.id), v])),
        producers: new Map<number, any>((producers.data || []).map((p: any) => [Number(p.id), p])),
    };
}
const ids = (values: unknown[]) => [...new Set(values.map(Number).filter((v) => Number.isSafeInteger(v) && v > 0))];

export type PanoramaFeed = {
    /** Con una función vigente, ordenados por la próxima (los destacados también están aquí). */
    upcoming: PublicPanorama[];
    /** Su última función fue en los últimos RECENT_DAYS días y no tienen otra: se pide "¿Fuiste?". */
    recent: PublicPanorama[];
};

/** Todos los panoramas públicos vigentes y recientes. null = la migración no está aplicada. */
export async function loadPanoramaFeed(supabase: any, today: string): Promise<PanoramaFeed | null> {
    try {
        const inWindow = await fetchAll<any>(
            () =>
                supabase
                    .from(EVENT_DATES_TABLE)
                    .select("event_id")
                    .gte("event_date", addDays(today, -Math.max(LOOKBACK_DAYS, RECENT_DAYS)))
                    .lte("event_date", addDays(today, HORIZON_DAYS))
                    .order("id", { ascending: true }),
            { max: 20000 },
        );
        const eventIds = ids(inWindow.map((d) => d.event_id));
        if (!eventIds.length) return { upcoming: [], recent: [] };
        const events: any[] = [];
        const dates: any[] = [];
        for (let i = 0; i < eventIds.length; i += 150) {
            const chunk = eventIds.slice(i, i + 150);
            const [ev, dt] = await Promise.all([
                fetchAll<any>(() => supabase.from(EXTERNAL_EVENTS_TABLE).select(PUBLIC_EVENT_COLUMNS).in("id", chunk).neq("public_status", "hidden").order("id", { ascending: true })),
                fetchAll<any>(() => supabase.from(EVENT_DATES_TABLE).select(PUBLIC_DATE_COLUMNS).in("event_id", chunk).order("id", { ascending: true }), { max: 50000 }),
            ]);
            events.push(...ev);
            dates.push(...dt);
        }
        const { venues, producers } = await lookups(supabase, ids(dates.map((d) => d.venue_id)), ids(events.map((e) => e.producer_id)));
        const byEvent = new Map<number, any[]>();
        for (const d of dates) byEvent.set(Number(d.event_id), [...(byEvent.get(Number(d.event_id)) || []), d]);
        const all = events.map((e) => toPublicPanorama(e, byEvent.get(Number(e.id)) || [], venues, producers, today));
        const upcoming = all
            .filter((p) => p.is_listed)
            .sort((a, b) => a.next!.date.localeCompare(b.next!.date) || String(a.next!.start_time || "99").localeCompare(String(b.next!.start_time || "99")) || a.id - b.id);
        const since = addDays(today, -RECENT_DAYS);
        const recent = all
            .filter((p) => !p.next && p.last && (p.last.end_date || p.last.date) >= since)
            .sort((a, b) => (b.last!.end_date || b.last!.date).localeCompare(a.last!.end_date || a.last!.date));
        return { upcoming, recent };
    } catch (err: any) {
        if (isPanoramaSchemaMissing(err)) return null;
        throw err;
    }
}

export type PanoramaFilters = { category?: Category | null; niche?: string | null; city?: string | null };

export function filterPanoramas(list: PublicPanorama[], f: PanoramaFilters): PublicPanorama[] {
    const cityKey = f.city ? cityInfo(f.city).key : null;
    return list.filter(
        (p) => (!f.category || p.category === f.category) && (!f.niche || p.niche === f.niche) && (!cityKey || p.city_keys.includes(cityKey)),
    );
}

/** Conteos para los filtros: categorías, nichos de una categoría y ciudades. */
export function facets(list: PublicPanorama[], category?: Category | null) {
    const count = (keys: (string | null)[]) => {
        const m = new Map<string, number>();
        for (const k of keys) if (k) m.set(k, (m.get(k) || 0) + 1);
        return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    return {
        categories: count(list.map((p) => p.category)).map(([key, n]) => ({ key: key as Category, name: CATEGORY_PUBLIC[key as Category].name, path: categoryPath(key as Category), count: n })),
        niches: count(list.filter((p) => !category || p.category === category).map((p) => p.niche)).map(([key, n]) => ({
            key,
            label: nicheLabel(key)!,
            path: category ? categoryPath(category, key) : null,
            count: n,
        })),
        cities: count(list.flatMap((p) => p.city_keys)).map(([key, n]) => ({ key, label: shortCityLabel(key)!, count: n })),
    };
}

/** Agrupa por la fecha de la próxima función ("Sábado 5 de diciembre"). */
export function groupByNextDate(list: PublicPanorama[], today: string) {
    const groups: { date: string; label: string; items: PublicPanorama[] }[] = [];
    for (const p of list) {
        const date = p.next!.date < today ? today : p.next!.date;
        let g = groups[groups.length - 1];
        if (!g || g.date !== date) {
            g = { date, label: date === today ? "Hoy" : date === addDays(today, 1) ? "Mañana" : longDate(date), items: [] };
            groups.push(g);
        }
        g.items.push(p);
    }
    return groups;
}

export type PublicReview = { id: string; rating: number; comment: string; name: string; function_label: string | null; date: string };
export type PanoramaDetail = { panorama: PublicPanorama; reviews: PublicReview[]; rating: { average: number | null; count: number } };

/** Detalle público de un evento externo (también si ya pasó, para los comentarios). null = no existe u oculto. */
export async function loadPanoramaDetail(supabase: any, id: number, today: string): Promise<PanoramaDetail | null> {
    try {
        const { data: e, error } = await supabase.from(EXTERNAL_EVENTS_TABLE).select(PUBLIC_EVENT_COLUMNS).eq("id", id).maybeSingle();
        if (error) throw error;
        if (!e || e.public_status === "hidden") return null;
        const { data: dates, error: dErr } = await supabase.from(EVENT_DATES_TABLE).select(PUBLIC_DATE_COLUMNS).eq("event_id", id).order("event_date", { ascending: true });
        if (dErr) throw dErr;
        if (!dates?.length) return null;
        const { venues, producers } = await lookups(supabase, ids(dates.map((d: any) => d.venue_id)), ids([e.producer_id]));
        const panorama = toPublicPanorama(e, dates, venues, producers, today);
        const { reviews, rating } = await loadApprovedReviews(supabase, panorama);
        return { panorama, reviews, rating };
    } catch (err: any) {
        if (isPanoramaSchemaMissing(err)) return null;
        throw err;
    }
}

async function loadApprovedReviews(supabase: any, panorama: PublicPanorama) {
    const { data, error } = await supabase
        .from(PANORAMA_REVIEWS_TABLE)
        .select("id, rating, comment, public_comment, display_name, event_date_id, moderated_at, created_at")
        .eq("event_id", panorama.id)
        .eq("status", "approved")
        .order("moderated_at", { ascending: false })
        .limit(200);
    if (error) {
        if (isPanoramaSchemaMissing(error)) return { reviews: [], rating: { average: null, count: 0 } };
        throw error;
    }
    const rows = data || [];
    const byDate = new Map(panorama.dates.map((d) => [d.id, d]));
    const reviews: PublicReview[] = rows.map((r: any) => {
        const d = r.event_date_id ? byDate.get(Number(r.event_date_id)) : null;
        return {
            id: String(r.id),
            rating: Number(r.rating),
            comment: String(r.public_comment || r.comment),
            name: String(r.display_name || "").trim() || "Asistente verificado",
            function_label: d ? `${longDate(d.date)}${d.venue ? ` · ${d.venue}` : ""}` : null,
            date: String(r.moderated_at || r.created_at),
        };
    });
    const average = rows.length ? Math.round((rows.reduce((s: number, r: any) => s + Number(r.rating), 0) / rows.length) * 10) / 10 : null;
    return { reviews, rating: { average, count: rows.length } };
}

// ---------------------------------------------------------------------------
// Comprobantes de asistencia (pantallazo, PDF o correo .eml)
// ---------------------------------------------------------------------------

export type ProofKind = "image" | "pdf" | "email";
export type SniffedProof = { kind: ProofKind; contentType: string; ext: string };

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);
const EMAIL_HEADER_RE = /^(from|to|subject|date|received|return-path|message-id|mime-version|delivered-to|reply-to|content-type|dkim-signature|x-[a-z0-9-]+):/gim;

/** Tipo real del archivo por sus primeros bytes (nunca por la extensión ni el Content-Type del navegador). */
export function sniffProof(buf: Buffer): SniffedProof | null {
    if (!buf || buf.length < 12) return null;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: "image", contentType: "image/jpeg", ext: "jpg" };
    if (buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return { kind: "image", contentType: "image/png", ext: "png" };
    if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return { kind: "image", contentType: "image/webp", ext: "webp" };
    if (buf.toString("ascii", 4, 8) === "ftyp" && HEIF_BRANDS.has(buf.toString("ascii", 8, 12))) return { kind: "image", contentType: "image/heic", ext: "heic" };
    if (buf.subarray(0, 1024).includes(Buffer.from("%PDF-"))) return { kind: "pdf", contentType: "application/pdf", ext: "pdf" };
    // Correo exportado (.eml): texto con cabeceras RFC 5322 al inicio
    const head = buf.subarray(0, 16 * 1024);
    if (head.includes(0)) return null;
    const text = head.toString("utf8");
    const headers = new Set([...text.matchAll(EMAIL_HEADER_RE)].map((m) => m[1].toLowerCase().replace(/^x-.*/, "x-")));
    if (headers.has("from") && headers.size >= 3) return { kind: "email", contentType: "message/rfc822", ext: "eml" };
    return null;
}

export const sha256Hex = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** Hash de la IP con sal (anti abuso sin guardar la IP). */
export function hashIp(ip: string): string {
    const salt = process.env.INTERNAL_API_SECRET || "aitickets";
    return sha256Hex(`${salt}:${ip}`);
}

/** Decodifica palabras codificadas RFC 2047 (=?UTF-8?B?…?= / =?ISO-8859-1?Q?…?=). */
export function decodeMimeWords(value: string): string {
    return value.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=(\s+(?==\?))?/g, (_m, charset: string, enc: string, data: string) => {
        try {
            const bytes =
                enc.toUpperCase() === "B"
                    ? Buffer.from(data, "base64")
                    : Buffer.from(data.replace(/_/g, " ").replace(/=([0-9a-fA-F]{2})/g, (_x, h) => String.fromCharCode(parseInt(h, 16))), "latin1");
            return new TextDecoder(charset.toLowerCase().replace(/^latin-?1$/, "iso-8859-1")).decode(bytes);
        } catch {
            return data;
        }
    });
}

function decodeBody(body: string, encoding: string, charset: string): string {
    let bytes: Buffer;
    if (encoding === "base64") bytes = Buffer.from(body.replace(/\s+/g, ""), "base64");
    else if (encoding === "quoted-printable")
        bytes = Buffer.from(body.replace(/=\r?\n/g, "").replace(/=([0-9a-fA-F]{2})/g, (_x, h) => String.fromCharCode(parseInt(h, 16))), "latin1");
    else bytes = Buffer.from(body, "utf8");
    try {
        return new TextDecoder(charset || "utf-8").decode(bytes);
    } catch {
        return bytes.toString("utf8");
    }
}

const htmlToText = (html: string) =>
    html
        .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
        .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n+/g, "\n")
        .trim();

function splitHeaders(raw: string): { headers: Record<string, string>; body: string } {
    const sep = raw.search(/\r?\n\r?\n/);
    const headPart = sep >= 0 ? raw.slice(0, sep) : raw;
    const body = sep >= 0 ? raw.slice(sep).replace(/^\r?\n\r?\n/, "") : "";
    const headers: Record<string, string> = {};
    for (const line of headPart.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
        const i = line.indexOf(":");
        if (i <= 0) continue;
        const key = line.slice(0, i).trim().toLowerCase();
        if (!(key in headers)) headers[key] = line.slice(i + 1).trim();
    }
    return { headers, body };
}
const param = (header: string | undefined, name: string) => new RegExp(`${name}="?([^";]+)"?`, "i").exec(header || "")?.[1] || "";

/** Primer texto legible de un correo (text/plain, o text/html convertido), recorriendo multipart. */
function emailText(raw: string, depth = 0): string {
    const { headers, body } = splitHeaders(raw);
    const type = (headers["content-type"] || "text/plain").toLowerCase();
    const encoding = (headers["content-transfer-encoding"] || "").toLowerCase().trim();
    if (type.startsWith("multipart/") && depth < 4) {
        const boundary = param(headers["content-type"], "boundary");
        if (!boundary) return "";
        const parts = body.split(`--${boundary}`).slice(1).filter((p) => !p.startsWith("--"));
        const texts = parts.map((p) => ({ p, t: splitHeaders(p.replace(/^\r?\n/, "")).headers["content-type"]?.toLowerCase() || "text/plain" }));
        const pick = texts.find((x) => x.t.startsWith("text/plain")) || texts.find((x) => x.t.startsWith("text/html")) || texts.find((x) => x.t.startsWith("multipart/"));
        return pick ? emailText(pick.p.replace(/^\r?\n/, ""), depth + 1) : "";
    }
    const text = decodeBody(body, encoding, param(headers["content-type"], "charset"));
    return type.startsWith("text/html") ? htmlToText(text) : text.trim();
}

/** Vista previa de un correo .eml para validarlo desde el MCP sin descargarlo: cabeceras y el inicio del texto. */
export function emailPreview(buf: Buffer, maxChars = 1500) {
    const raw = buf.subarray(0, 512 * 1024).toString("utf8");
    const { headers } = splitHeaders(raw);
    const h = (k: string) => (headers[k] ? decodeMimeWords(headers[k]).slice(0, 300) : null);
    let text = "";
    try {
        text = emailText(raw).replace(/\s+\n/g, "\n").slice(0, maxChars);
    } catch {
        text = "";
    }
    return { from: h("from"), to: h("to"), subject: h("subject"), date: h("date"), text };
}

/** Ruta del comprobante en el bucket privado: sin datos personales. */
export const proofPath = (eventId: number, ext: string) => `${eventId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
