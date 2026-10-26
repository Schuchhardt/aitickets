// Análisis de la bitácora de uso del panel (aitickets_producer_activity) para el MCP de admin: sesiones, tiempo por
// sección, acciones, errores y fricción ("dónde se trabó"). Funciones puras sobre filas ya leídas.
//
// - Sesión: hechos de un mismo usuario sin pausas de más de 30 min (varias pestañas cuentan como una sesión). Los
//   page_time se asignan a la sesión de su página aunque lleguen tarde (pestaña que quedó abierta).
// - Tiempo por sección: el tiempo ACTIVO que midió el navegador (interacción en el último minuto, pestaña visible).
//   Si la página no mandó datos (bloqueador, JS que no cargó) se estima con la página siguiente (time_estimated).
// - Fricción: señales con evidencia. Los umbrales están en FRICTION_THRESHOLDS para ajustarlos con datos.
import { localDateTime } from "./producer-api/tools/common";

export type ActivityRow = {
    id: number;
    occurred_at: string;
    organization_id?: number | null;
    user_id: number | null;
    page_view_id: string | null;
    type: string;
    path: string | null;
    route: string | null;
    event_id: number | null;
    label: string | null;
    target: string | null;
    status: number | null;
    duration_ms: number | null;
    data: Record<string, any> | null;
};

export const SESSION_GAP_MS = 30 * 60_000;

export const FRICTION_THRESHOLDS = {
    /** Tiempo activo en una página de edición sin guardar nada. */
    longDwellMs: 5 * 60_000,
    /** Llamada a la API que se considera lenta. */
    slowActionMs: 8000,
    /** Veces que abre la misma sección en una sesión. */
    loopVisits: 4,
    /** Formulario abandonado: tiempo activo mínimo en la página para que cuente como "medium". */
    formAbandonMs: 60_000,
    /** Tope de la estimación de tiempo de una página sin datos del navegador. */
    maxEstimatedMs: 10 * 60_000,
};

/** Nombre de cada sección del panel (patrón de ruta de Astro). */
export const SECTION_LABELS: Record<string, string> = {
    "/dashboard": "Resumen",
    "/dashboard/events": "Mis eventos",
    "/dashboard/events/create": "Crear evento",
    "/dashboard/events/[id]": "Evento",
    "/dashboard/events/[id]/edit": "Editar evento",
    "/dashboard/events/[id]/analytics": "Analítica del evento",
    "/dashboard/events/[id]/checkin": "Check-in del evento",
    "/dashboard/tickets": "Entradas",
    "/dashboard/community": "Comunidad",
    "/dashboard/descuentos": "Descuentos",
    "/dashboard/finance": "Ingresos",
    "/dashboard/promote": "Promocionar",
    "/dashboard/promote/create": "Crear publicación",
    "/dashboard/promote/ads/create": "Crear anuncio",
    "/dashboard/ia": "Conecta tu IA",
    "/dashboard/sitio": "Mi sitio web",
    "/dashboard/team": "Equipo",
    "/dashboard/settings": "Configuración",
    "/dashboard/profile": "Mi perfil",
};

/** Secciones de lectura: pasar mucho rato en ellas no es una señal de que esté trabado. */
const READ_ROUTES = new Set([
    "/dashboard",
    "/dashboard/events",
    "/dashboard/events/[id]/analytics",
    "/dashboard/events/[id]/checkin",
    "/dashboard/tickets",
    "/dashboard/community",
    "/dashboard/finance",
    "/dashboard/ia",
]);

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;

export function sectionLabel(route: string | null | undefined, eventId?: number | null): string {
    const base = (route && SECTION_LABELS[route]) || route || "(sin ruta)";
    return eventId && route?.includes("[id]") ? `${base} #${eventId}` : base;
}

const ms = (iso: string) => Date.parse(iso);

/** "45 s", "3 min 20 s", "1 h 5 min". */
export function fmtDuration(value: number | null | undefined): string {
    const total = Math.max(0, Math.round((Number(value) || 0) / 1000));
    if (total < 60) return `${total} s`;
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h) return m ? `${h} h ${m} min` : `${h} h`;
    return s && m < 10 ? `${m} min ${s} s` : `${m} min`;
}

const minutes = (value: number) => Math.round((value / 60_000) * 10) / 10;
const methodOf = (r: ActivityRow) => String(r.data?.method || r.target?.split(" ")[0] || "GET").toUpperCase();
/** Escritura (POST/PUT/PATCH/DELETE) que la API aceptó: algo que el productor logró guardar. */
export const isWriteOk = (r: ActivityRow) => r.type === "api_call" && WRITE_METHODS.has(methodOf(r)) && (r.status ?? 200) < 400;
/** Error que vio el productor: de la API, de JavaScript o un mensaje de error en pantalla. */
export const isErrorRow = (r: ActivityRow) => r.type === "api_error" || r.type === "js_error" || (r.type === "ui_message" && r.data?.level === "error");
const quote = (v: string | null | undefined) => (v ? `"${v}"` : "(sin texto)");

// ---------------------------------------------------------------------------
// Sesiones y páginas
// ---------------------------------------------------------------------------

export type PageVisit = {
    page_view_id: string;
    route: string | null;
    path: string | null;
    section: string;
    event_id: number | null;
    started_at: string;
    /** Tiempo activo medido por el navegador (null si no mandó datos). */
    active_ms: number | null;
    visible_ms: number | null;
    /** active_ms o, si falta, la estimación. */
    time_ms: number;
    time_estimated: boolean;
    max_scroll_pct: number | null;
    load_ms: number | null;
    fields_touched: number;
    clicks: number;
    writes_ok: number;
    errors: number;
    has_client_data: boolean;
    data: Record<string, any>;
    rows: ActivityRow[];
};

export type Session = {
    id: string;
    user_id: number | null;
    organization_id: number | null;
    started_at: string;
    ended_at: string;
    rows: ActivityRow[];
    pages: PageVisit[];
};

function buildPages(rows: ActivityRow[]): PageVisit[] {
    const byPv = new Map<string, ActivityRow[]>();
    for (const r of rows) {
        const key = r.page_view_id || `sin-pv:${r.route || r.path || ""}`;
        const list = byPv.get(key);
        if (list) list.push(r);
        else byPv.set(key, [r]);
    }
    const pages: PageVisit[] = [];
    for (const [pv, list] of byPv) {
        const view = list.find((r) => r.type === "page_view");
        const first = view || list[0];
        const times = list.filter((r) => r.type === "page_time");
        const last = times.reduce<ActivityRow | null>((best, r) => (!best || Number(r.data?.active_ms ?? r.duration_ms ?? 0) >= Number(best.data?.active_ms ?? best.duration_ms ?? 0) ? r : best), null);
        const firstTime = times.find((r) => r.data?.load_ms != null) || null;
        const active = last ? Number(last.data?.active_ms ?? last.duration_ms ?? 0) : null;
        pages.push({
            page_view_id: pv,
            route: first.route,
            path: first.path,
            section: sectionLabel(first.route, first.event_id),
            event_id: first.event_id,
            started_at: first.occurred_at,
            active_ms: active,
            visible_ms: last ? Number(last.data?.visible_ms ?? 0) || null : null,
            time_ms: active ?? 0,
            time_estimated: active == null,
            max_scroll_pct: last?.data?.max_scroll_pct ?? null,
            load_ms: firstTime?.data?.load_ms ?? null,
            fields_touched: Number(last?.data?.fields_touched || 0),
            clicks: list.filter((r) => r.type === "click").length,
            writes_ok: list.filter(isWriteOk).length,
            errors: list.filter(isErrorRow).length,
            has_client_data: list.some((r) => r.type !== "page_view"),
            data: view?.data || {},
            rows: list,
        });
    }
    pages.sort((a, b) => ms(a.started_at) - ms(b.started_at));
    // Páginas sin datos del navegador: se estima con el inicio de la página siguiente (con tope)
    pages.forEach((p, i) => {
        if (!p.time_estimated) return;
        const next = pages[i + 1];
        p.time_ms = next ? Math.min(Math.max(0, ms(next.started_at) - ms(p.started_at)), FRICTION_THRESHOLDS.maxEstimatedMs) : 0;
    });
    return pages;
}

/**
 * Agrupa las filas en sesiones por usuario (y organización). Las pausas de más de `gapMs` sin interacción cortan la sesión; los
 * page_time no cortan (llegan cuando se cierra una pestaña que quedó abierta) y van a la sesión de su página.
 */
export function buildSessions(rows: ActivityRow[], gapMs = SESSION_GAP_MS): Session[] {
    const sorted = [...rows].sort((a, b) => ms(a.occurred_at) - ms(b.occurred_at) || Number(a.id) - Number(b.id));
    // Por organización y usuario (un usuario borrado queda con user_id null en cada organización)
    const byUser = new Map<string, ActivityRow[]>();
    for (const r of sorted) {
        const key = `${r.organization_id ?? ""}|${Number(r.user_id || 0)}`;
        const list = byUser.get(key);
        if (list) list.push(r);
        else byUser.set(key, [r]);
    }
    const sessions: Session[] = [];
    for (const list of byUser.values()) {
        const userId = Number(list[0].user_id || 0);
        const userSessions: { rows: ActivityRow[]; lastAt: number }[] = [];
        const sessionOfPv = new Map<string, { rows: ActivityRow[]; lastAt: number }>();
        const late: ActivityRow[] = [];
        for (const r of list) {
            if (r.type === "page_time" && r.page_view_id) {
                late.push(r);
                continue;
            }
            const t = ms(r.occurred_at);
            let current = userSessions[userSessions.length - 1];
            if (!current || t - current.lastAt > gapMs) {
                current = { rows: [], lastAt: t };
                userSessions.push(current);
            }
            current.rows.push(r);
            current.lastAt = t;
            if (r.page_view_id && !sessionOfPv.has(r.page_view_id)) sessionOfPv.set(r.page_view_id, current);
        }
        for (const r of late) {
            let s = sessionOfPv.get(r.page_view_id!);
            if (!s) {
                // Página sin page_view ni otros hechos: la sesión más cercana anterior, o una nueva
                const t = ms(r.occurred_at);
                s = [...userSessions].reverse().find((x) => ms(x.rows[0].occurred_at) <= t && t - x.lastAt <= gapMs);
                if (!s) {
                    s = { rows: [], lastAt: t };
                    userSessions.push(s);
                }
                sessionOfPv.set(r.page_view_id!, s);
            }
            s.rows.push(r);
        }
        for (const s of userSessions) {
            s.rows.sort((a, b) => ms(a.occurred_at) - ms(b.occurred_at) || Number(a.id) - Number(b.id));
            const firstRow = s.rows.reduce((min, r) => (Number(r.id) < Number(min.id) ? r : min), s.rows[0]);
            const interactions = s.rows.filter((r) => r.type !== "page_time");
            const lastInteraction = interactions.length ? ms(interactions[interactions.length - 1].occurred_at) : ms(s.rows[0].occurred_at);
            // El último page_time cuenta si llegó dentro de la pausa máxima (si no, la pestaña quedó abandonada)
            const end = s.rows.reduce((max, r) => {
                const t = ms(r.occurred_at);
                return t > max && t - lastInteraction <= gapMs ? t : max;
            }, lastInteraction);
            sessions.push({
                id: `${userId}-${firstRow.id}`,
                user_id: userId || null,
                organization_id: s.rows[0].organization_id ?? null,
                started_at: s.rows[0].occurred_at,
                ended_at: new Date(end).toISOString(),
                rows: s.rows,
                pages: buildPages(s.rows),
            });
        }
    }
    sessions.sort((a, b) => ms(b.started_at) - ms(a.started_at));
    return sessions;
}

// ---------------------------------------------------------------------------
// Fricción
// ---------------------------------------------------------------------------

export type FrictionKind =
    | "rage_click"
    | "dead_click"
    | "repeated_error"
    | "error_abandon"
    | "session_expired"
    | "load_error"
    | "js_error"
    | "error_message"
    | "confirm_cancelled"
    | "form_abandon"
    | "long_dwell"
    | "loop"
    | "slow_action";

export type Friction = {
    kind: FrictionKind;
    severity: "high" | "medium" | "low";
    at: string;
    section: string;
    route: string | null;
    event_id: number | null;
    count: number;
    label: string | null;
    target: string | null;
    summary: string;
};

/** Señales de que el productor se trabó en una sesión, de la más grave a la menos grave. */
export function detectFriction(session: Session): Friction[] {
    const out: Friction[] = [];
    const add = (f: Omit<Friction, "route" | "event_id" | "section"> & { page: PageVisit }) => {
        const { page, ...rest } = f;
        out.push({ ...rest, section: page.section, route: page.route, event_id: page.event_id });
    };
    const T = FRICTION_THRESHOLDS;

    for (const page of session.pages) {
        const rows = page.rows;
        const where = page.section;

        for (const r of rows.filter((x) => x.type === "rage_click")) {
            const n = Number(r.data?.count || 3);
            add({ page, kind: "rage_click", severity: "high", at: r.occurred_at, count: n, label: r.label, target: r.target, summary: `Clics repetidos (${n} en 1 s) en ${quote(r.label)}${r.target ? ` (${r.target})` : ""} en ${where}` });
        }

        const dead = new Map<string, ActivityRow[]>();
        for (const r of rows.filter((x) => x.type === "dead_click")) {
            const key = `${r.label}|${r.target}`;
            dead.set(key, [...(dead.get(key) || []), r]);
        }
        for (const list of dead.values()) {
            const r = list[list.length - 1];
            const n = list.reduce((sum, x) => sum + Number(x.data?.count || 1), 0);
            add({ page, kind: "dead_click", severity: n >= 2 ? "medium" : "low", at: r.occurred_at, count: n, label: r.label, target: r.target, summary: `Clic sin respuesta en ${quote(r.label)}${r.target ? ` (${r.target})` : ""} en ${where}${n > 1 ? ` (${n} veces)` : ""}` });
        }

        // Errores de la API agrupados por endpoint: ¿lo volvió a intentar? ¿lo logró?
        const apiErrors = new Map<string, ActivityRow[]>();
        for (const r of rows.filter((x) => x.type === "api_error")) apiErrors.set(r.target || "", [...(apiErrors.get(r.target || "") || []), r]);
        for (const [target, list] of apiErrors) {
            const lastErr = list[list.length - 1];
            const msg = lastErr.label || (lastErr.status === 0 ? "Sin conexión" : null);
            const status = lastErr.status === 0 ? "sin conexión" : String(lastErr.status ?? "?");
            if (list.some((r) => r.status === 401)) {
                add({ page, kind: "session_expired", severity: "medium", at: lastErr.occurred_at, count: list.length, label: msg, target, summary: `Se le cerró la sesión en ${where} al intentar ${target}` });
                continue;
            }
            const firstAt = ms(list[0].occurred_at);
            const method = methodOf(lastErr);
            if (!WRITE_METHODS.has(method)) {
                add({ page, kind: "load_error", severity: "medium", at: lastErr.occurred_at, count: list.length, label: msg, target, summary: `No cargó ${target} (${status}) en ${where}: ${quote(msg)}${list.length > 1 ? ` (${list.length} veces)` : ""}` });
                continue;
            }
            const resolved = rows.some((r) => r.type === "api_call" && r.target === target && (r.status ?? 200) < 400 && ms(r.occurred_at) >= firstAt);
            if (list.length >= 2) {
                add({
                    page,
                    kind: "repeated_error",
                    severity: resolved ? "medium" : "high",
                    at: lastErr.occurred_at,
                    count: list.length,
                    label: msg,
                    target,
                    summary: resolved
                        ? `Falló ${list.length} veces ${target} en ${where} antes de lograrlo: ${quote(msg)}`
                        : `Falló ${list.length} veces ${target} en ${where} y no lo logró: ${quote(msg)} (${status})`,
                });
            } else if (!resolved) {
                add({ page, kind: "error_abandon", severity: "medium", at: lastErr.occurred_at, count: 1, label: msg, target, summary: `Error en ${target} (${status}) en ${where}: ${quote(msg)}; no lo volvió a intentar con éxito` });
            }
        }

        const jsErrors = new Map<string, ActivityRow[]>();
        for (const r of rows.filter((x) => x.type === "js_error")) jsErrors.set(r.label || "", [...(jsErrors.get(r.label || "") || []), r]);
        for (const [label, list] of jsErrors) {
            add({ page, kind: "js_error", severity: "high", at: list[list.length - 1].occurred_at, count: list.length, label, target: list[0].data?.source || null, summary: `Error de JavaScript en ${where}: ${label}${list.length > 1 ? ` (${list.length} veces)` : ""}` });
        }

        const messages = new Map<string, ActivityRow[]>();
        for (const r of rows.filter((x) => x.type === "ui_message" && x.data?.level === "error")) messages.set(r.label || "", [...(messages.get(r.label || "") || []), r]);
        for (const [label, list] of messages) {
            add({ page, kind: "error_message", severity: "medium", at: list[list.length - 1].occurred_at, count: list.length, label, target: list[0].data?.source || null, summary: `Vio el mensaje ${quote(label)} en ${where}${list.length > 1 ? ` (${list.length} veces)` : ""}` });
        }
        for (const r of rows.filter((x) => x.type === "ui_message" && x.data?.source === "confirm" && x.data?.result === "cancelled")) {
            add({ page, kind: "confirm_cancelled", severity: "low", at: r.occurred_at, count: 1, label: r.label, target: "confirm", summary: `Canceló la confirmación ${quote(r.label)} en ${where}` });
        }

        // Formulario empezado y no guardado (si hubo un error de la API después, ya quedó informado arriba)
        let abandoned = false;
        for (const start of rows.filter((x) => x.type === "form_start")) {
            const t = ms(start.occurred_at);
            const after = rows.filter((r) => ms(r.occurred_at) >= t);
            const saved = after.some((r) => isWriteOk(r) || (r.type === "form_submit" && r.label === start.label));
            const failed = after.some((r) => r.type === "api_error");
            if (saved || failed) continue;
            abandoned = true;
            add({
                page,
                kind: "form_abandon",
                severity: page.time_ms >= T.formAbandonMs ? "medium" : "low",
                at: start.occurred_at,
                count: 1,
                label: start.label,
                target: start.target,
                summary: `Empezó a completar ${quote(start.label)} en ${where} y salió sin guardar (${page.fields_touched || "algún"} campo(s) tocados, ${fmtDuration(page.time_ms)} activo)`,
            });
        }

        if (!abandoned && !page.time_estimated && page.time_ms >= T.longDwellMs && page.route && !READ_ROUTES.has(page.route) && page.writes_ok === 0) {
            add({ page, kind: "long_dwell", severity: "low", at: page.started_at, count: 1, label: null, target: null, summary: `Pasó ${fmtDuration(page.time_ms)} activo en ${where} sin guardar nada` });
        }

        for (const r of rows.filter((x) => (x.type === "api_call" || x.type === "api_error") && Number(x.duration_ms) >= T.slowActionMs)) {
            add({ page, kind: "slow_action", severity: "low", at: r.occurred_at, count: 1, label: null, target: r.target, summary: `${r.target} tardó ${fmtDuration(r.duration_ms)} en ${where}` });
        }
    }

    const visits = new Map<string, PageVisit[]>();
    for (const p of session.pages) {
        const key = `${p.route}|${p.event_id || ""}`;
        visits.set(key, [...(visits.get(key) || []), p]);
    }
    for (const list of visits.values()) {
        if (list.length < T.loopVisits) continue;
        const page = list[list.length - 1];
        add({ page, kind: "loop", severity: "low", at: page.started_at, count: list.length, label: null, target: null, summary: `Abrió ${page.section} ${list.length} veces en la misma sesión (¿buscaba algo que no encontró?)` });
    }

    return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || ms(a.at) - ms(b.at));
}

// ---------------------------------------------------------------------------
// Presentación
// ---------------------------------------------------------------------------

/** Línea legible de un hecho para la línea de tiempo (sin page_time: el tiempo va en la página). */
export function describeRow(r: ActivityRow): string | null {
    const where = r.target ? ` (${r.target})` : "";
    switch (r.type) {
        case "page_view": {
            const from = r.data?.from ? ` desde ${r.data.from}` : "";
            const query = r.data?.query ? ` ${Object.entries(r.data.query).map(([k, v]) => `${k}=${v}`).join(" ")}` : "";
            return `Abrió ${sectionLabel(r.route, r.event_id)}${query}${from}`;
        }
        case "click":
            return `Clic en ${quote(r.label)}${where}${r.data?.href && r.data.href !== r.path ? ` → ${r.data.href}` : ""}`;
        case "rage_click":
            return `Clics repetidos (${r.data?.count || 3}) en ${quote(r.label)}${where}`;
        case "dead_click":
            return `Clic sin respuesta en ${quote(r.label)}${where}`;
        case "form_start":
            return `Empezó a completar ${quote(r.label)} (${r.data?.fields ?? "?"} campos)`;
        case "form_submit":
            return `Envió ${quote(r.label)} (${r.data?.fields_touched ?? "?"} campos tocados)`;
        case "navigation":
            return `Fue a la sección ${r.data?.to || "(inicio de la página)"}`;
        case "api_call":
            return `${r.target} → ${r.status ?? "ok"} (${fmtDuration(r.duration_ms)})`;
        case "api_error":
            return `${r.target} → ${r.status === 0 ? "sin conexión" : `error ${r.status}`}: ${quote(r.label)}`;
        case "js_error":
            return `Error de JavaScript: ${r.label}${r.data?.source ? ` (${r.data.source}${r.data.line ? `:${r.data.line}` : ""})` : ""}`;
        case "ui_message": {
            const source = r.data?.source === "confirm" ? "Confirmación" : r.data?.source === "alert" ? "Alerta" : "Aviso";
            const result = r.data?.result ? ` → ${r.data.result === "accepted" ? "aceptó" : "canceló"}` : "";
            return `${source}${r.data?.level === "error" ? " de error" : ""}: ${quote(r.label)}${result}`;
        }
        case "custom":
            return `Evento propio: ${r.label}${r.data?.props && Object.keys(r.data.props).length ? ` ${JSON.stringify(r.data.props)}` : ""}`;
        default:
            return null;
    }
}

export function timeline(session: Session, limit = 300) {
    const pageOf = new Map(session.pages.map((p) => [p.page_view_id, p]));
    const entries: Array<{ at: string; at_local: string | null; type: string; section: string; text: string }> = [];
    for (const r of session.rows) {
        if (r.type === "page_time") continue;
        let text = describeRow(r);
        if (!text) continue;
        const page = pageOf.get(r.page_view_id || "");
        if (r.type === "page_view" && page) text += ` — ${fmtDuration(page.time_ms)}${page.time_estimated ? " (estimado)" : " activo"}`;
        entries.push({ at: r.occurred_at, at_local: localDateTime(r.occurred_at), type: r.type, section: page?.section || sectionLabel(r.route, r.event_id), text });
    }
    return { entries: entries.slice(0, limit), truncated: entries.length > limit, total: entries.length };
}

export type SessionSummary = ReturnType<typeof summarizeSession>;

/** Resumen de una sesión para el MCP (sin la línea de tiempo). */
export function summarizeSession(session: Session, friction: Friction[] = detectFriction(session)) {
    const activeMs = session.pages.reduce((sum, p) => sum + (p.active_ms || 0), 0);
    const view = session.rows.find((r) => r.type === "page_view");
    const device = view?.data ? [view.data.device, view.data.browser, view.data.os].filter(Boolean).join(" · ") : null;
    const actions = new Map<string, number>();
    for (const r of session.rows.filter(isWriteOk)) actions.set(r.target || "?", (actions.get(r.target || "?") || 0) + 1);
    const missing = session.pages.filter((p) => !p.has_client_data).length;
    const route = session.pages.map((p) => `${p.section} (${fmtDuration(p.time_ms)}${p.time_estimated ? "?" : ""})`);
    return {
        session_id: session.id,
        user_id: session.user_id,
        started_at: session.started_at,
        started_local: localDateTime(session.started_at),
        ended_local: localDateTime(session.ended_at),
        duration_minutes: minutes(ms(session.ended_at) - ms(session.started_at)),
        active_minutes: minutes(activeMs),
        device,
        role: view?.data?.role || null,
        pages_visited: session.pages.length,
        path: route.length > 15 ? `${route.slice(0, 15).join(" → ")} → … y ${route.length - 15} más` : route.join(" → "),
        actions_ok: [...actions.values()].reduce((a, b) => a + b, 0),
        actions: [...actions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([target, n]) => (n > 1 ? `${target} ×${n}` : target)),
        errors: session.rows.filter(isErrorRow).length,
        friction: friction.map((f) => ({ kind: f.kind, severity: f.severity, at_local: localDateTime(f.at), summary: f.summary })),
        tracking: missing
            ? `parcial: ${missing} de ${session.pages.length} página(s) sin datos del navegador (bloqueador de anuncios o JS que no cargó); su tiempo es estimado`
            : "completo",
    };
}

/** Tiempo y uso por sección sobre varias sesiones. */
export function aggregateSections(sessions: Session[], frictionOf: (s: Session) => Friction[] = detectFriction) {
    const map = new Map<string, { route: string | null; section: string; visits: number; users: Set<number>; orgs: Set<number>; time_ms: number; measured: number; errors: number; friction: number }>();
    for (const s of sessions) {
        const frictionByRoute = new Map<string, number>();
        for (const f of frictionOf(s)) frictionByRoute.set(f.route || "", (frictionByRoute.get(f.route || "") || 0) + 1);
        for (const p of s.pages) {
            const key = p.route || p.path || "";
            let agg = map.get(key);
            if (!agg) map.set(key, (agg = { route: p.route, section: sectionLabel(p.route), visits: 0, users: new Set(), orgs: new Set(), time_ms: 0, measured: 0, errors: 0, friction: 0 }));
            agg.visits++;
            if (s.user_id) agg.users.add(s.user_id);
            if (s.organization_id) agg.orgs.add(s.organization_id);
            agg.time_ms += p.time_ms;
            if (!p.time_estimated) agg.measured++;
            agg.errors += p.errors;
        }
        for (const [route, n] of frictionByRoute) {
            const agg = map.get(route);
            if (agg) agg.friction += n;
        }
    }
    return [...map.values()]
        .map((a) => ({
            route: a.route,
            section: a.section,
            visits: a.visits,
            users: a.users.size,
            organizations: a.orgs.size,
            total_minutes: minutes(a.time_ms),
            avg_seconds_per_visit: a.visits ? Math.round(a.time_ms / a.visits / 1000) : 0,
            measured_visits: a.measured,
            errors: a.errors,
            friction_points: a.friction,
        }))
        .sort((a, b) => b.total_minutes - a.total_minutes || b.visits - a.visits);
}

const normalizeMessage = (v: string | null) => String(v || "").toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();

/** Errores agrupados (JavaScript, API y mensajes de error que vio) con a quiénes les pasó. */
export function groupErrors(rows: ActivityRow[]) {
    const groups = new Map<string, { kind: string; message: string | null; where: string; count: number; users: Set<number>; orgs: Set<number>; first: string; last: string; statuses: Set<number>; paths: Set<string> }>();
    for (const r of rows) {
        if (!isErrorRow(r)) continue;
        const kind = r.type === "api_error" ? "api" : r.type === "js_error" ? "javascript" : "mensaje";
        const where = r.type === "api_error" ? r.target || "?" : sectionLabel(r.route);
        const key = `${kind}|${normalizeMessage(r.label)}|${r.type === "api_error" ? r.target : r.route}`;
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { kind, message: r.label, where, count: 0, users: new Set(), orgs: new Set(), first: r.occurred_at, last: r.occurred_at, statuses: new Set(), paths: new Set() }));
        g.count++;
        if (r.user_id) g.users.add(Number(r.user_id));
        if (r.organization_id) g.orgs.add(Number(r.organization_id));
        if (ms(r.occurred_at) < ms(g.first)) g.first = r.occurred_at;
        if (ms(r.occurred_at) > ms(g.last)) g.last = r.occurred_at;
        if (r.status != null) g.statuses.add(r.status);
        if (r.path && g.paths.size < 3) g.paths.add(r.path);
    }
    return [...groups.values()].sort((a, b) => b.count - a.count || ms(b.last) - ms(a.last));
}
