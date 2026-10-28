// Certificados de asistencia: un PDF por entrada que ingresó (status validated). Lo usan el panel (CertificatesCard.vue
// → /api/events/certificates), el asistente de IA (get_attendance_certificates / send_attendance_certificates) y el
// link de cada asistente (/certificado/<token>, netlify/lib/certificate-token.mjs).
// - Nombre y correo: los del titular de la entrada o, si la compra no los pidió, los de quien compró (attendeeHolder).
// - Funciones: una entrada de una función certifica esa función. Un pase "para todas las funciones" de un evento con
//   varias certifica las funciones a las que entró (aitickets_attendee_checkins, ítem 16) y puede exigir un mínimo
//   (min_sessions). Sin la tabla, cuenta la función del día en que se validó.
// - Horas: la suma de la duración de esas funciones (hora de inicio a término); si alguna no tiene término, no se
//   dicen horas, salvo que el productor las fije (hours).
import { ticketHolder, loadEventTickets } from "./attendeeHolder.mjs";
import { isMultiSession, pickSession } from "./sessionCheckin.mjs";
import { attachSessionCheckins, loadEventSessions } from "../../netlify/lib/checkin.mjs";
import { formatEventLocation } from "../../netlify/lib/dates.mjs";
import { signCertificateToken } from "../../netlify/lib/certificate-token.mjs";
import { certificatesPdf } from "./attendeePdf.mjs";

export const CERTIFICATE_SENDS_TABLE = "aitickets_certificate_sends";
/** Tope de certificados en un PDF descargado desde el panel (la respuesta de la función tiene un tamaño máximo). */
export const MAX_CERTIFICATES_PER_PDF = 1500;

export type CertificateOptions = { minSessions?: number | null; hours?: number | null };

export type CertificateRow = {
    ticket_id: string;
    name: string;
    email: string;
    ticket_type: string | null;
    multi: boolean;
    sessions_attended: number;
    sessions_total: number;
    dates: string[];
    hours: number | null;
    eligible: boolean;
    reason: "ok" | "below_min_sessions" | "missing_name";
};

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const ymd = (d: string) => String(d).slice(0, 10).split("-").map(Number);

/** "el 3 de diciembre de 2026" / "los días 3 y 4 de diciembre de 2026" / "los días 30 de noviembre y 1 de diciembre de 2026". */
export function datesText(dates: string[]): string {
    const days = [...new Set(dates.map((d) => String(d).slice(0, 10)))].sort();
    if (!days.length) return "";
    const parts = days.map(ymd);
    const join = (list: string[]) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} y ${list[list.length - 1]}` : list[0]);
    if (parts.length === 1) {
        const [y, m, d] = parts[0];
        return `el ${d} de ${MONTHS[m - 1]} de ${y}`;
    }
    const sameMonth = parts.every(([y, m]) => y === parts[0][0] && m === parts[0][1]);
    if (sameMonth) return `los días ${join(parts.map(([, , d]) => String(d)))} de ${MONTHS[parts[0][1] - 1]} de ${parts[0][0]}`;
    const sameYear = parts.every(([y]) => y === parts[0][0]);
    if (sameYear) return `los días ${join(parts.map(([, m, d]) => `${d} de ${MONTHS[m - 1]}`))} de ${parts[0][0]}`;
    return `los días ${join(parts.map(([y, m, d]) => `${d} de ${MONTHS[m - 1]} de ${y}`))}`;
}

const minutesOf = (t: string | null | undefined) => {
    const match = /^(\d{1,2}):(\d{2})/.exec(String(t || "").trim());
    return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
};

/** Horas de un conjunto de funciones (null si alguna no tiene término). Las que terminan después de medianoche suman 24 h. */
export function sessionsHours(sessions: { start_time?: string | null; end_time?: string | null }[]): number | null {
    if (!sessions.length) return null;
    let total = 0;
    for (const s of sessions) {
        const start = minutesOf(s.start_time);
        const end = minutesOf(s.end_time);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
        total += end > start ? end - start : end + 24 * 60 - start;
    }
    return Math.round((total / 60) * 10) / 10;
}

export const hoursLabel = (h: number) => `${String(h).replace(".", ",")} ${h === 1 ? "hora" : "horas"}`;

/**
 * Quién recibe certificado (lógica pura). `tickets`: filas de event_attendees con titular (y `session_checkins` en
 * los pases de varias funciones, ver attachSessionCheckins); `types`: event_tickets por id; `dates`: funciones.
 */
export function certificateRows(
    tickets: any[],
    types: Map<number, any>,
    dates: any[],
    { minSessions = 1, hours = null }: CertificateOptions = {},
): CertificateRow[] {
    const min = Math.max(1, Math.round(Number(minSessions) || 1));
    const dateById = new Map(dates.map((d) => [String(d.id), d]));
    return tickets
        .filter((t) => t.status === "validated")
        .map((t) => {
            const type = types.get(Number(t.event_ticket_id));
            const fnId = type?.event_date_id ?? null;
            const multi = isMultiSession(fnId, dates);
            let sessions: any[] = [];
            if (multi) {
                const checkins: any[] = Array.isArray(t.session_checkins) ? t.session_checkins : [];
                const ids = [...new Set(checkins.map((c) => String(c.event_date_id)))];
                sessions = ids.map((id) => dateById.get(id)).filter(Boolean);
                // Sin registro por función (tabla sin migrar o ingreso anterior): la función del día en que se validó
                if (!sessions.length) {
                    const picked = pickSession(dates, t.validated_at ? new Date(t.validated_at) : new Date());
                    if (picked) sessions = [picked];
                }
            } else {
                const fn = fnId != null ? dateById.get(String(fnId)) : dates.length === 1 ? dates[0] : null;
                if (fn) sessions = [fn];
            }
            sessions.sort((a, b) => `${a.date}|${a.start_time || ""}`.localeCompare(`${b.date}|${b.start_time || ""}`));
            const holder = ticketHolder(t);
            const attended = multi ? sessions.length : 1;
            const reason: CertificateRow["reason"] = !holder.name ? "missing_name" : multi && attended < min ? "below_min_sessions" : "ok";
            return {
                ticket_id: String(t.id),
                name: holder.name,
                email: holder.email,
                ticket_type: type?.ticket_name ?? null,
                multi,
                sessions_attended: attended,
                sessions_total: multi ? dates.length : 1,
                dates: sessions.map((s) => String(s.date).slice(0, 10)),
                hours: hours && hours > 0 ? hours : sessionsHours(sessions),
                eligible: reason === "ok",
                reason,
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export type CertificateContext = {
    event: { id: number; name: string; organization_id: number; start_date: string | null };
    organizer: string;
    dates: any[];
    rows: CertificateRow[];
};

/** Carga el evento, sus funciones y las entradas que ingresaron (todas o solo `ticketIds`), y arma los certificados. */
export async function loadCertificates(
    supabase: any,
    event: { id: number; name: string; organization_id: number; start_date?: string | null },
    opts: CertificateOptions & { ticketIds?: string[] } = {},
): Promise<CertificateContext> {
    const eventId = Number(event.id);
    const [dates, typesRes, orgRes] = await Promise.all([
        loadEventSessions(supabase, eventId),
        supabase.from("event_tickets").select("id, ticket_name, event_date_id").eq("event_id", eventId),
        supabase.from("organizations").select("public_name").eq("id", event.organization_id).maybeSingle(),
    ]);
    const types = new Map<number, any>((typesRes.data || []).map((t: any) => [Number(t.id), t]));
    const rows = await loadEventTickets(supabase, eventId, "id, status, validated_at, event_ticket_id, event_order_id, created_at", {
        ids: opts.ticketIds || null,
    });
    const validated = rows.filter((r: any) => r.status === "validated");
    // attachSessionCheckins lee la función de la entrada en event_tickets.event_date_id
    const withType = validated.map((r: any) => ({ ...r, event_tickets: { event_date_id: types.get(Number(r.event_ticket_id))?.event_date_id ?? null } }));
    const withCheckins = await attachSessionCheckins(supabase, eventId, withType, dates);
    return {
        event: { id: eventId, name: event.name, organization_id: event.organization_id, start_date: event.start_date ?? null },
        organizer: String(orgRes.data?.public_name || "").trim(),
        dates,
        rows: certificateRows(withCheckins, types, dates, opts),
    };
}

const issuedFmt = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "numeric", month: "long", year: "numeric" });

/** Un PDF con los certificados de `rows` (solo los que corresponden). */
export function renderCertificates(ctx: CertificateContext, rows: CertificateRow[], now = new Date()): Buffer {
    const place = (() => {
        const loc = ctx.dates.find((d) => d.event_locations)?.event_locations;
        return loc ? formatEventLocation(loc) : "";
    })();
    const issuedText = `Emitido el ${issuedFmt.format(now)}`;
    return certificatesPdf(
        rows
            .filter((r) => r.eligible)
            .map((r) => {
                const when = r.dates.length ? datesText(r.dates) : ctx.event.start_date ? datesText([new Date(ctx.event.start_date).toISOString()]) : "";
                return {
                    name: r.name,
                    eventName: ctx.event.name,
                    organizer: ctx.organizer,
                    datesText: when ? `Realizado ${when}` : "",
                    sessionsText: r.multi && r.sessions_total > 1 ? `Asistió a ${r.sessions_attended} de ${r.sessions_total} sesiones` : null,
                    hoursText: r.hours ? `Duración: ${hoursLabel(r.hours)}` : null,
                    place: place ? `en ${place}` : null,
                    code: r.ticket_id.replace(/-/g, "").slice(0, 8).toUpperCase(),
                    issuedText,
                };
            }),
        { title: `Certificados · ${ctx.event.name}` },
    );
}

/** Link público del certificado de una o varias entradas ('' sin secreto de firma). */
export function certificateUrl(origin: string, ticketIds: string[], opts: CertificateOptions = {}) {
    const token = signCertificateToken({ ticketIds, minSessions: opts.minSessions ?? null, hours: opts.hours ?? null });
    return token ? `${origin.replace(/\/+$/, "")}/certificado/${token}` : "";
}

/** Nombre de archivo sin tildes ni símbolos. */
export const pdfFileName = (prefix: string, name: string) =>
    `${prefix}-${String(name || "evento").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 60) || "evento"}.pdf`;
