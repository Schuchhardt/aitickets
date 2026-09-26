// Utilidades server-side compartidas por las rutas API del dashboard.
// Carpeta con prefijo "_" => Astro no la expone como ruta.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export { createEphemeralAuthClient } from "../../../lib/auth-helpers";

/** Envía un mensaje a Slack (env SLACK_WEBHOOK_URL). Nunca lanza. */
export async function notifySlack(text: string): Promise<void> {
    const webhookUrl = serverEnv("SLACK_WEBHOOK_URL");
    if (!webhookUrl) {
        console.warn("SLACK_WEBHOOK_URL no configurado, omitiendo notificación");
        return;
    }
    try {
        const res = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
        });
        if (!res.ok) console.error(`Slack respondió con status ${res.status}`);
    } catch (err: any) {
        console.error("Error al notificar a Slack:", err?.message);
    }
}

/**
 * Lee una variable de entorno server-side. En runtime (Netlify) manda process.env; import.meta.env
 * es el valor inlineado por Astro/Vite en el build (útil en dev).
 */
export function serverEnv(name: string): string | undefined {
    const fromProcess = typeof process !== "undefined" ? process.env?.[name] : undefined;
    const value = fromProcess ?? (import.meta.env as Record<string, string | undefined>)[name];
    return value ? String(value) : undefined;
}

/** URL pública del sitio (SITE_URL) sin "/" final, o undefined si no está configurada. */
export function siteUrl(): string | undefined {
    return serverEnv("SITE_URL")?.replace(/\/+$/, "");
}

/**
 * Origen al que se envía el secreto interno. En producción exige SITE_URL: nunca se usa el origen de
 * la request (Host manipulable) para mandar x-internal-secret. En dev se permite el origen local.
 */
function internalOrigin(requestUrl: URL): string | null {
    const configured = siteUrl();
    if (configured) return configured;
    if (import.meta.env.PROD) return null;
    return requestUrl.origin;
}

/** Llama a una función interna (Netlify) con x-internal-secret (contratos C6/C8). */
export async function callInternalFunction(requestUrl: URL, path: string, body: unknown): Promise<{ ok: boolean; status: number; data: any }> {
    const secret = serverEnv("INTERNAL_API_SECRET");
    if (!secret) {
        console.error(`INTERNAL_API_SECRET no configurado; no se puede llamar ${path}`);
        return { ok: false, status: 500, data: { error: "INTERNAL_API_SECRET no configurado" } };
    }
    const origin = internalOrigin(requestUrl);
    if (!origin) {
        console.error(`SITE_URL no configurado en producción; no se envía el secreto interno a ${path}`);
        return { ok: false, status: 500, data: { error: "SITE_URL no configurado" } };
    }
    try {
        const res = await fetch(new URL(path, origin), {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-internal-secret": secret },
            body: JSON.stringify(body),
        });
        let data: any = null;
        try { data = await res.json(); } catch { /* sin cuerpo JSON */ }
        return { ok: res.ok, status: res.status, data };
    } catch (err: any) {
        console.error(`Error llamando ${path}:`, err?.message);
        return { ok: false, status: 500, data: { error: err?.message } };
    }
}

/** C6: envía (o reenvía con force) las entradas de una orden. */
export function sendTicketsEmail(requestUrl: URL, orderId: number | string, force = false) {
    return callInternalFunction(requestUrl, "/api/send-tickets-email", force ? { orderId, force: true } : { orderId });
}

// ---------------------------------------------------------------------------
// Fechas (America/Santiago)
// ---------------------------------------------------------------------------

/** Offset (minutos) de una zona horaria para un instante dado. */
function tzOffsetMinutes(instant: Date, timeZone: string): number {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(instant);
    const get = (t: string) => Number(parts.find(p => p.type === t)?.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return (asUtc - instant.getTime()) / 60000;
}

/** Convierte fecha "YYYY-MM-DD" + hora "HH:MM[:SS]" local de Santiago a Date (UTC). */
export function santiagoToDate(date: string, time?: string | null, timeZone = "America/Santiago"): Date | null {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const [y, m, d] = date.split("-").map(Number);
    const [hh, mm, ss] = (time || "00:00").split(":").map(n => Number(n) || 0);
    const guess = Date.UTC(y, m - 1, d, hh, mm, ss || 0);
    // dos pasadas para manejar cambios de horario
    let offset = tzOffsetMinutes(new Date(guess), timeZone);
    let result = guess - offset * 60000;
    const offset2 = tzOffsetMinutes(new Date(result), timeZone);
    if (offset2 !== offset) result = guess - offset2 * 60000;
    return new Date(result);
}

export type EventDateInput = { date: string; start_time?: string | null; end_time?: string | null };

/** C1: start_date = primera función, end_date = fin de la última función (o inicio + 3h). */
export function computeEventRange(dates: EventDateInput[]): { start_date: string | null; end_date: string | null } {
    let start: Date | null = null;
    let end: Date | null = null;
    for (const d of dates || []) {
        const s = santiagoToDate(d.date, d.start_time || "00:00");
        if (!s) continue;
        let e: Date | null = null;
        if (d.end_time) {
            e = santiagoToDate(d.date, d.end_time);
            // función que termina después de medianoche
            if (e && e.getTime() <= s.getTime()) e = new Date(e.getTime() + 24 * 3600 * 1000);
        }
        if (!e) e = new Date(s.getTime() + 3 * 3600 * 1000);
        if (!start || s < start) start = s;
        if (!end || e > end) end = e;
    }
    return { start_date: start ? start.toISOString() : null, end_date: end ? end.toISOString() : null };
}

export function formatLocation(venue: { name?: string | null; address?: string | null; city?: string | null } | null | undefined): string | null {
    if (!venue) return null;
    const parts = [venue.name, venue.address, venue.city].map(p => (p || "").trim()).filter(Boolean);
    return parts.length ? parts.join(", ") : null;
}

/** Slug simple sin acentos. */
export function slugify(text: string): string {
    return (text || "")
        .toString()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

/** Escapa un valor para CSV (separador ;, compatible con Excel en es-CL). */
export function csvCell(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "number") return String(value);
    let s = String(value);
    // Evitar inyección de fórmulas en Excel
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    if (/[";\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
}
