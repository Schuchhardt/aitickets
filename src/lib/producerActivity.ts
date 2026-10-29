// Bitácora de uso del panel de productores (aitickets_producer_activity): registro de cada página del panel (lo
// llama src/layouts/DashboardLayout.astro) y saneamiento de los lotes que manda el navegador
// (src/lib/producerActivityClient.js → POST /api/dashboard/journal). El análisis (sesiones, tiempo por sección,
// fricción) vive en src/lib/producerActivityAnalysis.ts y se consulta desde el MCP de admin.
//
// Reglas: la organización y el usuario salen SIEMPRE de la sesión del servidor; todo texto se vuelve a sanear
// (redactText); nunca se guardan valores de formularios; registrar nunca hace fallar una página ni una petición, y
// se tolera que la tabla no exista (deploy previews sobre la BD sin migrar). PRODUCER_ACTIVITY_ENABLED=false la apaga.
import { randomUUID } from "node:crypto";
import { CLIENT_ACTIVITY_TYPES, MAX_BATCH_EVENTS, redactText } from "./activityShared.js";
import { getSupabaseAdmin } from "./auth-helpers";
import { serverEnv } from "../pages/api/_lib/server-utils";
import type { SessionContext } from "./supabaseServer";

export const ACTIVITY_TABLE = "aitickets_producer_activity";

/** Tamaño máximo del cuerpo de un lote (bytes). */
export const MAX_ACTIVITY_BODY = 64 * 1024;
/** Hechos más antiguos que esto (por reloj corregido) se fechan en este límite. */
const MAX_EVENT_AGE_MS = 6 * 3600_000;

const ROUTE_RE = /^\/dashboard(?:\/[A-Za-z0-9_\-.[\]]{1,80}){0,6}\/?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const API_TARGET_RE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \/api\/[A-Za-z0-9/_\-.[\]]{1,180}$/;
const HASH_RE = /^#[\w-]{1,40}$/;

/** Parámetros de la URL del panel que se guardan (el resto se descarta: búsquedas, tokens, correos). */
const QUERY_KEYS = ["tab", "event", "event_id", "status", "post", "connected", "error", "identidad", "bienvenida", "step", "view", "filter", "period"];

const isMissingTable = (error: any) => ["42P01", "PGRST205", "42703", "PGRST204"].includes(String(error?.code || ""));

export const producerActivityEnabled = () => serverEnv("PRODUCER_ACTIVITY_ENABLED") !== "false";

const intOrNull = (v: unknown, max = 2_147_483_647) => {
    const n = Number(v);
    return v != null && v !== "" && Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), max) : null;
};
const text = (v: unknown, max: number) => redactText(typeof v === "string" || typeof v === "number" ? String(v) : "", max) || null;

/** Ruta del panel válida (sin query), o null. */
export function cleanDashboardPath(v: unknown): string | null {
    if (typeof v !== "string") return null;
    const path = v.split(/[?#]/)[0];
    return ROUTE_RE.test(path) && path.length <= 300 ? path.replace(/(.)\/$/, "$1") : null;
}

/** Evento al que se refiere la página: /dashboard/events/<id>/… o ?event=<id> / ?event_id=<id>. */
export function eventIdFromPath(path: string | null, query?: Record<string, string>): number | null {
    const m = path ? /^\/dashboard\/events\/(\d{1,12})(?:\/|$)/.exec(path) : null;
    const raw = m?.[1] || query?.event_id || query?.event;
    const n = Number(raw);
    return raw && /^\d{1,12}$/.test(String(raw)) && n > 0 ? n : null;
}

/** Parámetros permitidos de la URL (QUERY_KEYS), saneados. */
export function cleanQuery(search: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (typeof search !== "string" || !search) return out;
    let params: URLSearchParams;
    try {
        params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    } catch {
        return out;
    }
    for (const key of QUERY_KEYS) {
        const v = params.get(key);
        const clean = v == null ? "" : redactText(v, 60);
        if (clean) out[key] = clean;
    }
    return out;
}

/** Dispositivo, navegador y sistema a partir del User-Agent (sin guardar el User-Agent). */
export function deviceFromUserAgent(ua: string | null | undefined) {
    const s = String(ua || "");
    const device = /iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(s) ? "tablet" : /Mobi|iPhone|iPod|Android/i.test(s) ? "mobile" : "desktop";
    const browser = /Edg\//.test(s)
        ? "Edge"
        : /SamsungBrowser/.test(s)
          ? "Samsung"
          : /OPR\//.test(s)
            ? "Opera"
            : /Firefox|FxiOS/.test(s)
              ? "Firefox"
              : /Chrome|CriOS/.test(s)
                ? "Chrome"
                : /Safari/.test(s)
                  ? "Safari"
                  : "otro";
    const os = /iPhone|iPad|iPod/.test(s) ? "iOS" : /Android/.test(s) ? "Android" : /Windows/.test(s) ? "Windows" : /Mac OS X|Macintosh/.test(s) ? "macOS" : /Linux/.test(s) ? "Linux" : "otro";
    return { device, browser, os };
}

/** De dónde llegó: ruta del mismo sitio o el host externo (correo, Google…). */
function referrerOf(referer: string | null, ownHost: string): string | null {
    if (!referer) return null;
    try {
        const url = new URL(referer);
        if (url.host === ownHost) return url.pathname.slice(0, 120) || "/";
        return url.host.slice(0, 120);
    } catch {
        return null;
    }
}

/** Inserta filas en la bitácora. Nunca lanza: devuelve false si no se pudo. */
export async function insertActivityRows(supabase: any, rows: Record<string, unknown>[]): Promise<boolean> {
    if (!rows.length) return true;
    try {
        const { error } = await supabase.from(ACTIVITY_TABLE).insert(rows);
        if (!error) return true;
        if (!isMissingTable(error)) console.warn("producer activity:", error.message);
    } catch (err: any) {
        console.warn("producer activity:", err?.message || err);
    }
    return false;
}

type PageViewAstro = {
    url: URL;
    request: Request;
    routePattern?: string;
    locals: any;
};

/** ¿La petición es una precarga (Speculation Rules / prefetch) y no una visita? Chrome manda Sec-Purpose: prefetch[;prerender]. */
export const isSpeculativeRequest = (request: Request) => /prefetch/i.test(request.headers.get("sec-purpose") || request.headers.get("purpose") || "");

/** Fila page_view de una página del panel. La organización y el usuario salen de la sesión. */
export function buildPageViewRow(
    session: SessionContext,
    page: { id: string; path: string; route: string; search: string; referer: string | null; ownHost: string; userAgent: string | null },
) {
    const query = cleanQuery(page.search);
    return {
        organization_id: Number(session.dbUser.organization_id),
        user_id: Number(session.dbUser.id),
        page_view_id: page.id,
        type: "page_view",
        occurred_at: new Date().toISOString(),
        path: page.path,
        route: page.route,
        event_id: eventIdFromPath(page.path, query),
        data: {
            ...(Object.keys(query).length ? { query } : {}),
            from: referrerOf(page.referer, page.ownHost),
            role: session.dbUser.role || null,
            ...deviceFromUserAgent(page.userAgent),
        },
    };
}

/**
 * Registra la página del panel que se está renderizando (page_view) y devuelve su id y patrón de ruta para que el
 * rastreador del navegador les cuelgue sus hechos. null si la bitácora está apagada o no hay sesión.
 * Si es una precarga (el productor pasó el mouse por un enlace, src/lib/dashboardNav.js) no se registra todavía:
 * vuelve con deferred y el navegador lo registra al abrirla de verdad (page_view en el lote, sanitizeActivityBatch).
 */
export async function recordDashboardPageView(
    Astro: PageViewAstro,
    session: SessionContext | null,
): Promise<{ id: string; route: string; deferred: boolean } | null> {
    if (!session || !producerActivityEnabled()) return null;
    const path = cleanDashboardPath(Astro.url.pathname);
    if (!path) return null;
    const route = (Astro.routePattern && ROUTE_RE.test(Astro.routePattern) ? Astro.routePattern : path).slice(0, 200);
    const id = randomUUID();
    if (isSpeculativeRequest(Astro.request)) return { id, route, deferred: true };
    const row = buildPageViewRow(session, {
        id,
        path,
        route,
        search: Astro.url.search,
        referer: Astro.request.headers.get("referer"),
        ownHost: Astro.url.host,
        userAgent: Astro.request.headers.get("user-agent"),
    });
    const write = insertActivityRows(getSupabaseAdmin(), [row]);
    // waitUntil (Netlify) deja responder sin esperar a la BD; sin él se espera (insertActivityRows nunca lanza)
    const waitUntil = Astro.locals?.netlify?.context?.waitUntil;
    if (typeof waitUntil === "function") waitUntil(write);
    else await write;
    return { id, route, deferred: false };
}

// ---------------------------------------------------------------------------
// Lotes del navegador
// ---------------------------------------------------------------------------

type DataSpec = Record<string, "int" | "bool" | "text" | "short" | "path" | "hash" | "enum" | "props">;

/** Campos de `data` permitidos por tipo (lo demás se descarta). */
const DATA_SPEC: Record<string, DataSpec> = {
    page_time: { active_ms: "int", visible_ms: "int", max_scroll_pct: "int", clicks: "int", fields_touched: "int", load_ms: "int", final: "bool", viewport: "short" },
    click: { kind: "short", href: "path" },
    rage_click: { count: "int", kind: "short" },
    dead_click: { count: "int", looks_clickable: "bool" },
    form_start: { fields: "int" },
    form_submit: { fields: "int", fields_touched: "int" },
    navigation: { from: "hash", to: "hash" },
    api_call: { method: "short" },
    api_error: { method: "short", network: "bool" },
    js_error: { kind: "short", source: "path", line: "int", col: "int", stack: "text" },
    ui_message: { source: "enum", level: "enum", result: "enum" },
    custom: { props: "props" },
};
const ENUMS: Record<string, string[]> = {
    source: ["alert", "confirm", "toast"],
    level: ["error", "warning", "success", "info"],
    result: ["accepted", "cancelled"],
};

function cleanProps(v: unknown): Record<string, string | number | boolean> {
    const out: Record<string, string | number | boolean> = {};
    if (!v || typeof v !== "object" || Array.isArray(v)) return out;
    for (const [k, val] of Object.entries(v).slice(0, 10)) {
        if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) continue;
        if (typeof val === "number" && Number.isFinite(val)) out[k] = val;
        else if (typeof val === "boolean") out[k] = val;
        else if (typeof val === "string") {
            const clean = redactText(val, 100);
            if (clean) out[k] = clean;
        }
    }
    return out;
}

function cleanData(type: string, raw: unknown): Record<string, unknown> {
    const spec = DATA_SPEC[type] || {};
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const out: Record<string, unknown> = {};
    for (const [key, kind] of Object.entries(spec)) {
        const v = src[key];
        if (v == null) continue;
        let clean: unknown = null;
        if (kind === "int") clean = intOrNull(v, 100_000_000);
        else if (kind === "bool") clean = typeof v === "boolean" ? v : null;
        else if (kind === "short") clean = text(v, 40);
        else if (kind === "text") clean = typeof v === "string" ? redactText(v, 800) || null : null;
        else if (kind === "path") clean = typeof v === "string" && /^(\/[^\s]{0,159}|[a-z0-9.-]{1,120}|mailto|tel|#[\w-]{1,40})$/i.test(v) ? redactText(v, 160) : null;
        else if (kind === "hash") clean = typeof v === "string" && HASH_RE.test(v) ? v : typeof v === "string" && v === "" ? "" : null;
        else if (kind === "enum") clean = typeof v === "string" && ENUMS[key]?.includes(v) ? v : null;
        else if (kind === "props") clean = cleanProps(v);
        if (clean !== null && clean !== undefined) out[key] = clean;
    }
    return out;
}

export type ActivityBatchResult =
    | { ok: true; rows: Record<string, unknown>[]; pageView: { id: string; path: string; route: string; search: string; referrer: string | null } | null }
    | { ok: false; error: string };

/**
 * Valida y sanea un lote del navegador. Devuelve las filas listas para insertar SIN organization_id ni user_id
 * (los agrega el endpoint desde la sesión). Hechos con tipo desconocido se descartan; un lote mal formado es error.
 * La hora de cada hecho se corrige con el desfase del reloj del navegador (sent_at vs. la hora del servidor).
 */
export function sanitizeActivityBatch(body: any, now = Date.now()): ActivityBatchResult {
    if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Cuerpo inválido" };
    const pv = typeof body.pv === "string" && UUID_RE.test(body.pv) ? body.pv.toLowerCase() : null;
    if (!pv) return { ok: false, error: "pv inválido" };
    const path = cleanDashboardPath(body.path);
    if (!path) return { ok: false, error: "path inválido" };
    if (!Array.isArray(body.events)) return { ok: false, error: "events inválido" };
    const route = typeof body.route === "string" && ROUTE_RE.test(body.route) ? body.route.slice(0, 200) : path;
    const query = cleanQuery(body.search);
    const eventId = eventIdFromPath(path, query);
    const sentAt = Number(body.sent_at);
    const skew = Number.isFinite(sentAt) && sentAt > 0 ? now - sentAt : 0;

    const rows: Record<string, unknown>[] = [];
    for (const ev of body.events.slice(0, MAX_BATCH_EVENTS)) {
        if (!ev || typeof ev !== "object" || !CLIENT_ACTIVITY_TYPES.includes(ev.type)) continue;
        const at = Number(ev.at);
        const corrected = Number.isFinite(at) && at > 0 ? at + skew : now;
        const occurred = Math.min(now, Math.max(now - MAX_EVENT_AGE_MS, corrected));
        let target = text(ev.target, 120);
        if (ev.type === "api_call" || ev.type === "api_error") {
            target = typeof ev.target === "string" && API_TARGET_RE.test(ev.target) ? redactText(ev.target, 200) : null;
            if (!target) continue;
        }
        rows.push({
            page_view_id: pv,
            type: ev.type,
            occurred_at: new Date(occurred).toISOString(),
            path,
            route,
            event_id: eventId,
            label: text(ev.label, ev.type === "js_error" || ev.type === "api_error" || ev.type === "ui_message" ? 300 : 120),
            target,
            status: ev.type === "api_call" || ev.type === "api_error" ? intOrNull(ev.status, 999) : null,
            duration_ms: intOrNull(ev.duration_ms, 100_000_000),
            data: cleanData(ev.type, ev.data),
        });
    }
    // Página que se precargó y el productor acaba de abrir: el servidor no registró su page_view al renderizarla
    // (recordDashboardPageView con deferred); lo registra el endpoint con los datos de la sesión.
    const pageView =
        body.page_view === true
            ? { id: pv, path, route, search: typeof body.search === "string" ? body.search : "", referrer: typeof body.referrer === "string" ? body.referrer.slice(0, 500) : null }
            : null;
    return { ok: true, rows, pageView };
}
