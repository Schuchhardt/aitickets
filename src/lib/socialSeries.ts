// Historias y posts automáticos en Instagram (docs/specs/historias-automaticas.md). El productor aprueba una serie una
// vez y AI Tickets publica sola hasta el día del evento, con el link entregado por DM automático (Zernio).
//
// Reparto: Zernio publica y reintenta; AI Tickets decide qué y cuándo (socialSeriesCadence.ts) y genera la imagen
// (socialSeriesRender.ts). Nada se manda a Zernio al aprobar: el job (runSeriesJobs, cada 15 min desde la función
// programada social-series-dispatch) toma los slots que publican en las próximas ~2 h, renderiza con los datos
// vigentes (cuenta regresiva y entradas que quedan) y crea el post programado en Zernio. Así pausar o cancelar no
// requiere borrar nada lejano.
//
// Cortes (regla: nunca publicar algo que ya no sea cierto), los revisa reconcileSeries en cada pasada:
//   evento cancelado/despublicado → serie cancelada; cambio de fecha → slots futuros recalculados; agotado → se
//   detiene (y una historia "agotado" si el productor la activó, DM "agotado"); Instagram desconectado → pausa y
//   correo, y al reconectar reanuda desde hoy; después de la última función → completed.
//
// DM: una automatización story_reply por cuenta de Instagram (compartida por sus series vivas: responde con el evento
// más próximo y la página de la organización) + una automatización de comentarios por cada post de feed. Los links
// llevan ref=ig-story-dm / ig-post-dm, así las ventas aparecen como canal propio en la analítica del evento.
//
// Redes extra (por evento, columna networks): Facebook (página) y TikTok publican con la misma cadencia, cada pieza
// en su propia fila de slots (platform), así una red que falla o se desconecta no frena a las otras: sus pendientes se
// omiten, la tarjeta lo avisa y al reconectarla se retoma desde hoy. Instagram es la base (DM por historias).
//   Facebook: historias de página (sin DM por respuesta: la pieza dice dónde comprar) y posts con el link en el texto
//             y DM por Messenger a quien comente la palabra clave (fb-post-dm, link fb-serie).
//   TikTok:   un post de foto vertical (photo post de Zernio) cada día de la última semana, con el link en la
//             descripción (tiktok-serie; TikTok no lo hace clickeable).
//   Reel:     si el evento tiene un video vertical de 3 a 60 s (portada o galería), sale como reel unos días antes
//             en cada red activa (en TikTok, como video). AI Tickets no genera video desde el afiche: no hay un
//             codificador de video que quepa en las funciones (sin ffmpeg).
import { getSupabaseAdmin } from "./auth-helpers";
import { serverEnv, notifySlack } from "../pages/api/_lib/server-utils";
import { fetchAll, localDay, localDateTime } from "./producer-api/tools/common";
import { eventCapacity, localHour } from "./eventAnalytics";
import { buildEventContext, EVENT_CONTEXT_SELECT, htmlToPlainText } from "./marketing";
import { generateSeriesCaption, isTextGenerationConfigured } from "./aiText";
import { fetchPublic } from "./safe-fetch";
import { IMAGE_BUCKET } from "./imageStorage";
import { isCourtesyOrder, isTransferOrder } from "./orderKinds";
import { siteUrl as orgSiteUrl } from "./sites";
import {
    choosePublishTime, DEFAULT_KEYWORD, EXTRA_NETWORKS, expandNetworkSlots, normalizeCadence, nextFunctionStart, planSlots,
    type CadenceConfig, type ExtraNetwork, type PlannedSlot, type SeriesPlatform,
} from "./socialSeriesCadence";
import { longDateLabel, renderPiece, type BaseImageOptions, type PieceData } from "./socialSeriesRender";
import { normalizeCoverSettings } from "./eventCover";
import { normalizeEventVideo } from "./eventVideo";
import { tiktokSettings, tiktokTitle } from "./socialPlatforms";
import { SECRET_PLACE_NAME } from "../../netlify/lib/secret-location.mjs";
import { zernioRequest, ZernioError } from "../../netlify/lib/zernio-ads.mjs";
import { sendEmail } from "../../netlify/lib/mailer.mjs";
import { escapeHtml } from "../../netlify/lib/supabase.mjs";

export const SERIES_TABLE = "aitickets_social_series";
export const SLOTS_TABLE = "aitickets_social_series_slots";
export const LIVE_STATUSES = ["draft", "active", "paused"] as const;
export const DM_REFS = { story: "ig-story-dm", post: "ig-post-dm", facebook_post: "fb-post-dm" } as const;
/** Links en el texto de Facebook y TikTok: las ventas de cada red aparecen como canal propio. */
export const LINK_REFS = { facebook: "fb-serie", tiktok: "tiktok-serie" } as const;
const SERIES_REFS = [...Object.values(DM_REFS), ...Object.values(LINK_REFS)];
export const NETWORK_NAMES: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok" };
export { DEFAULT_KEYWORD };
export const DEFAULT_EXTRA_KEYWORDS = ["entrada", "link"];
const CADENCE_SETTING = "social_series_cadence";
const TZ = "America/Santiago";
/** Reintentos de un slot que no llegó a Zernio (render, subida, red). Un rechazo de Zernio no se reintenta. */
const MAX_ATTEMPTS = 3;
/** Un slot cuya hora pasó hace más que esto (job caído) no se publica tarde. */
const MISSED_AFTER_MS = 30 * 60_000;
/** Un claim 'rendering' más viejo que esto quedó huérfano (función cortada). */
const STALE_CLAIM_MS = 15 * 60_000;
const DM_STATS_TTL_MS = 10 * 60_000;
const MAX_BASE_IMAGE_BYTES = 15 * 1024 * 1024;
const DM_PENDING_NOTICE = "No pudimos activar todavía la respuesta automática por DM:";
const SOLD_OUT_NOTICE = "Se agotaron las entradas: detuvimos las publicaciones y el DM ahora responde que está agotado.";
const IG_DISCONNECTED_NOTICE = "Instagram se desconectó o su acceso venció: pausamos la difusión. Reconéctalo en Promocionar y retomamos desde hoy.";

export const socialSeriesEnabled = () => serverEnv("SOCIAL_SERIES_ENABLED") !== "false";
export const zernioConfigured = () => Boolean(serverEnv("ZERNIO_API_KEY"));

const isMissing = (error: any) => ["42P01", "PGRST205", "42703", "PGRST204"].includes(String(error?.code || ""));
const nowIso = () => new Date().toISOString();

export class SeriesError extends Error {
    constructor(
        public code: "not_found" | "conflict" | "invalid_input" | "unavailable" | "forbidden" | "upstream",
        message: string,
    ) {
        super(message);
    }
}

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

export const SERIES_EVENT_SELECT =
    "id, name, title, slug, status, organization_id, description, start_date, end_date, image_url, cover_video, gallery_video, cover_settings, cancelled_at, archived_at, location, secret_location, " +
    "event_dates(date, start_time, end_time), event_locations(venues(name, city))";

export async function loadSeriesEvent(supabase: any, eventId: number): Promise<any | null> {
    let { data, error } = await supabase.from("events").select(SERIES_EVENT_SELECT).eq("id", eventId).maybeSingle();
    // Deploy sin las migraciones de cover_video / cover_settings
    if (error && isMissing(error)) {
        ({ data, error } = await supabase.from("events").select(SERIES_EVENT_SELECT.replace("cover_video, gallery_video, cover_settings, ", "")).eq("id", eventId).maybeSingle());
    }
    if (error) throw error;
    return data || null;
}

export async function loadLiveSeries(supabase: any, eventId: number): Promise<any | null> {
    const { data, error } = await supabase.from(SERIES_TABLE).select("*").eq("event_id", eventId).in("status", [...LIVE_STATUSES]).order("id", { ascending: false }).limit(1);
    if (error) {
        if (isMissing(error)) return null;
        throw error;
    }
    return data?.[0] || null;
}

/** La serie más reciente del evento (viva o terminada), para mostrar su historial. */
export async function loadLatestSeries(supabase: any, eventId: number): Promise<any | null> {
    const { data, error } = await supabase.from(SERIES_TABLE).select("*").eq("event_id", eventId).order("id", { ascending: false }).limit(1);
    if (error) {
        if (isMissing(error)) return null;
        throw error;
    }
    return data?.[0] || null;
}

export async function loadSlots(supabase: any, seriesId: number): Promise<any[]> {
    return fetchAll<any>(() => supabase.from(SLOTS_TABLE).select("*").eq("series_id", seriesId).order("publish_at", { ascending: true }).order("id", { ascending: true }));
}

/** Configuración global de cadencia (aitickets_platform_settings) con los valores por defecto. */
export async function loadCadenceConfig(supabase: any): Promise<CadenceConfig> {
    const { data, error } = await supabase.from("aitickets_platform_settings").select("value").eq("key", CADENCE_SETTING).maybeSingle();
    if (error && !isMissing(error)) console.warn("social series: config:", error.message);
    return normalizeCadence(data?.value);
}

export async function saveCadenceConfig(supabase: any, config: CadenceConfig) {
    const { error } = await supabase.from("aitickets_platform_settings").upsert({ key: CADENCE_SETTING, value: config, updated_at: nowIso() }, { onConflict: "key" });
    if (error) throw error;
}

/** Cuenta conectada (activa) de una red de la organización y su perfil de Zernio. */
export async function socialAccount(supabase: any, orgId: number, platform: SeriesPlatform): Promise<{ accountId: string; name: string | null; profileId: string | null } | null> {
    const { data: accounts } = await supabase
        .from("social_accounts")
        .select("id, zernio_account_id, account_name, status, created_at")
        .eq("organization_id", orgId)
        .eq("platform", platform)
        .eq("status", "active")
        .order("id", { ascending: false })
        .limit(1);
    const account = accounts?.[0];
    if (!account?.zernio_account_id) return null;
    const { data: org } = await supabase.from("organizations").select("zernio_profile_id").eq("id", orgId).maybeSingle();
    return { accountId: String(account.zernio_account_id), name: account.account_name || null, profileId: org?.zernio_profile_id || null };
}

/** Cuenta de Instagram conectada (la base de la serie). */
export const instagramAccount = (supabase: any, orgId: number) => socialAccount(supabase, orgId, "instagram");

const accountActive = async (supabase: any, orgId: number, accountId: string | null) => {
    if (!accountId) return false;
    const { data } = await supabase.from("social_accounts").select("id").eq("organization_id", orgId).eq("platform", "instagram").eq("zernio_account_id", accountId).eq("status", "active").limit(1);
    return Boolean(data?.length);
};

// ---------------------------------------------------------------------------
// Redes extra (Facebook, TikTok) y reel
// ---------------------------------------------------------------------------

export type NetworkState = { enabled: boolean; account_id: string | null; status: "active" | "disconnected" | null; error: string | null };

/** Estado de Facebook y TikTok de la serie (columna networks; sin la columna, ambas apagadas). */
export function networkStates(series: any): Record<ExtraNetwork, NetworkState> {
    const raw = series?.networks && typeof series.networks === "object" ? series.networks : {};
    const out = {} as Record<ExtraNetwork, NetworkState>;
    for (const n of EXTRA_NETWORKS) {
        const r = raw[n] && typeof raw[n] === "object" ? raw[n] : {};
        out[n] = {
            enabled: r.enabled === true,
            account_id: r.account_id ? String(r.account_id) : null,
            status: r.status === "active" || r.status === "disconnected" ? r.status : null,
            error: r.error ? String(r.error).slice(0, 300) : null,
        };
    }
    return out;
}

/** Redes donde la serie publica ahora: Instagram y las extra activadas con su cuenta conectada. */
export function activePlatforms(series: any): SeriesPlatform[] {
    const states = networkStates(series);
    return ["instagram", ...EXTRA_NETWORKS.filter((n) => states[n].enabled && states[n].status === "active" && states[n].account_id)] as SeriesPlatform[];
}

/** Cuenta de Zernio con la que publica cada red de la serie. */
export function accountIdFor(series: any, platform: string): string | null {
    if (!platform || platform === "instagram") return series?.zernio_account_id || null;
    const st = networkStates(series)[platform as ExtraNetwork];
    return st?.enabled && st.status === "active" ? st.account_id : null;
}

/** Conecta cada red extra activada con la cuenta vigente de la organización (al aprobar y reanudar). */
async function resolveNetworks(supabase: any, series: any, orgId: number): Promise<Record<ExtraNetwork, NetworkState>> {
    const states = networkStates(series);
    for (const n of EXTRA_NETWORKS) {
        if (!states[n].enabled) {
            states[n] = { enabled: false, account_id: null, status: null, error: null };
            continue;
        }
        const acc = await socialAccount(supabase, orgId, n);
        states[n] = { enabled: true, account_id: acc?.accountId || null, status: acc ? "active" : "disconnected", error: null };
    }
    return states;
}

/** Duración aceptada para el reel: Facebook pide de 3 a 60 s (Instagram y TikTok aceptan más). */
export const REEL_SECONDS = { min: 3, max: 60 } as const;

/** Video del evento que sirve como reel: vertical, MP4 o MOV y de 3 a 60 s (portada o, si no, el de la galería). */
export function reelVideoFor(event: any): { url: string; poster_url: string | null; duration: number } | null {
    for (const raw of [event?.cover_video, event?.gallery_video]) {
        const v = normalizeEventVideo(raw);
        if (!v) continue;
        const mp4 = v.mime ? v.mime !== "video/webm" : /\.(mp4|mov)(\?|$)/i.test(v.url);
        if (!mp4 || !v.width || !v.height || v.height <= v.width) continue;
        if (!v.duration || v.duration < REEL_SECONDS.min || v.duration > REEL_SECONDS.max) continue;
        return { url: v.url, poster_url: v.poster_url, duration: v.duration };
    }
    return null;
}

/** "aitickets.cl/eventos/slug": el link que muestran las piezas de Facebook y TikTok (sin https ni ref). */
export function shortEventLink(origin: string, slug: string): string {
    let host = "aitickets.cl";
    try {
        host = new URL(origin).host.replace(/^www\./, "");
    } catch {
        /* origen inválido: el dominio principal */
    }
    return `${host}/eventos/${slug}`;
}

/** Hora de publicación: hora pico de visitas del evento o, con pocas, de la organización; si no, la por defecto. */
export async function publishTimeFor(supabase: any, event: { id: number; organization_id: number }, config: CadenceConfig) {
    const hoursOf = (rows: any[]) => rows.map((r) => localHour(r.created_at));
    const eventVisits = await fetchAll<any>(() => supabase.from("event_visits").select("created_at").eq("event_id", event.id).order("created_at", { ascending: false }), { max: 5000 }).catch(() => []);
    if (eventVisits.length >= config.peak_min_visits) return { ...choosePublishTime(hoursOf(eventVisits), config), scope: "event" as const };
    const orgEvents = await fetchAll<any>(() => supabase.from("events").select("id").eq("organization_id", event.organization_id).order("id", { ascending: true }), { max: 2000 }).catch(() => []);
    const ids = orgEvents.map((e: any) => Number(e.id)).slice(-150);
    const since = new Date(Date.now() - 120 * 86400000).toISOString();
    const orgVisits = ids.length
        ? await fetchAll<any>(() => supabase.from("event_visits").select("created_at").in("event_id", ids).gte("created_at", since).order("created_at", { ascending: false }), { max: 20000 }).catch(() => [])
        : [];
    const pick = orgVisits.length > eventVisits.length ? orgVisits : eventVisits;
    return { ...choosePublishTime(hoursOf(pick), config), scope: pick === orgVisits ? ("organization" as const) : ("event" as const) };
}

/** Entradas: capacidad, emitidas, si se agotó y cuántas quedan (solo bajo el umbral de escasez). */
export async function ticketState(supabase: any, event: { id: number; status?: string | null }, config: CadenceConfig) {
    const cap = await eventCapacity(supabase, event);
    const capacity = cap.unlimited ? null : cap.capacity;
    const remaining = capacity != null ? Math.max(0, capacity - cap.issued) : null;
    const soldOut = capacity != null && capacity > 0 && remaining === 0;
    const scarce = capacity != null && remaining != null && remaining > 0 && (remaining / capacity) * 100 < config.scarcity_threshold_pct;
    return { capacity, issued: cap.issued, remaining, soldOut, scarcityRemaining: scarce ? remaining : null };
}

/** Fecha, hora y lugar de la función hacia la que cuenta la serie. */
export function eventLabels(event: any, anchor: Date) {
    // Dirección que solo ven quienes compran: las piezas dicen "Lugar secreto" (el nombre del recinto la delata)
    const secret = typeof event.secret_location === "string" && event.secret_location.trim() !== "";
    const venue = secret ? SECRET_PLACE_NAME : event.event_locations?.[0]?.venues?.name || (event.location ? String(event.location).split(",")[0].trim() : null);
    const hhmm = new Intl.DateTimeFormat("es-CL", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(anchor);
    return { name: String(event.title || event.name || "Evento"), dateLabel: longDateLabel(localDay(anchor)), startTime: hhmm, venue: venue || null };
}

export const anchorFor = (event: any, now = new Date()) => nextFunctionStart(event.event_dates || [], event.start_date || null, now);

/** Foto base: la elegida para la serie, la portada o el fotograma del video de portada. */
export const baseImageUrlFor = (series: any, event: any): string | null =>
    series?.base_image_url || event?.image_url || event?.cover_video?.poster_url || null;

/**
 * Encuadre de la portada en móvil (cover_settings.mobile) cuando la foto base ES la portada: la historia la muestra
 * como la página (recortada a la misma altura relativa, o completa sobre su versión difuminada si eligió 'contain').
 */
export function baseImageOptionsFor(series: any, event: any): BaseImageOptions {
    if (series?.base_image_url || !event?.image_url) return {};
    const mobile = normalizeCoverSettings(event.cover_settings).mobile;
    return { fit: mobile.fit, positionY: mobile.position_y };
}

// ---------------------------------------------------------------------------
// DM y links
// ---------------------------------------------------------------------------

export function dmTrackingUrl(origin: string, slug: string, ref: string): string {
    const url = new URL(`${origin.replace(/\/+$/, "")}/eventos/${encodeURIComponent(slug)}`);
    url.searchParams.set("ref", ref);
    return url.toString();
}

export const seriesKeywords = (series: any): string[] => {
    const out: string[] = [];
    for (const k of [series?.keyword || DEFAULT_KEYWORD, ...(series?.extra_keywords || [])]) {
        const clean = String(k || "").trim();
        if (clean && !out.some((x) => x.toLowerCase() === clean.toLowerCase())) out.push(clean);
    }
    return out;
};

/** Texto del DM: el del productor ({link} = el link con seguimiento; si no lo pone, va al final) o el por defecto. */
export function dmMessageFor(series: any, event: any, anchor: Date | null, link: string): string {
    if (series?.dm_message) {
        const custom = String(series.dm_message).trim();
        return (custom.includes("{link}") ? custom.replaceAll("{link}", link) : `${custom} ${link}`).slice(0, 640);
    }
    const labels = anchor ? eventLabels(event, anchor) : null;
    const when = labels ? `, el ${labels.dateLabel} a las ${labels.startTime}` : "";
    return `¡Hola! Aquí están tus entradas para ${labels?.name || event.name}${when}: ${link}`.slice(0, 640);
}

export const soldOutDmMessage = (event: any, orgPage: string | null) =>
    `¡Hola! Las entradas para ${event.title || event.name} se agotaron. ¡Gracias por tu interés!${orgPage ? ` Mira nuestros próximos eventos: ${orgPage}` : ""}`.slice(0, 640);

async function orgPageUrl(supabase: any, orgId: number): Promise<string | null> {
    const { data, error } = await supabase.from("aitickets_sites").select("slug, custom_domain, domain_status, published").eq("organization_id", orgId).eq("published", true).limit(1);
    if (error || !data?.[0]) return null;
    try {
        return orgSiteUrl(data[0]);
    } catch {
        return null;
    }
}

const linkButton = (url: string) => [{ type: "url", title: "Comprar entradas", url }];

async function zernioDelete(path: string) {
    try {
        await zernioRequest(path, { method: "DELETE" });
    } catch (err: any) {
        if (!(err instanceof ZernioError) || err.status !== 404) console.warn(`social series: DELETE ${path}:`, err?.message || err);
    }
}

/**
 * Deja la automatización story_reply de una cuenta de Instagram como corresponde a sus series vivas (activas o
 * pausadas): ninguna → se borra; una → DM con su evento; varias → DM del evento más próximo y la página de la
 * organización. Una sola automatización por cuenta (Zernio no permite dos story_reply "cualquier historia").
 */
export async function syncStoryAutomation(supabase: any, accountId: string | null, origin: string): Promise<void> {
    if (!accountId || !zernioConfigured()) return;
    const all = await fetchAll<any>(() => supabase.from(SERIES_TABLE).select("*").eq("zernio_account_id", accountId).order("id", { ascending: true }));
    const live = all.filter((s) => s.status === "active" || s.status === "paused");
    const ids = [...new Set(all.map((s) => s.zernio_story_automation_id).filter(Boolean))] as string[];
    if (!live.length) {
        for (const id of ids) await zernioDelete(`/comment-automations/${encodeURIComponent(id)}`);
        if (ids.length) await supabase.from(SERIES_TABLE).update({ zernio_story_automation_id: null, updated_at: nowIso() }).eq("zernio_account_id", accountId);
        return;
    }
    const events = new Map<number, any>();
    for (const s of live) events.set(Number(s.id), await loadSeriesEvent(supabase, Number(s.event_id)));
    const ordered = [...live].sort((a, b) => Date.parse(a.anchor_starts_at || "9999") - Date.parse(b.anchor_starts_at || "9999"));
    const nearest = ordered[0];
    const nearestEvent = events.get(Number(nearest.id));
    const orgPage = await orgPageUrl(supabase, Number(nearest.organization_id));
    const link = dmTrackingUrl(origin, nearestEvent?.slug || "", DM_REFS.story);
    let message = nearest.sold_out_at
        ? soldOutDmMessage(nearestEvent, orgPage)
        : dmMessageFor(nearest, nearestEvent, nearest.anchor_starts_at ? new Date(nearest.anchor_starts_at) : null, link);
    if (live.length > 1 && orgPage && !message.includes(orgPage)) message = `${message}\n\nTodos nuestros eventos: ${orgPage}`.slice(0, 640);
    const keywords = [...new Set(live.flatMap(seriesKeywords))];
    const body = {
        keywords,
        matchMode: "contains",
        dmMessage: message,
        buttons: nearest.sold_out_at ? [] : linkButton(link),
        isActive: true,
    };
    let keep = (nearest.zernio_story_automation_id as string | null) || ids[0] || null;
    if (keep) {
        try {
            await zernioRequest(`/comment-automations/${encodeURIComponent(keep)}`, { method: "PATCH", body });
        } catch (err: any) {
            if (err instanceof ZernioError && err.status === 404) keep = null;
            else throw err;
        }
    }
    if (!keep) {
        const profileId = nearest.zernio_profile_id;
        const created: any = await zernioRequest("/comment-automations", {
            method: "POST",
            idempotencyKey: `aitickets-story-dm-${accountId}-${nearest.id}-${Date.now()}`,
            body: {
                profileId,
                accountId,
                name: "AI Tickets · respuestas a historias",
                trigger: "story_reply",
                ...body,
                // Una persona que vuelve a responder otro día recibe el link de nuevo (series de varias semanas)
                repeatPolicy: { mode: "every_comment", cooldownHours: 12 },
            },
        });
        keep = created?.automation?.id || created?.automation?._id || null;
    }
    for (const id of ids) if (id !== keep) await zernioDelete(`/comment-automations/${encodeURIComponent(id)}`);
    await supabase.from(SERIES_TABLE).update({ zernio_story_automation_id: keep, updated_at: nowIso() }).in("id", live.map((s) => s.id));
}

/**
 * Automatización de comentarios de un post de feed o reel (keyword → DM), atada al post de Zernio aún no publicado.
 * Instagram y Facebook (Messenger): las únicas redes donde Zernio puede responder un comentario por mensaje privado.
 */
async function createPostAutomation(series: any, event: any, slot: any, zernioPostId: string, origin: string, accountId: string, platform: SeriesPlatform): Promise<string | null> {
    const link = dmTrackingUrl(origin, event.slug, platform === "facebook" ? DM_REFS.facebook_post : DM_REFS.post);
    const created: any = await zernioRequest("/comment-automations", {
        method: "POST",
        idempotencyKey: `aitickets-post-dm-${slot.id}`,
        body: {
            profileId: series.zernio_profile_id,
            accountId,
            name: `AI Tickets · ${platform === "facebook" ? "Facebook" : "post"} ${localDay(slot.publish_at)} · ${String(event.name || "").slice(0, 40)}`,
            trigger: "comment",
            postId: zernioPostId,
            keywords: seriesKeywords(series),
            matchMode: "contains",
            dmMessage: dmMessageFor(series, event, series.anchor_starts_at ? new Date(series.anchor_starts_at) : null, link),
            buttons: linkButton(link),
            commentReply: "¡Listo! Te mandamos el link por DM 📩",
        },
    });
    return created?.automation?.id || created?.automation?._id || null;
}

/** Contadores de DM (enviados y clics) de las automatizaciones de la serie, con caché de 10 min en la serie. */
export async function refreshDmStats(supabase: any, series: any, slots: any[], force = false) {
    if (!zernioConfigured()) return series.dm_stats || null;
    if (!force && series.dm_stats_at && Date.now() - Date.parse(series.dm_stats_at) < DM_STATS_TTL_MS) return series.dm_stats;
    const ids = [series.zernio_story_automation_id, ...slots.map((s) => s.zernio_automation_id)].filter(Boolean) as string[];
    if (!ids.length) return series.dm_stats || null;
    const stats = { dms_sent: 0, dms_failed: 0, link_clicks: 0, unique_clicks: 0, triggered: 0 };
    for (const id of [...new Set(ids)].slice(0, 20)) {
        try {
            const r: any = await zernioRequest(`/comment-automations/${encodeURIComponent(id)}`, { timeoutMs: 8000 });
            const s = r?.automation?.stats || {};
            stats.dms_sent += Number(s.dmsSent) || 0;
            stats.dms_failed += Number(s.dmsFailed) || 0;
            stats.link_clicks += Number(s.linkClicks) || 0;
            stats.unique_clicks += Number(s.uniqueClicks) || 0;
            stats.triggered += Number(s.triggered) || 0;
        } catch (err: any) {
            console.warn("social series: stats:", err?.message || err);
        }
    }
    // La automatización de historias es compartida por las series de la cuenta: sus números son de la cuenta
    const out = { ...stats, shared_story_automation: true };
    await supabase.from(SERIES_TABLE).update({ dm_stats: out, dm_stats_at: nowIso() }).eq("id", series.id);
    return out;
}

/** Ventas atribuidas a la serie: órdenes pagadas con las refs de la serie (DM de Instagram y Facebook, links de Facebook y TikTok), sin cortesías ni transferencias. */
export async function attributedSales(supabase: any, eventIds: number[], range?: { fromIso: string; toIso: string }) {
    if (!eventIds.length) return { orders: 0, tickets: 0, gross_clp: 0, fee_net_clp: 0, by_ref: {} as Record<string, number> };
    const rows: any[] = [];
    for (let i = 0; i < eventIds.length; i += 150) {
        const chunk = eventIds.slice(i, i + 150);
        rows.push(
            ...(await fetchAll<any>(() => {
                let q = supabase
                    .from("event_orders")
                    .select("id, event_id, ref, status, created_at, ticket_qty, ticket_details, total_payment, ticket_fee, service_fee_tax, payment_provider")
                    .in("event_id", chunk)
                    .eq("status", "paid")
                    .in("ref", SERIES_REFS);
                if (range) q = q.gte("created_at", range.fromIso).lt("created_at", range.toIso);
                return q.order("id", { ascending: true });
            }).catch(() => [])),
        );
    }
    const sales = rows.filter((o) => !isCourtesyOrder(o) && !isTransferOrder(o));
    const byRef: Record<string, number> = {};
    for (const o of sales) byRef[o.ref] = (byRef[o.ref] || 0) + (Number(o.ticket_qty) || 0);
    return {
        orders: sales.length,
        tickets: sales.reduce((n, o) => n + (Number(o.ticket_qty) || 0), 0),
        gross_clp: sales.reduce((n, o) => n + Math.round(Number(o.total_payment) || 0), 0),
        fee_net_clp: sales.reduce((n, o) => n + Math.round(Number(o.ticket_fee) || 0) - Math.round(Number(o.service_fee_tax) || 0), 0),
        by_ref: byRef,
    };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export type Plan = {
    anchorStart: Date | null;
    publishTime: { time: string; source: "peak" | "default"; visits: number; scope?: string };
    slots: PlannedSlot[];
};

export async function buildPlan(supabase: any, event: any, opts: { feedPosts: boolean; config: CadenceConfig; publishTime?: string | null; now?: Date }): Promise<Plan> {
    const now = opts.now || new Date();
    const anchorStart = anchorFor(event, now);
    const publishTime = opts.publishTime ? { time: opts.publishTime, source: "default" as const, visits: 0 } : await publishTimeFor(supabase, event, opts.config);
    const slots = anchorStart ? planSlots({ anchorStart, now, publishTime: publishTime.time, feedPosts: opts.feedPosts, config: opts.config }) : [];
    return { anchorStart, publishTime, slots };
}

/**
 * Guarda los slots del plan en cada red activa de la serie (o solo en `platforms`, al reconectar una red). El reel va
 * si la serie lo tiene activado y el evento tiene un video que sirve (reelVideoFor). La historia "agotado" sale en
 * Instagram y Facebook (TikTok no tiene historias).
 */
async function insertSlots(
    supabase: any,
    series: any,
    slots: PlannedSlot[],
    anchor: Date | null,
    { variant = "countdown", event = null, platforms = null }: { variant?: "countdown" | "sold_out"; event?: any; platforms?: SeriesPlatform[] | null } = {},
) {
    if (!slots.length) return;
    const active = activePlatforms(series);
    const on = platforms ? active.filter((p) => platforms.includes(p)) : active;
    if (!on.length) return;
    const video = variant === "countdown" && series.reel_enabled !== false && event ? reelVideoFor(event) : null;
    const expanded =
        variant === "sold_out"
            ? slots.flatMap((s) => on.filter((p) => p !== "tiktok").map((platform) => ({ ...s, platform })))
            : expandNetworkSlots(slots, { platforms: on, reel: Boolean(video), config: normalizeCadence(series.cadence_config) });
    const rows = expanded.map((s) => ({
        series_id: series.id,
        organization_id: series.organization_id,
        platform: s.platform,
        kind: s.kind,
        variant,
        publish_at: s.publish_at,
        days_to_event: Math.max(0, s.days_to_event),
        anchor_starts_at: anchor ? anchor.toISOString() : null,
        video_url: s.kind === "reel" ? video?.url || null : null,
        status: "planned",
    }));
    let { error } = await supabase.from(SLOTS_TABLE).insert(rows);
    if (error && isMissing(error)) {
        // Deploy sin la migración de redes: solo Instagram, sin reel
        const legacy = rows.filter((r) => r.platform === "instagram" && r.kind !== "reel").map(({ platform: _p, video_url: _v, ...r }) => r);
        ({ error } = legacy.length ? await supabase.from(SLOTS_TABLE).insert(legacy) : { error: null });
    }
    if (error) throw error;
}

/**
 * Saca de Zernio y marca omitidos los slots futuros que aún no se publicaron (planned, queued y claims huérfanos).
 * Lo usan pausar, cancelar, replanificar y agotado.
 */
async function skipPendingSlots(supabase: any, seriesId: number, reason: string, now = new Date(), platform: SeriesPlatform | null = null) {
    const slots = await loadSlots(supabase, seriesId);
    for (const s of slots) {
        if (platform && (s.platform || "instagram") !== platform) continue;
        const pending = s.status === "planned" || s.status === "queued" || (s.status === "rendering" && Date.parse(s.claimed_at || "0") < now.getTime() - STALE_CLAIM_MS);
        if (!pending) continue;
        if (s.status === "queued" && Date.parse(s.publish_at) <= now.getTime()) continue; // ya salió o está saliendo: lo confirma el webhook
        if (s.zernio_post_id) await zernioDelete(`/posts/${encodeURIComponent(s.zernio_post_id)}`);
        if (s.zernio_automation_id) await zernioDelete(`/comment-automations/${encodeURIComponent(s.zernio_automation_id)}`);
        await supabase
            .from(SLOTS_TABLE)
            .update({ status: "skipped", skip_reason: reason.slice(0, 120), zernio_automation_id: null, updated_at: nowIso() })
            .eq("id", s.id)
            .in("status", ["planned", "queued", "rendering"]);
    }
}

// ---------------------------------------------------------------------------
// Ciclo de vida (lo llaman las herramientas *_social_series)
// ---------------------------------------------------------------------------

export type Actor = { orgId: number; userId: number | null; channel: "mcp" | "rest" | "dashboard" | "admin"; origin: string };

export type SeriesOptions = {
    feed_posts_enabled?: boolean;
    sold_out_story_enabled?: boolean;
    keyword?: string;
    extra_keywords?: string[];
    dm_message?: string | null;
    base_image_url?: string | null;
    facebook_enabled?: boolean;
    tiktok_enabled?: boolean;
    reel_enabled?: boolean;
};

/**
 * Requisitos para activar: evento publicado y con funciones futuras, Instagram conectado, Zernio configurado y, si se
 * pasa la serie, cada red extra que activó (Facebook, TikTok) conectada.
 */
export async function activationBlockers(supabase: any, event: any, orgId: number, now = new Date(), series: any = null): Promise<string[]> {
    const out: string[] = [];
    if (!socialSeriesEnabled()) out.push("Las historias automáticas están desactivadas en AI Tickets.");
    if (!zernioConfigured()) out.push("La publicación en redes no está configurada en AI Tickets (Zernio).");
    if (event.status !== "published") out.push("Publica el evento antes de activar las historias automáticas.");
    if (event.cancelled_at) out.push("El evento está cancelado.");
    if (!anchorFor(event, now)) out.push("El evento no tiene funciones futuras.");
    if (!(await instagramAccount(supabase, orgId))) out.push("Conecta la cuenta de Instagram (Business o Creator) de la organización en Promocionar.");
    if (series) {
        const states = networkStates(series);
        if (states.facebook.enabled && !(await socialAccount(supabase, orgId, "facebook"))) out.push("Conecta tu página de Facebook en Promocionar o desactiva Facebook para este evento.");
        if (states.tiktok.enabled && !(await socialAccount(supabase, orgId, "tiktok"))) out.push("Conecta tu TikTok en Promocionar o desactiva TikTok para este evento.");
    }
    return out;
}

/** Crea o actualiza el borrador de la serie del evento (no publica nada). */
export async function prepareSeries(supabase: any, actor: Actor, eventId: number, opts: SeriesOptions) {
    const event = await loadSeriesEvent(supabase, eventId);
    if (!event || Number(event.organization_id) !== actor.orgId) throw new SeriesError("not_found", "Evento no encontrado en tu organización.");
    const live = await loadLiveSeries(supabase, eventId);
    if (live && live.status !== "draft") {
        throw new SeriesError("conflict", `Este evento ya tiene la difusión automática ${live.status === "active" ? "activa" : "pausada"}. Para cambiarla, cancélala y prepara una nueva.`);
    }
    const patch: Record<string, unknown> = { updated_at: nowIso() };
    if (opts.feed_posts_enabled !== undefined) patch.feed_posts_enabled = Boolean(opts.feed_posts_enabled);
    if (opts.sold_out_story_enabled !== undefined) patch.sold_out_story_enabled = Boolean(opts.sold_out_story_enabled);
    if (opts.keyword !== undefined) patch.keyword = String(opts.keyword).trim().toUpperCase();
    if (opts.extra_keywords !== undefined) patch.extra_keywords = opts.extra_keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 5);
    if (opts.dm_message !== undefined) patch.dm_message = opts.dm_message ? String(opts.dm_message).trim().slice(0, 600) : null;
    if (opts.base_image_url !== undefined) patch.base_image_url = opts.base_image_url || null;
    if (opts.reel_enabled !== undefined) patch.reel_enabled = Boolean(opts.reel_enabled);
    if (opts.facebook_enabled !== undefined || opts.tiktok_enabled !== undefined) {
        const states = networkStates(live);
        if (opts.facebook_enabled !== undefined) states.facebook = { ...states.facebook, enabled: Boolean(opts.facebook_enabled) };
        if (opts.tiktok_enabled !== undefined) states.tiktok = { ...states.tiktok, enabled: Boolean(opts.tiktok_enabled) };
        patch.networks = states;
    }
    // Deploy sin la migración de redes: solo Instagram (si se pidió una red extra, se avisa)
    const withoutNetworks = () => {
        const wanted = Object.values((patch.networks as Record<string, NetworkState>) || {}).some((n) => n.enabled);
        if (wanted) throw new SeriesError("unavailable", "Facebook, TikTok y el reel aún no están disponibles (falta la migración).");
        const { networks: _n, reel_enabled: _r, ...rest } = patch;
        return rest;
    };
    let series = live;
    if (series) {
        let { data, error } = await supabase.from(SERIES_TABLE).update(patch).eq("id", series.id).eq("status", "draft").select("*").single();
        if (error && isMissing(error) && ("networks" in patch || "reel_enabled" in patch)) {
            ({ data, error } = await supabase.from(SERIES_TABLE).update(withoutNetworks()).eq("id", series.id).eq("status", "draft").select("*").single());
        }
        if (error) throw error;
        series = data;
    } else {
        const row = { organization_id: actor.orgId, event_id: eventId, status: "draft", created_by: actor.userId, created_via: actor.channel };
        let { data, error } = await supabase.from(SERIES_TABLE).insert({ ...patch, ...row }).select("*").single();
        if (error && isMissing(error) && ("networks" in patch || "reel_enabled" in patch)) {
            ({ data, error } = await supabase.from(SERIES_TABLE).insert({ ...withoutNetworks(), ...row }).select("*").single());
        }
        if (error) {
            if (String(error.code) === "23505") throw new SeriesError("conflict", "Ya hay una difusión automática en preparación para este evento. Vuelve a intentarlo.");
            if (isMissing(error)) throw new SeriesError("unavailable", "Las historias automáticas aún no están disponibles (falta la migración).");
            throw error;
        }
        series = data;
    }
    return series;
}

/** Aprueba: guarda el plan (slots) y la automatización de DM. Desde aquí la plataforma publica sola. */
export async function approveSeries(supabase: any, actor: Actor, eventId: number, now = new Date()) {
    const event = await loadSeriesEvent(supabase, eventId);
    if (!event || Number(event.organization_id) !== actor.orgId) throw new SeriesError("not_found", "Evento no encontrado en tu organización.");
    let series = await loadLiveSeries(supabase, eventId);
    if (!series) series = await prepareSeries(supabase, actor, eventId, {});
    if (series.status !== "draft") throw new SeriesError("conflict", "La difusión automática de este evento ya está aprobada.");
    const blockers = await activationBlockers(supabase, event, actor.orgId, now, series);
    if (blockers.length) throw new SeriesError("invalid_input", blockers.join(" "));
    const account = (await instagramAccount(supabase, actor.orgId))!;
    const networks = await resolveNetworks(supabase, series, actor.orgId);
    const config = await loadCadenceConfig(supabase);
    const plan = await buildPlan(supabase, event, { feedPosts: series.feed_posts_enabled, config, now });
    if (!plan.slots.length) throw new SeriesError("invalid_input", "No quedan horarios para publicar antes del evento (empieza en menos de una hora).");
    const tickets = await ticketState(supabase, event, config);
    if (tickets.soldOut) throw new SeriesError("invalid_input", "El evento está agotado: no hay entradas que promocionar.");

    const { data: updated, error } = await supabase
        .from(SERIES_TABLE)
        .update({
            status: "active",
            cadence_config: { ...config, publish_time: plan.publishTime.time, publish_time_source: plan.publishTime.source, publish_time_scope: plan.publishTime.scope || null },
            anchor_starts_at: plan.anchorStart!.toISOString(),
            zernio_account_id: account.accountId,
            zernio_profile_id: account.profileId,
            ...(Object.values(networks).some((n) => n.enabled) ? { networks } : {}),
            approved_by: actor.userId,
            approved_at: now.toISOString(),
            notice: null,
            pause_reason: null,
            updated_at: nowIso(),
        })
        .eq("id", series.id)
        .eq("status", "draft")
        .select("*")
        .single();
    if (error) throw error;
    series = updated;
    await insertSlots(supabase, series, plan.slots, plan.anchorStart, { event });
    try {
        await syncStoryAutomation(supabase, series.zernio_account_id, actor.origin);
    } catch (err: any) {
        // El DM se reintenta en la próxima pasada del job (reconcile): las historias igual salen
        console.error("social series: DM al aprobar:", err?.message || err);
        await supabase.from(SERIES_TABLE).update({ notice: `${DM_PENDING_NOTICE} lo reintentamos en unos minutos.` }).eq("id", series.id);
    }
    return { series, plan };
}

export async function pauseSeries(supabase: any, series: any, reason: string, _origin: string, notice: string | null = null) {
    if (series.status !== "active") throw new SeriesError("conflict", series.status === "paused" ? "La difusión ya está pausada." : "La difusión no está activa.");
    await skipPendingSlots(supabase, series.id, reason === "producer" ? "pausada" : `pausada: ${reason}`);
    const { data, error } = await supabase
        .from(SERIES_TABLE)
        .update({ status: "paused", paused_at: nowIso(), pause_reason: reason, notice, updated_at: nowIso() })
        .eq("id", series.id)
        .eq("status", "active")
        .select("*")
        .single();
    if (error) throw error;
    return data;
}

/** Reanuda recalculando desde hoy (lo que no salió mientras estaba pausada no se publica tarde). */
export async function resumeSeries(supabase: any, series: any, origin: string, now = new Date(), notice: string | null = null) {
    if (series.status !== "paused") throw new SeriesError("conflict", "La difusión no está pausada.");
    const event = await loadSeriesEvent(supabase, Number(series.event_id));
    if (!event) throw new SeriesError("not_found", "El evento ya no existe.");
    const blockers = await activationBlockers(supabase, event, Number(series.organization_id), now);
    if (blockers.length) throw new SeriesError("invalid_input", blockers.join(" "));
    const account = (await instagramAccount(supabase, Number(series.organization_id)))!;
    const networks = await resolveNetworks(supabase, series, Number(series.organization_id));
    const offline = EXTRA_NETWORKS.filter((n) => networks[n].enabled && networks[n].status !== "active").map((n) => NETWORK_NAMES[n]);
    if (offline.length) notice = [notice, `${offline.join(" y ")} no está conectado: esas publicaciones se retoman cuando lo reconectes en Promocionar.`].filter(Boolean).join(" ");
    const config = normalizeCadence(series.cadence_config);
    const plan = await buildPlan(supabase, event, { feedPosts: series.feed_posts_enabled, config, publishTime: series.cadence_config?.publish_time, now });
    await skipPendingSlots(supabase, series.id, "reanudada", now);
    const { data, error } = await supabase
        .from(SERIES_TABLE)
        .update({
            status: "active",
            paused_at: null,
            pause_reason: null,
            notice,
            anchor_starts_at: plan.anchorStart ? plan.anchorStart.toISOString() : series.anchor_starts_at,
            zernio_account_id: account.accountId,
            zernio_profile_id: account.profileId,
            ...(Object.values(networks).some((n) => n.enabled) ? { networks } : {}),
            updated_at: nowIso(),
        })
        .eq("id", series.id)
        .eq("status", "paused")
        .select("*")
        .single();
    if (error) throw error;
    const tickets = await ticketState(supabase, event, config);
    if (!tickets.soldOut) await insertSlots(supabase, data, plan.slots, plan.anchorStart, { event });
    if (series.zernio_account_id && series.zernio_account_id !== account.accountId) await syncStoryAutomation(supabase, series.zernio_account_id, origin).catch(() => {});
    await syncStoryAutomation(supabase, account.accountId, origin).catch((err) => console.error("social series: DM al reanudar:", err?.message || err));
    return { series: data, plan };
}

/** Cancela: borra lo programado en Zernio y las automatizaciones de DM. */
export async function cancelSeries(supabase: any, series: any, reason: string, origin: string) {
    if (!["draft", "active", "paused"].includes(series.status)) throw new SeriesError("conflict", "La difusión ya terminó.");
    await skipPendingSlots(supabase, series.id, `cancelada: ${reason}`);
    await removePostAutomations(supabase, series.id);
    const { data, error } = await supabase
        .from(SERIES_TABLE)
        .update({ status: "cancelled", cancelled_at: nowIso(), cancel_reason: reason.slice(0, 200), updated_at: nowIso() })
        .eq("id", series.id)
        .in("status", ["draft", "active", "paused"])
        .select("*")
        .single();
    if (error) throw error;
    await syncStoryAutomation(supabase, series.zernio_account_id, origin).catch((err) => console.error("social series: DM al cancelar:", err?.message || err));
    return data;
}

async function removePostAutomations(supabase: any, seriesId: number) {
    const slots = await loadSlots(supabase, seriesId);
    for (const s of slots.filter((x) => x.zernio_automation_id)) {
        await zernioDelete(`/comment-automations/${encodeURIComponent(s.zernio_automation_id)}`);
        await supabase.from(SLOTS_TABLE).update({ zernio_automation_id: null, updated_at: nowIso() }).eq("id", s.id);
    }
}

async function completeSeries(supabase: any, series: any, origin: string) {
    await removePostAutomations(supabase, series.id);
    await supabase.from(SERIES_TABLE).update({ status: "completed", completed_at: nowIso(), updated_at: nowIso() }).eq("id", series.id).in("status", ["active", "paused"]);
    await syncStoryAutomation(supabase, series.zernio_account_id, origin).catch((err) => console.error("social series: DM al cerrar:", err?.message || err));
}

// ---------------------------------------------------------------------------
// Job: reconciliar (cortes) y despachar
// ---------------------------------------------------------------------------

async function notifyInstagramDisconnected(supabase: any, series: any, event: any, origin: string) {
    try {
        const { data: owners } = await supabase.from("users").select("email, name, role").eq("organization_id", series.organization_id).in("role", ["producer", "admin"]).eq("active", true);
        const to = (owners || []).map((u: any) => u.email).filter(Boolean).slice(0, 3);
        if (!to.length) return;
        const url = `${origin}/dashboard/events/${series.event_id}`;
        const name = event?.name || "tu evento";
        const paragraphs = [
            "Hola,",
            `Tu cuenta de Instagram se desconectó de AI Tickets (o su acceso venció), así que pausamos las historias automáticas de "${name}". No se publicará nada hasta que la reconectes.`,
            `Reconéctala en Promocionar (${origin}/dashboard/promote) y retomamos desde hoy automáticamente.`,
            `Ver la difusión: ${url}`,
            "Equipo AI Tickets",
        ];
        await sendEmail({
            to,
            subject: `Pausamos las historias de "${name}": reconecta tu Instagram`,
            text: paragraphs.join("\n\n"),
            html: paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join(""),
            tags: ["social-series"],
            idempotencyKey: `social-series-ig-${series.id}-${localDay(new Date())}`,
        });
    } catch (err: any) {
        console.error("social series: correo de Instagram desconectado:", err?.message || err);
    }
}


async function markSoldOut(supabase: any, series: any, event: any, origin: string, now: Date) {
    await skipPendingSlots(supabase, series.id, "agotado", now);
    const { data: updated } = await supabase.from(SERIES_TABLE).update({ sold_out_at: now.toISOString(), notice: SOLD_OUT_NOTICE, updated_at: nowIso() }).eq("id", series.id).select("*").single();
    const current = updated || { ...series, sold_out_at: now.toISOString() };
    if (series.sold_out_story_enabled) {
        const config = normalizeCadence(series.cadence_config);
        const at = new Date(Math.ceil((now.getTime() + config.lead_minutes * 60_000 * 0.25) / 300_000) * 300_000);
        const anchor = series.anchor_starts_at ? new Date(series.anchor_starts_at) : null;
        if (!anchor || at.getTime() < anchor.getTime()) {
            const days = anchor ? Math.max(0, Math.round((Date.parse(`${localDay(anchor)}T00:00:00Z`) - Date.parse(`${localDay(at)}T00:00:00Z`)) / 86400000)) : 0;
            await insertSlots(supabase, current, [{ kind: "story", variant: "countdown", days_to_event: days, local_date: localDay(at), publish_at: at.toISOString() }], anchor, { variant: "sold_out" }).catch((err: any) =>
                console.warn("social series: historia de agotado:", err?.message || err),
            );
        }
    }
    // El DM de los posts responde "agotado"
    const orgPage = await orgPageUrl(supabase, Number(series.organization_id));
    const slots = await loadSlots(supabase, series.id);
    for (const s of slots.filter((x) => x.zernio_automation_id)) {
        await zernioRequest(`/comment-automations/${encodeURIComponent(s.zernio_automation_id)}`, { method: "PATCH", body: { dmMessage: soldOutDmMessage(event, orgPage), buttons: [] } }).catch((err: any) =>
            console.warn("social series: DM agotado:", err?.message || err),
        );
    }
    await syncStoryAutomation(supabase, series.zernio_account_id, origin).catch((err) => console.error("social series: DM agotado:", err?.message || err));
    return current;
}

/** Revisa una serie viva contra el estado actual del evento y de la cuenta. Devuelve qué hizo. */
export async function reconcileSeries(supabase: any, series: any, origin: string, now = new Date()): Promise<string> {
    const event = await loadSeriesEvent(supabase, Number(series.event_id));
    if (!event || Number(event.organization_id) !== Number(series.organization_id)) {
        await cancelSeries(supabase, series, "el evento ya no existe", origin);
        return "cancelled:event_missing";
    }
    if (event.cancelled_at || event.status === "cancelled") {
        await cancelSeries(supabase, series, "evento cancelado", origin);
        return "cancelled:event_cancelled";
    }
    if (event.status !== "published" || event.archived_at) {
        await cancelSeries(supabase, series, "evento despublicado", origin);
        return "cancelled:event_unpublished";
    }
    const slots = await loadSlots(supabase, series.id);
    const anchor = anchorFor(event, now);
    const pendingFuture = slots.some((s) => ["planned", "rendering", "queued"].includes(s.status) && Date.parse(s.publish_at) > now.getTime() - MISSED_AFTER_MS);
    if (!anchor && !pendingFuture) {
        await completeSeries(supabase, series, origin);
        return "completed";
    }

    if (series.status === "paused") {
        if (series.pause_reason === "instagram_disconnected" && (await instagramAccount(supabase, Number(series.organization_id)))) {
            await resumeSeries(supabase, series, origin, now, "Instagram reconectado: retomamos las publicaciones desde hoy.");
            return "resumed:instagram_reconnected";
        }
        return "paused";
    }

    if (!(await accountActive(supabase, Number(series.organization_id), series.zernio_account_id))) {
        await pauseSeries(supabase, series, "instagram_disconnected", origin, IG_DISCONNECTED_NOTICE);
        await notifyInstagramDisconnected(supabase, series, event, origin);
        return "paused:instagram_disconnected";
    }

    const config = normalizeCadence(series.cadence_config);
    const tickets = await ticketState(supabase, event, config);
    if (tickets.soldOut && !series.sold_out_at) {
        await markSoldOut(supabase, series, event, origin, now);
        return "sold_out";
    }

    let current = series;
    // Facebook / TikTok: desconectada → se omiten sus pendientes (Instagram sigue); reconectada → sus piezas desde hoy
    const net = await syncNetworks(supabase, current, event, anchor, now, Boolean(series.sold_out_at));
    current = net.series;
    let replanReason: string | null = null;
    if (!tickets.soldOut && series.sold_out_at) {
        const { data } = await supabase.from(SERIES_TABLE).update({ sold_out_at: null, notice: "Volvió a haber entradas: retomamos las publicaciones.", updated_at: nowIso() }).eq("id", series.id).select("*").single();
        current = data || { ...series, sold_out_at: null };
        replanReason = "volvieron entradas";
    }
    const storedAnchor = series.anchor_starts_at ? Date.parse(series.anchor_starts_at) : null;
    if (anchor && (storedAnchor == null || Math.abs(anchor.getTime() - storedAnchor) > 60_000)) {
        const moved = storedAnchor != null && storedAnchor > now.getTime();
        const labels = eventLabels(event, anchor);
        const notice = moved ? `Cambió la fecha del evento: recalculamos las publicaciones hacia el ${labels.dateLabel} a las ${labels.startTime}. Las ya publicadas no se tocan.` : null;
        const { data } = await supabase
            .from(SERIES_TABLE)
            .update({ anchor_starts_at: anchor.toISOString(), ...(notice ? { notice } : {}), updated_at: nowIso() })
            .eq("id", series.id)
            .select("*")
            .single();
        current = data || { ...current, anchor_starts_at: anchor.toISOString() };
        replanReason = moved ? "cambio de fecha" : "siguiente función";
    }
    if (replanReason && anchor && !tickets.soldOut) {
        await skipPendingSlots(supabase, series.id, `replanificada: ${replanReason}`, now);
        const plan = planSlots({ anchorStart: anchor, now, publishTime: publishTimeOf(current), feedPosts: current.feed_posts_enabled, config });
        await insertSlots(supabase, current, plan, anchor, { event });
        await syncStoryAutomation(supabase, current.zernio_account_id, origin).catch(() => {});
        return `replanned:${replanReason}`;
    }
    // Automatización de historias pendiente (falló al aprobar)
    if (!current.zernio_story_automation_id) {
        try {
            await syncStoryAutomation(supabase, current.zernio_account_id, origin);
            if (String(current.notice || "").startsWith(DM_PENDING_NOTICE)) await supabase.from(SERIES_TABLE).update({ notice: null }).eq("id", current.id);
        } catch (err: any) {
            console.warn("social series: DM pendiente:", err?.message || err);
        }
    }
    return net.changes.length ? `networks:${net.changes.join(",")}` : "ok";
}

/**
 * Revisa las redes extra activadas contra las cuentas conectadas: si una se desconectó, omite sus pendientes y avisa
 * (las demás siguen); si volvió (o cambió de cuenta), planifica sus piezas desde ahora.
 */
async function syncNetworks(supabase: any, series: any, event: any, anchor: Date | null, now: Date, soldOut: boolean): Promise<{ series: any; changes: string[] }> {
    const states = networkStates(series);
    const changes: string[] = [];
    const notices: string[] = [];
    for (const n of EXTRA_NETWORKS) {
        const st = states[n];
        if (!st.enabled) continue;
        const acc = await socialAccount(supabase, Number(series.organization_id), n);
        if (st.status === "active" && acc?.accountId === st.account_id) continue;
        if (st.status !== "active" && !acc) continue;
        if (st.status === "active") await skipPendingSlots(supabase, series.id, `${NETWORK_NAMES[n]} desconectado`, now, n);
        if (!acc) {
            states[n] = { ...st, status: "disconnected" };
            changes.push(`${n}_disconnected`);
            notices.push(`${NETWORK_NAMES[n]} se desconectó: dejamos de publicar ahí (las demás redes siguen). Reconéctalo en Promocionar y retomamos desde hoy.`);
            continue;
        }
        states[n] = { enabled: true, account_id: acc.accountId, status: "active", error: null };
        if (anchor && !soldOut) {
            const plan = planSlots({ anchorStart: anchor, now, publishTime: publishTimeOf(series), feedPosts: series.feed_posts_enabled, config: normalizeCadence(series.cadence_config) });
            await insertSlots(supabase, { ...series, networks: states }, plan, anchor, { event, platforms: [n] }).catch((err: any) =>
                console.warn(`social series ${series.id}: ${n} reconectado:`, err?.message || err),
            );
        }
        changes.push(`${n}_reconnected`);
        notices.push(`${NETWORK_NAMES[n]} conectado: publicamos ahí desde hoy.`);
    }
    if (!changes.length) return { series, changes };
    const { data } = await supabase.from(SERIES_TABLE).update({ networks: states, notice: notices.join(" ").slice(0, 500), updated_at: nowIso() }).eq("id", series.id).select("*").single();
    return { series: data || { ...series, networks: states }, changes };
}

/** Una red extra dejó de responder (cuenta desconectada o acceso vencido): solo esa red se detiene. */
async function disconnectNetwork(supabase: any, series: any, platform: ExtraNetwork, error: string | null) {
    const states = networkStates(series);
    const accountId = states[platform].account_id;
    if (accountId) await supabase.from("social_accounts").update({ status: "expired" }).eq("organization_id", series.organization_id).eq("platform", platform).eq("zernio_account_id", accountId);
    await skipPendingSlots(supabase, series.id, `${NETWORK_NAMES[platform]} desconectado`, new Date(), platform);
    states[platform] = { ...states[platform], status: "disconnected", error: error ? error.slice(0, 300) : null };
    const notice = `${NETWORK_NAMES[platform]} se desconectó o su acceso venció: dejamos de publicar ahí (las demás redes siguen). Reconéctalo en Promocionar y retomamos desde hoy.`;
    const { data } = await supabase.from(SERIES_TABLE).update({ networks: states, notice, updated_at: nowIso() }).eq("id", series.id).select("*").single();
    return data || { ...series, networks: states, notice };
}

/** Hora de publicación elegida al aprobar (la usan reanudar y replanificar). */
const publishTimeOf = (series: any) => String(series.cadence_config?.publish_time || normalizeCadence(series.cadence_config).default_time);

function isRetryable(err: any) {
    if (!(err instanceof ZernioError)) return true;
    return err.status === 0 || err.status === 408 || err.status === 429 || err.status >= 500;
}

async function uploadPiece(supabase: any, series: any, slot: any, buffer: Buffer): Promise<string> {
    const path = `social-series/${series.organization_id}/${series.id}-${slot.id}-${slot.kind}-${Date.now().toString(36)}.jpg`;
    const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, buffer, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
    if (error) throw new Error(`No se pudo guardar la imagen: ${error.message}`);
    return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Caption de un post de feed: IA desde la descripción (o texto fijo) + el cierre con la palabra clave. */
export async function seriesCaption(supabase: any, event: any, slot: { days_to_event: number }, keyword: string, previous: string[] = [], anchor: Date | null = null): Promise<string> {
    return `${await seriesCaptionBody(supabase, event, slot, previous, anchor)}\n\n${captionClosing("instagram", keyword, "")}`.slice(0, 2200);
}

/**
 * Cierre del caption según la red: en Instagram, comentar la palabra clave (DM); en Facebook, eso mismo (Messenger) más
 * el link; en TikTok, solo el link (no hay DM por comentarios ni links clickeables).
 */
export function captionClosing(platform: string, keyword: string, link: string): string {
    if (platform === "facebook") return `Comenta ${keyword} y te mandamos el link por Messenger 📩\nEntradas: ${link}`;
    if (platform === "tiktok") return `Entradas: ${link}`;
    return `Comenta ${keyword} y te mandamos el link 📩`;
}

/** Texto del post sin el cierre: IA desde la descripción del evento o, si no hay, el texto fijo. */
export async function seriesCaptionBody(supabase: any, event: any, slot: { days_to_event: number }, previous: string[] = [], anchor: Date | null = null): Promise<string> {
    let body = "";
    if (isTextGenerationConfigured()) {
        try {
            const { data: full } = await supabase.from("events").select(EVENT_CONTEXT_SELECT).eq("id", event.id).maybeSingle();
            body = await generateSeriesCaption(buildEventContext(full || event), slot.days_to_event, previous);
        } catch (err: any) {
            console.warn("social series: caption con IA:", err?.message || err);
        }
    }
    if (!body) body = fallbackCaption(event, slot.days_to_event, anchor);
    return body;
}

export function fallbackCaption(event: any, daysToEvent: number, anchor: Date | null): string {
    const labels = anchor ? eventLabels(event, anchor) : null;
    const name = labels?.name || event.name;
    const when = daysToEvent <= 0 ? "¡Es hoy!" : daysToEvent === 1 ? "¡Es mañana!" : `Faltan ${daysToEvent} días.`;
    const where = labels ? `${labels.dateLabel} a las ${labels.startTime}${labels.venue ? ` en ${labels.venue}` : ""}.` : "";
    const about = htmlToPlainText(event.description).split("\n").find((l) => l.trim().length > 20) || "";
    return [`${name}: ${when}`, where, about.slice(0, 280)].filter(Boolean).join("\n\n");
}

/** Datos de la pieza con el estado vigente del evento (entradas que quedan, foto, fecha). */
export async function pieceDataFor(supabase: any, series: any, event: any, slot: { kind: string; variant: string; days_to_event: number }, config: CadenceConfig, anchor: Date | null): Promise<PieceData> {
    const a = anchor || anchorFor(event) || new Date(event.start_date || Date.now());
    const labels = eventLabels(event, a);
    const tickets = slot.variant === "sold_out" ? null : await ticketState(supabase, event, config).catch(() => null);
    return {
        kind: slot.kind === "feed_post" ? "feed_post" : "story",
        variant: slot.variant === "sold_out" ? "sold_out" : "countdown",
        daysToEvent: slot.days_to_event,
        eventName: labels.name,
        dateLabel: labels.dateLabel,
        startTime: labels.startTime,
        venue: labels.venue,
        keyword: String(series?.keyword || DEFAULT_KEYWORD),
        remaining: tickets?.scarcityRemaining ?? null,
        styleIndex: slot.days_to_event,
    };
}

export async function loadBaseImage(url: string | null): Promise<Buffer | null> {
    if (!url) return null;
    try {
        const { buffer } = await fetchPublic(url, { maxBytes: MAX_BASE_IMAGE_BYTES, accept: "image/*", timeoutMs: 8000 });
        return buffer;
    } catch (err: any) {
        console.warn("social series: foto base:", err?.message || err);
        return null;
    }
}

/**
 * Cuerpo de POST /v1/posts de Zernio para una pieza de la serie (una red por post, así cada red tiene su estado):
 * - historia: Instagram o Facebook con contentType story;
 * - post de feed: imagen con caption (en TikTok, photo post: título corto y el caption como descripción);
 * - reel: el video del evento (Instagram lo publica como reel, Facebook con contentType reel, TikTok como video).
 */
export function slotPostBody({
    platform, kind, accountId, imageUrl, videoUrl, caption, scheduledFor, metadata,
}: {
    platform: SeriesPlatform; kind: string; accountId: string; imageUrl: string | null; videoUrl: string | null; caption: string | null; scheduledFor: string; metadata: Record<string, string>;
}): Record<string, any> {
    const entry: Record<string, any> = { platform, accountId };
    if ((platform === "instagram" || platform === "facebook") && kind === "story") entry.platformSpecificData = { contentType: "story" };
    if (platform === "facebook" && kind === "reel") entry.platformSpecificData = { contentType: "reel" };
    const media = kind === "reel" ? [{ type: "video", url: videoUrl }] : [{ type: "image", url: imageUrl }];
    let content = caption;
    if (platform === "tiktok" && kind !== "reel" && caption) content = tiktokTitle(caption) || caption.slice(0, 90);
    return {
        ...(content ? { content } : {}),
        mediaItems: media,
        platforms: [entry],
        ...(platform === "tiktok" ? { tiktokSettings: tiktokSettings({ photo: kind !== "reel", description: caption || "" }) } : {}),
        scheduledFor,
        timezone: TZ,
        metadata,
    };
}

/** Renderiza, sube y programa en Zernio un slot ya reclamado ('rendering'). `bodies` = textos ya escritos por día. */
async function dispatchSlot(supabase: any, series: any, event: any, slot: any, origin: string, now: Date, previousCaptions: string[], bodies: Map<number, string>) {
    const platform: SeriesPlatform = slot.platform || "instagram";
    const accountId = accountIdFor(series, platform);
    if (!accountId) throw new ZernioError(409, { error: `${NETWORK_NAMES[platform]} no está conectado`, code: "ACCOUNT_DISCONNECTED" });
    const config = normalizeCadence(series.cadence_config);
    const anchor = slot.anchor_starts_at ? new Date(slot.anchor_starts_at) : series.anchor_starts_at ? new Date(series.anchor_starts_at) : anchorFor(event, now);
    const keyword = String(series?.keyword || DEFAULT_KEYWORD);
    let imageUrl: string | null = null;
    if (slot.kind !== "reel") {
        // TikTok: formato vertical (como la historia); Facebook y TikTok muestran dónde comprar en vez de la palabra clave
        const pieceSlot = { ...slot, kind: platform === "tiktok" ? "story" : slot.kind };
        const data = await pieceDataFor(supabase, series, event, pieceSlot, config, anchor);
        if (platform !== "instagram") data.linkLabel = shortEventLink(origin, event.slug);
        const image = await renderPiece(data, await loadBaseImage(baseImageUrlFor(series, event)), baseImageOptionsFor(series, event));
        imageUrl = await uploadPiece(supabase, series, slot, image);
    } else if (!slot.video_url) {
        throw new ZernioError(400, { error: "El evento ya no tiene un video para el reel" });
    }
    let caption: string | null = null;
    if (slot.kind !== "story") {
        let body = bodies.get(Number(slot.days_to_event));
        if (!body) {
            body = await seriesCaptionBody(supabase, event, slot, previousCaptions, anchor);
            bodies.set(Number(slot.days_to_event), body);
        }
        const ref = platform === "facebook" ? LINK_REFS.facebook : platform === "tiktok" ? LINK_REFS.tiktok : null;
        caption = `${body}\n\n${captionClosing(platform, keyword, ref ? dmTrackingUrl(origin, event.slug, ref) : "")}`.slice(0, 2200);
    }
    await supabase.from(SLOTS_TABLE).update({ image_url: imageUrl, caption, rendered_at: nowIso(), updated_at: nowIso() }).eq("id", slot.id);

    const scheduledFor = new Date(Math.max(Date.parse(slot.publish_at), now.getTime() + 2 * 60_000)).toISOString();
    const created: any = await zernioRequest("/posts", {
        method: "POST",
        idempotencyKey: `aitickets-series-slot-${slot.id}`,
        body: slotPostBody({
            platform,
            kind: slot.kind,
            accountId,
            imageUrl,
            videoUrl: slot.video_url || null,
            caption,
            scheduledFor,
            metadata: { aitickets_slot_id: String(slot.id), aitickets_series_id: String(series.id), aitickets_event_id: String(series.event_id) },
        }),
    });
    const zernioPostId = created?.post?._id || created?.post?.id || null;
    if (!zernioPostId) throw new ZernioError(502, { error: "Zernio no devolvió el id de la publicación" });
    let automationId: string | null = null;
    let error: string | null = null;
    if (slot.kind !== "story" && platform !== "tiktok" && !series.sold_out_at) {
        try {
            automationId = await createPostAutomation(series, event, slot, zernioPostId, origin, accountId, platform);
        } catch (err: any) {
            error = `Publicación programada, pero no se pudo activar el DM por comentarios: ${String(err?.message || err).slice(0, 300)}`;
        }
    }
    await supabase
        .from(SLOTS_TABLE)
        .update({ status: "queued", zernio_post_id: zernioPostId, zernio_automation_id: automationId, queued_at: nowIso(), error, updated_at: nowIso() })
        .eq("id", slot.id);
    return caption;
}

export type JobSummary = { reconciled: Record<string, number>; dispatched: number; failed: number; retried: number; skipped: number; remaining: number };

/**
 * Pasada del job (cada 15 min): libera claims huérfanos, reconcilia las series vivas (cortes) y despacha los slots
 * que publican dentro de lead_minutes, hasta agotar el presupuesto de tiempo (lo que quede, en la próxima pasada).
 */
export async function runSeriesJobs(supabase: any, { origin, now = new Date(), budgetMs = 7000 }: { origin: string; now?: Date; budgetMs?: number }): Promise<JobSummary> {
    const started = Date.now();
    const summary: JobSummary = { reconciled: {}, dispatched: 0, failed: 0, retried: 0, skipped: 0, remaining: 0 };
    if (!socialSeriesEnabled()) return summary;

    // Claims huérfanos
    await supabase
        .from(SLOTS_TABLE)
        .update({ status: "planned", claimed_at: null, updated_at: nowIso() })
        .eq("status", "rendering")
        .lt("claimed_at", new Date(now.getTime() - STALE_CLAIM_MS).toISOString());

    const liveSeries = await fetchAll<any>(() => supabase.from(SERIES_TABLE).select("*").in("status", ["active", "paused"]).order("id", { ascending: true })).catch((err: any) => {
        if (isMissing(err)) return [];
        throw err;
    });
    for (const s of liveSeries) {
        try {
            const result = await reconcileSeries(supabase, s, origin, now);
            const key = result.split(":")[0];
            summary.reconciled[key] = (summary.reconciled[key] || 0) + 1;
        } catch (err: any) {
            console.error(`social series ${s.id}: reconcile:`, err?.message || err);
            summary.reconciled.error = (summary.reconciled.error || 0) + 1;
        }
    }

    const active = await fetchAll<any>(() => supabase.from(SERIES_TABLE).select("*").eq("status", "active").order("id", { ascending: true })).catch(() => []);
    if (!active.length || !zernioConfigured()) return summary;
    const byId = new Map(active.map((s: any) => [Number(s.id), s]));
    const maxLead = Math.max(...active.map((s: any) => normalizeCadence(s.cadence_config).lead_minutes));
    const due = await fetchAll<any>(() =>
        supabase
            .from(SLOTS_TABLE)
            .select("*")
            .eq("status", "planned")
            .in("series_id", [...byId.keys()])
            .lte("publish_at", new Date(now.getTime() + maxLead * 60_000).toISOString())
            .order("publish_at", { ascending: true }),
    );
    const events = new Map<number, any>();
    const captions = new Map<number, string[]>();
    // Texto de cada día por serie: Instagram, Facebook y TikTok del mismo día comparten el texto (una sola llamada a la IA)
    const bodies = new Map<number, Map<number, string>>();
    for (const slot of due) {
        const series = byId.get(Number(slot.series_id));
        if (!series) continue;
        const platform: SeriesPlatform = slot.platform || "instagram";
        if (platform !== "instagram" && !accountIdFor(series, platform)) {
            await supabase.from(SLOTS_TABLE).update({ status: "skipped", skip_reason: `${NETWORK_NAMES[platform]} desconectado`, updated_at: nowIso() }).eq("id", slot.id).eq("status", "planned");
            summary.skipped++;
            continue;
        }
        const lead = normalizeCadence(series.cadence_config).lead_minutes * 60_000;
        if (Date.parse(slot.publish_at) > now.getTime() + lead) continue;
        if (Date.now() - started > budgetMs) {
            summary.remaining++;
            continue;
        }
        if (Date.parse(slot.publish_at) < now.getTime() - MISSED_AFTER_MS) {
            await supabase.from(SLOTS_TABLE).update({ status: "skipped", skip_reason: "no alcanzó a publicarse a tiempo", updated_at: nowIso() }).eq("id", slot.id).eq("status", "planned");
            summary.skipped++;
            continue;
        }
        if (series.sold_out_at && slot.variant !== "sold_out") {
            await supabase.from(SLOTS_TABLE).update({ status: "skipped", skip_reason: "agotado", updated_at: nowIso() }).eq("id", slot.id).eq("status", "planned");
            summary.skipped++;
            continue;
        }
        const { count } = await supabase
            .from(SLOTS_TABLE)
            .update({ status: "rendering", claimed_at: nowIso(), attempts: Number(slot.attempts || 0) + 1, updated_at: nowIso() }, { count: "exact" })
            .eq("id", slot.id)
            .eq("status", "planned");
        if (!count) continue;
        try {
            if (!events.has(Number(series.event_id))) events.set(Number(series.event_id), await loadSeriesEvent(supabase, Number(series.event_id)));
            const event = events.get(Number(series.event_id));
            if (!event) throw new Error("El evento ya no existe");
            if (!captions.has(series.id)) {
                const prev = await loadSlots(supabase, series.id);
                captions.set(series.id, prev.map((p) => p.caption).filter(Boolean));
            }
            if (!bodies.has(series.id)) bodies.set(series.id, new Map());
            const caption = await dispatchSlot(supabase, series, event, slot, origin, now, captions.get(series.id)!, bodies.get(series.id)!);
            if (caption) captions.get(series.id)!.push(caption);
            summary.dispatched++;
        } catch (err: any) {
            const message = String(err?.userMessage || err?.message || err).slice(0, 480);
            const disconnected = err instanceof ZernioError && (err.code === "ACCOUNT_DISCONNECTED" || err.code === "reconnect_required" || (err.status === 403 && /disconnect|reconnect/i.test(message)));
            if (disconnected && platform !== "instagram") {
                // Solo esa red se detiene: Instagram y la otra red siguen
                await supabase.from(SLOTS_TABLE).update({ status: "failed", claimed_at: null, error: message, updated_at: nowIso() }).eq("id", slot.id);
                byId.set(Number(series.id), await disconnectNetwork(supabase, series, platform as ExtraNetwork, message));
                summary.failed++;
                continue;
            }
            if (disconnected) {
                await supabase.from(SLOTS_TABLE).update({ status: "planned", claimed_at: null, error: message, updated_at: nowIso() }).eq("id", slot.id);
                await supabase.from("social_accounts").update({ status: "expired" }).eq("organization_id", series.organization_id).eq("zernio_account_id", series.zernio_account_id);
                const paused = await pauseSeries(supabase, series, "instagram_disconnected", origin, IG_DISCONNECTED_NOTICE).catch(() => null);
                if (paused) await notifyInstagramDisconnected(supabase, series, events.get(Number(series.event_id)), origin);
                byId.delete(Number(series.id));
                summary.failed++;
                continue;
            }
            if (isRetryable(err) && Number(slot.attempts || 0) + 1 < MAX_ATTEMPTS) {
                await supabase.from(SLOTS_TABLE).update({ status: "planned", claimed_at: null, error: message, updated_at: nowIso() }).eq("id", slot.id);
                summary.retried++;
            } else {
                await supabase.from(SLOTS_TABLE).update({ status: "failed", claimed_at: null, error: message, updated_at: nowIso() }).eq("id", slot.id);
                summary.failed++;
                await notifySlack(`⚠️ *Historia automática fallida* (serie ${series.id}, evento ${series.event_id}, slot ${slot.id} ${NETWORK_NAMES[platform]} ${slot.kind} ${localDateTime(slot.publish_at)}): ${message}`);
            }
        }
    }
    return summary;
}

// ---------------------------------------------------------------------------
// Webhooks de Zernio
// ---------------------------------------------------------------------------

async function slotForPost(supabase: any, post: any): Promise<any | null> {
    const slotId = Number(post?.metadata?.aitickets_slot_id);
    if (Number.isInteger(slotId) && slotId > 0) {
        const { data } = await supabase.from(SLOTS_TABLE).select("*").eq("id", slotId).maybeSingle();
        if (data && (!data.zernio_post_id || !post?.id || data.zernio_post_id === String(post.id))) return data;
    }
    if (!post?.id) return null;
    const { data } = await supabase.from(SLOTS_TABLE).select("*").eq("zernio_post_id", String(post.id)).limit(1);
    return data?.[0] || null;
}

/** Procesa un webhook de Zernio (ya verificado y deduplicado). Devuelve un resumen para el registro. */
export async function handleZernioWebhook(supabase: any, payload: any, origin: string): Promise<string> {
    const event = String(payload?.event || "");
    if (event.startsWith("post.")) {
        const post = payload.post || {};
        const slot = await slotForPost(supabase, post);
        if (!slot) return "post ajeno a las series";
        const platforms: any[] = Array.isArray(post.platforms) ? post.platforms : [];
        const slotPlatform: SeriesPlatform = slot.platform || "instagram";
        const ig = (payload.platform?.platform === slotPlatform ? payload.platform : null) || platforms.find((p) => p?.platform === slotPlatform) || platforms[0] || {};
        if (event === "post.platform.published" || event === "post.published") {
            await supabase
                .from(SLOTS_TABLE)
                .update({ status: "published", published_at: post.publishedAt || nowIso(), platform_post_url: ig.publishedUrl || null, error: null, updated_at: nowIso() })
                .eq("id", slot.id)
                .in("status", ["queued", "rendering", "planned", "failed"]);
            return `slot ${slot.id} publicado`;
        }
        if (event === "post.platform.failed" || event === "post.failed" || event === "post.partial") {
            const error = String(ig.error || ig.platformError?.message || `${NETWORK_NAMES[slotPlatform]} rechazó la publicación`).slice(0, 480);
            await supabase.from(SLOTS_TABLE).update({ status: "failed", error, updated_at: nowIso() }).eq("id", slot.id).in("status", ["queued", "rendering", "planned"]);
            if (ig.errorCategory === "auth_expired" || ig.errorCategory === "account_issue") {
                const { data: series } = await supabase.from(SERIES_TABLE).select("*").eq("id", slot.series_id).maybeSingle();
                if (series?.status === "active" && slotPlatform !== "instagram") {
                    await disconnectNetwork(supabase, series, slotPlatform as ExtraNetwork, error);
                } else if (series?.status === "active") {
                    await supabase.from("social_accounts").update({ status: "expired" }).eq("organization_id", series.organization_id).eq("zernio_account_id", series.zernio_account_id);
                    await pauseSeries(supabase, series, "instagram_disconnected", origin, IG_DISCONNECTED_NOTICE).catch(() => null);
                    await notifyInstagramDisconnected(supabase, series, await loadSeriesEvent(supabase, Number(series.event_id)), origin);
                }
            }
            return `slot ${slot.id} fallido`;
        }
        if (event === "post.cancelled") {
            await supabase.from(SLOTS_TABLE).update({ status: "skipped", skip_reason: "cancelado en Zernio", updated_at: nowIso() }).eq("id", slot.id).eq("status", "queued");
            return `slot ${slot.id} cancelado`;
        }
        return `${event} ignorado`;
    }
    if (event === "account.disconnected") {
        const account = payload.account || {};
        if ((account.platform === "facebook" || account.platform === "tiktok") && account.accountId) {
            const platform = account.platform as ExtraNetwork;
            await supabase
                .from("social_accounts")
                .update({ status: account.disconnectionType === "intentional" ? "revoked" : "expired" })
                .eq("platform", platform)
                .eq("zernio_account_id", String(account.accountId));
            const live = await fetchAll<any>(() => supabase.from(SERIES_TABLE).select("*").eq("status", "active").order("id", { ascending: true }));
            const affected = live.filter((s) => networkStates(s)[platform].status === "active" && networkStates(s)[platform].account_id === String(account.accountId));
            for (const s of affected) await disconnectNetwork(supabase, s, platform, "La cuenta se desconectó");
            return `${affected.length} serie(s) sin ${NETWORK_NAMES[platform]}`;
        }
        if (account.platform !== "instagram" || !account.accountId) return "cuenta no Instagram";
        await supabase
            .from("social_accounts")
            .update({ status: account.disconnectionType === "intentional" ? "revoked" : "expired" })
            .eq("platform", "instagram")
            .eq("zernio_account_id", String(account.accountId));
        const affected = await fetchAll<any>(() => supabase.from(SERIES_TABLE).select("*").eq("zernio_account_id", String(account.accountId)).eq("status", "active").order("id", { ascending: true }));
        for (const s of affected) {
            await pauseSeries(supabase, s, "instagram_disconnected", origin, IG_DISCONNECTED_NOTICE).catch(() => null);
            await notifyInstagramDisconnected(supabase, s, await loadSeriesEvent(supabase, Number(s.event_id)), origin);
        }
        return `${affected.length} serie(s) pausadas`;
    }
    return `${event} ignorado`;
}

/** Cliente por defecto (para las rutas y la función programada). */
export const seriesSupabase = () => getSupabaseAdmin();

// ---------------------------------------------------------------------------
// Resúmenes para el MCP de admin
// ---------------------------------------------------------------------------

/** Resumen de la difusión de un evento (get_event_analytics del admin). null si nunca tuvo. */
export async function seriesSummaryForEvent(supabase: any, eventId: number) {
    const series = await loadLatestSeries(supabase, eventId).catch(() => null);
    if (!series) return null;
    const slots = await loadSlots(supabase, series.id).catch(() => []);
    const count = (status: string) => slots.filter((s: any) => s.status === status).length;
    return {
        series_id: Number(series.id),
        status: series.status,
        approved_at: series.approved_at,
        publish_time: series.cadence_config?.publish_time || null,
        keyword: series.keyword,
        published: count("published"),
        pending: count("planned") + count("rendering") + count("queued"),
        failed: count("failed"),
        skipped: count("skipped"),
        notice: series.notice || null,
        dms: series.dm_stats || null,
        attributed_sales: await attributedSales(supabase, [eventId]),
    };
}

/** Difusión en la plataforma: series vivas, % de eventos próximos con serie y ventas atribuidas en el período. */
export async function platformSeriesStats(supabase: any, period: { fromIso: string; toIso: string }, events: any[]) {
    const all = await fetchAll<any>(() => supabase.from(SERIES_TABLE).select("id, event_id, organization_id, status, approved_at").order("id", { ascending: true })).catch(() => []);
    const live = all.filter((s) => s.status === "active" || s.status === "paused");
    const now = Date.now();
    const upcoming = events.filter((e) => e.status === "published" && !e.cancelled_at && e.end_date && Date.parse(e.end_date) > now);
    const withSeries = new Set(live.map((s) => Number(s.event_id)));
    const seriesEventIds = [...new Set(all.filter((s) => s.approved_at).map((s) => Number(s.event_id)))];
    const attributed = await attributedSales(supabase, seriesEventIds, period);
    return {
        active_series: live.filter((s) => s.status === "active").length,
        paused_series: live.filter((s) => s.status === "paused").length,
        approved_in_period: all.filter((s) => s.approved_at && s.approved_at >= period.fromIso && s.approved_at < period.toIso).length,
        upcoming_published_events: upcoming.length,
        upcoming_events_with_series_pct: upcoming.length ? Math.round((upcoming.filter((e) => withSeries.has(Number(e.id))).length / upcoming.length) * 1000) / 10 : null,
        attributed_in_period: { orders: attributed.orders, tickets: attributed.tickets, gross_clp: attributed.gross_clp, aitickets_fee_net_clp: attributed.fee_net_clp },
        note: "Ventas atribuidas = órdenes con ref ig-story-dm / ig-post-dm / fb-post-dm (link del DM automático) o fb-serie / tiktok-serie (link en el texto), sin cortesías ni transferencias.",
    };
}
