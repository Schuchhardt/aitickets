// Motor de cadencia de las historias automáticas (docs/specs/historias-automaticas.md): qué día y a qué hora sale cada
// historia y cada post de feed. Funciones puras (sin BD): las usa src/lib/socialSeries.ts al aprobar, reanudar y
// replanificar, y la vista previa de la tarjeta del panel.
//
// - La frecuencia sube al acercarse el evento: cada 3 días cuando falta mucho, diario la última semana (D-7 a D-1) y
//   una historia el mismo día (D-0). Se calcula HACIA ATRÁS desde el evento, así la transición a diario siempre cae en
//   D-7 sin importar qué día se activó.
// - Posts de feed: uno diario de D-7 a D-1 (si la serie los tiene activados).
// - Hora: la hora pico de visitas del evento (o de la organización) con al menos 50 visitas; si no, 19:30. D-0 sale
//   a las 09:00 y siempre al menos 3 horas antes del inicio.
// - Las bandas y horas son configuración (aitickets_platform_settings 'social_series_cadence'), no constantes.
// - Facebook y TikTok usan los mismos días y horas (expandNetworkSlots), más un reel si el evento tiene video.
import { addDays } from "./eventAnalytics";
import { localDay } from "./producer-api/tools/common";
import { santiagoToDate } from "../pages/api/_lib/server-utils";

export type CadenceConfig = {
    /** Desde cuántos días antes la historia es diaria (D-7). */
    daily_from_days: number;
    /** Antes de la banda diaria: una historia cada N días. */
    sparse_every_days: number;
    /** Primer día de la banda espaciada (D-10: deja D-8 y D-9 libres para que el salto a diario caiga en D-7). */
    sparse_start_days: number;
    /** Posts de feed de D-<from> a D-<to>. */
    feed_posts_from_days: number;
    feed_posts_to_days: number;
    /** Hora por defecto (HH:MM, Chile) si no hay suficientes visitas para saber la hora pico. */
    default_time: string;
    /** Hora de la historia del día del evento. */
    event_day_time: string;
    /** La historia de D-0 sale al menos estas horas antes del inicio. */
    min_hours_before_start: number;
    /** Visitas mínimas para usar la hora pico. */
    peak_min_visits: number;
    /** Cuánto antes de publicar se renderiza la pieza y se programa en Zernio. */
    lead_minutes: number;
    /** Escasez real: se muestra "Quedan N entradas" bajo este porcentaje disponible. */
    scarcity_threshold_pct: number;
};

/** Palabra clave por defecto del DM con el link de compra. Vive aquí (sin dependencias de servidor) para que la
 *  landing de stand-up la muestre sin importar socialSeries.ts; socialSeries.ts la reexporta. */
export const DEFAULT_KEYWORD = "ENTRADAS";

export const DEFAULT_CADENCE: CadenceConfig = Object.freeze({
    daily_from_days: 7,
    sparse_every_days: 3,
    sparse_start_days: 10,
    feed_posts_from_days: 7,
    feed_posts_to_days: 1,
    default_time: "19:30",
    event_day_time: "09:00",
    min_hours_before_start: 3,
    peak_min_visits: 50,
    lead_minutes: 120,
    scarcity_threshold_pct: 30,
});

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Hora pico usable: ni de madrugada ni pasada la medianoche. */
const PEAK_HOUR_RANGE = { min: 9, max: 22 };
/** Ventana de horas máxima para planificar: más lejos no se publica nada (eventos a meses). */
export const MAX_PLAN_DAYS = 120;

const int = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};
const time = (v: unknown, fallback: string) => (typeof v === "string" && TIME_RE.test(v) ? v : fallback);

/** Configuración válida a partir de lo guardado (los valores inválidos o ausentes toman el valor por defecto). */
export function normalizeCadence(raw: unknown): CadenceConfig {
    const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const d = DEFAULT_CADENCE;
    const daily = int(r.daily_from_days, 0, 30, d.daily_from_days);
    const cfg: CadenceConfig = {
        daily_from_days: daily,
        sparse_every_days: int(r.sparse_every_days, 1, 14, d.sparse_every_days),
        sparse_start_days: int(r.sparse_start_days, daily + 1, 60, Math.max(d.sparse_start_days, daily + 1)),
        feed_posts_from_days: int(r.feed_posts_from_days, 0, 30, d.feed_posts_from_days),
        feed_posts_to_days: int(r.feed_posts_to_days, 0, 30, d.feed_posts_to_days),
        default_time: time(r.default_time, d.default_time),
        event_day_time: time(r.event_day_time, d.event_day_time),
        min_hours_before_start: int(r.min_hours_before_start, 1, 12, d.min_hours_before_start),
        peak_min_visits: int(r.peak_min_visits, 0, 100000, d.peak_min_visits),
        lead_minutes: int(r.lead_minutes, 30, 360, d.lead_minutes),
        scarcity_threshold_pct: int(r.scarcity_threshold_pct, 1, 100, d.scarcity_threshold_pct),
    };
    if (cfg.feed_posts_to_days > cfg.feed_posts_from_days) cfg.feed_posts_to_days = cfg.feed_posts_from_days;
    return cfg;
}

/**
 * Hora de publicación: la hora (en punto) con más visitas si hay al menos peak_min_visits, acotada entre las 09:00 y
 * las 22:00; si no, default_time. `visitHours` = hora local (0-23) de cada visita.
 */
export function choosePublishTime(visitHours: number[], config: CadenceConfig = DEFAULT_CADENCE): { time: string; source: "peak" | "default"; visits: number } {
    if (visitHours.length < config.peak_min_visits || !visitHours.length) return { time: config.default_time, source: "default", visits: visitHours.length };
    const counts = new Array(24).fill(0);
    for (const h of visitHours) if (Number.isInteger(h) && h >= 0 && h < 24) counts[h]++;
    let best = -1;
    for (let h = PEAK_HOUR_RANGE.min; h <= PEAK_HOUR_RANGE.max; h++) if (best < 0 || counts[h] > counts[best] || (counts[h] === counts[best] && h > best)) best = h;
    if (counts[best] === 0) return { time: config.default_time, source: "default", visits: visitHours.length };
    return { time: `${String(best).padStart(2, "0")}:00`, source: "peak", visits: visitHours.length };
}

export type Stage = "far" | "week" | "tomorrow" | "today";

/** Etapa de una pieza según los días que faltan (define el mensaje). */
export const stageOf = (daysToEvent: number): Stage => (daysToEvent <= 0 ? "today" : daysToEvent === 1 ? "tomorrow" : daysToEvent <= 7 ? "week" : "far");

export type PlannedSlot = {
    kind: "story" | "feed_post";
    variant: "countdown";
    days_to_event: number;
    /** Día local (Chile) del slot. */
    local_date: string;
    publish_at: string;
};

/** Días calendario (Chile) entre dos instantes. */
export function daysBetweenLocal(from: Date, to: Date): number {
    const a = Date.parse(`${localDay(from)}T00:00:00Z`);
    const b = Date.parse(`${localDay(to)}T00:00:00Z`);
    return Math.round((b - a) / 86400000);
}

const MIN_LEAD_MS = 10 * 60_000;
const ROUND_MS = 5 * 60_000;

/**
 * Slots de una serie para la función que empieza en `anchorStart`, desde `now`. Los slots que ya pasaron no se
 * incluyen. A menos de 24 h del evento solo queda la historia de D-0 (que sale cuanto antes si su hora ya pasó y aún
 * falta más de una hora para el inicio).
 */
export function planSlots({
    anchorStart,
    now = new Date(),
    publishTime,
    feedPosts,
    config = DEFAULT_CADENCE,
}: {
    anchorStart: Date;
    now?: Date;
    publishTime: string;
    feedPosts: boolean;
    config?: CadenceConfig;
}): PlannedSlot[] {
    if (!(anchorStart instanceof Date) || Number.isNaN(anchorStart.getTime()) || anchorStart.getTime() <= now.getTime()) return [];
    const eventDay = localDay(anchorStart);
    const totalDays = daysBetweenLocal(now, anchorStart);
    const startMs = anchorStart.getTime();
    const nowMs = now.getTime();
    const lastMoment = startMs - config.min_hours_before_start * 3600_000;

    const days: number[] = [];
    if (startMs - nowMs < 24 * 3600_000) days.push(0);
    else {
        for (let d = 0; d <= Math.min(config.daily_from_days, totalDays); d++) days.push(d);
        for (let d = config.sparse_start_days; d <= Math.min(totalDays, MAX_PLAN_DAYS); d += config.sparse_every_days) days.push(d);
    }

    const out: PlannedSlot[] = [];
    for (const d of days.sort((a, b) => b - a)) {
        const date = addDays(eventDay, -d);
        let at: number;
        if (d === 0) {
            const morning = santiagoToDate(date, config.event_day_time)!.getTime();
            at = Math.min(morning, lastMoment);
            // La hora de D-0 ya pasó: sale cuanto antes si todavía falta más de una hora para el inicio
            if (at < nowMs + MIN_LEAD_MS) {
                const asap = Math.ceil((nowMs + 15 * 60_000) / ROUND_MS) * ROUND_MS;
                if (asap > startMs - 3600_000) continue;
                at = asap;
            }
        } else {
            at = santiagoToDate(date, publishTime)!.getTime();
            if (at < nowMs + MIN_LEAD_MS) continue;
        }
        const publishAt = new Date(at).toISOString();
        out.push({ kind: "story", variant: "countdown", days_to_event: d, local_date: date, publish_at: publishAt });
        if (feedPosts && d >= config.feed_posts_to_days && d <= config.feed_posts_from_days && d > 0) {
            out.push({ kind: "feed_post", variant: "countdown", days_to_event: d, local_date: date, publish_at: publishAt });
        }
    }
    return out.sort((a, b) => a.publish_at.localeCompare(b.publish_at) || (a.kind === "feed_post" ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Redes: la misma cadencia en Facebook y TikTok, y el reel
// ---------------------------------------------------------------------------

export type SeriesPlatform = "instagram" | "facebook" | "tiktok";
export const SERIES_PLATFORMS: readonly SeriesPlatform[] = ["instagram", "facebook", "tiktok"];
export const EXTRA_NETWORKS = ["facebook", "tiktok"] as const;
export type ExtraNetwork = (typeof EXTRA_NETWORKS)[number];

export type NetworkSlot = Omit<PlannedSlot, "kind"> & { platform: SeriesPlatform; kind: "story" | "feed_post" | "reel" };

/** El reel sale el día con historia más cercano a D-3 (en la última semana). */
export const REEL_DAYS = 3;

/** Día del reel entre los slots planificados (null si no hay ninguno en la banda diaria). */
export function reelSlot(slots: PlannedSlot[], config: CadenceConfig = DEFAULT_CADENCE): PlannedSlot | null {
    const candidates = slots.filter((s) => s.kind === "story" && s.days_to_event >= 1 && s.days_to_event <= Math.max(1, config.daily_from_days));
    candidates.sort((a, b) => Math.abs(a.days_to_event - REEL_DAYS) - Math.abs(b.days_to_event - REEL_DAYS) || b.days_to_event - a.days_to_event);
    return candidates[0] || null;
}

/**
 * Reparte el plan de Instagram entre las redes activas, con los mismos días y horas:
 * - Instagram: todo (historias y posts de feed).
 * - Facebook (página): las mismas historias y posts.
 * - TikTok: no tiene historias; un post de foto (formato vertical) cada día de la banda diaria (D-7 a D-0).
 * - Reel (si hay video): un día, en cada red activa; ese día TikTok publica el video en vez de la foto.
 */
export function expandNetworkSlots(
    slots: PlannedSlot[],
    { platforms, reel, config = DEFAULT_CADENCE }: { platforms: SeriesPlatform[]; reel: boolean; config?: CadenceConfig },
): NetworkSlot[] {
    const on = new Set(platforms);
    const reelDay = reel ? reelSlot(slots, config) : null;
    const out: NetworkSlot[] = [];
    for (const s of slots) {
        if (on.has("instagram")) out.push({ ...s, platform: "instagram" });
        if (on.has("facebook")) out.push({ ...s, platform: "facebook" });
        if (on.has("tiktok") && s.kind === "story" && s.days_to_event <= config.daily_from_days && s !== reelDay) out.push({ ...s, kind: "feed_post", platform: "tiktok" });
    }
    if (reelDay) for (const p of SERIES_PLATFORMS) if (on.has(p)) out.push({ ...reelDay, kind: "reel", platform: p });
    return out.sort((a, b) => a.publish_at.localeCompare(b.publish_at) || SERIES_PLATFORMS.indexOf(a.platform) - SERIES_PLATFORMS.indexOf(b.platform));
}

export type FunctionDate = { date: string; start_time: string | null };

/**
 * Inicio de la próxima función (la que aún no empieza), o null si ya pasaron todas. Con funciones en event_dates se
 * usa la más próxima; si no hay, events.start_date.
 */
export function nextFunctionStart(dates: FunctionDate[], eventStart: string | null, now = new Date()): Date | null {
    const starts = (dates || [])
        .map((d) => santiagoToDate(String(d.date).slice(0, 10), d.start_time ? String(d.start_time).slice(0, 5) : "00:00"))
        .filter((d): d is Date => !!d && d.getTime() > now.getTime())
        .sort((a, b) => a.getTime() - b.getTime());
    if (starts.length) return starts[0];
    if (!dates?.length && eventStart) {
        const s = new Date(eventStart);
        return s.getTime() > now.getTime() ? s : null;
    }
    return null;
}
