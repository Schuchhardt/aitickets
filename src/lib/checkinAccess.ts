// Check-in compartido por la API de productores (check_in_attendee) y el escáner de puerta sin cuenta
// (/puerta/<token>, links en aitickets_checkin_links: solo se guarda el sha256 del token).
// La service role se salta RLS: todo filtra por evento (ya verificado) u organización.
import { createHash, randomBytes } from "node:crypto";
import { getFunctionCheck } from "../../netlify/lib/checkin.mjs";
import { zonedDateTimeToUtc } from "../../netlify/lib/dates.mjs";

export const DOOR_PATH = "/puerta";
export const CHECKIN_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
export const hashCheckinToken = sha256;
export const doorUrl = (origin: string, token: string) => `${origin.replace(/\/+$/, "")}${DOOR_PATH}/${token}`;

export type CheckinLinkRow = {
    id: string;
    organization_id: number;
    event_id: number;
    label: string | null;
    expires_at: string;
    revoked_at: string | null;
    last_used_at: string | null;
    scan_count: number | null;
    created_at: string;
};

const LINK_COLUMNS = "id, organization_id, event_id, label, expires_at, revoked_at, last_used_at, scan_count, created_at";

export function linkStatus(link: Pick<CheckinLinkRow, "revoked_at" | "expires_at">, now = Date.now()): "active" | "revoked" | "expired" {
    if (link.revoked_at) return "revoked";
    if (new Date(link.expires_at).getTime() <= now) return "expired";
    return "active";
}

/** Representación pública de un link (nunca incluye el token: no se guarda). */
export function presentCheckinLink(link: CheckinLinkRow) {
    return {
        id: link.id,
        event_id: Number(link.event_id),
        label: link.label,
        status: linkStatus(link),
        expires_at: link.expires_at,
        last_used_at: link.last_used_at,
        scans: Number(link.scan_count) || 0,
        created_at: link.created_at,
    };
}

/**
 * Vencimiento por defecto: 24 h después del fin de la última función (event_dates en hora de Chile; si no
 * hay, events.end_date). Si eso ya pasó o no hay fechas, 24 h desde ahora.
 */
export async function defaultCheckinExpiry(supabase: any, event: { id: number; end_date?: string | null }, now = new Date()): Promise<Date> {
    const { data: dates } = await supabase.from("event_dates").select("date, start_time, end_time").eq("event_id", event.id);
    let last = event.end_date ? new Date(event.end_date).getTime() : NaN;
    for (const d of dates || []) {
        const end = zonedDateTimeToUtc(String(d.date).slice(0, 10), d.end_time || d.start_time || "23:59");
        // Una función que termina pasada la medianoche (end_time < start_time) termina al día siguiente
        let t = end ? end.getTime() : NaN;
        if (d.end_time && d.start_time && String(d.end_time) < String(d.start_time)) t += 86_400_000;
        if (Number.isFinite(t) && !(t <= last)) last = t;
    }
    const candidate = Number.isFinite(last) ? last + 24 * 3_600_000 : NaN;
    return new Date(Number.isFinite(candidate) && candidate > now.getTime() ? candidate : now.getTime() + 24 * 3_600_000);
}

export async function createCheckinLink(
    supabase: any,
    input: { eventId: number; orgId: number; userId: number | null; label: string | null; expiresAt: Date; origin: string },
) {
    const token = randomBytes(24).toString("base64url");
    const { data, error } = await supabase
        .from("aitickets_checkin_links")
        .insert({
            organization_id: input.orgId,
            event_id: input.eventId,
            token_hash: sha256(token),
            label: input.label,
            expires_at: input.expiresAt.toISOString(),
            created_by: input.userId,
        })
        .select(LINK_COLUMNS)
        .single();
    if (error) throw error;
    return { url: doorUrl(input.origin, token), link: presentCheckinLink(data) };
}

export async function listCheckinLinks(supabase: any, eventId: number, orgId: number) {
    const { data, error } = await supabase
        .from("aitickets_checkin_links")
        .select(LINK_COLUMNS)
        .eq("event_id", eventId)
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(100);
    if (error) throw error;
    return (data || []).map(presentCheckinLink);
}

export async function revokeCheckinLink(supabase: any, linkId: string, orgId: number, eventIds?: number[] | null): Promise<CheckinLinkRow | null> {
    const { data: link } = await supabase.from("aitickets_checkin_links").select(LINK_COLUMNS).eq("id", linkId).eq("organization_id", orgId).maybeSingle();
    if (!link || (eventIds && !eventIds.includes(Number(link.event_id)))) return null;
    if (!link.revoked_at) {
        const revokedAt = new Date().toISOString();
        const { error } = await supabase.from("aitickets_checkin_links").update({ revoked_at: revokedAt }).eq("id", link.id).eq("organization_id", orgId);
        if (error) throw error;
        link.revoked_at = revokedAt;
    }
    return link;
}

/** Link de puerta vigente para el token, con su evento; null si no existe, venció o fue revocado. */
export async function resolveCheckinToken(supabase: any, token: string): Promise<{ link: CheckinLinkRow; event: { id: number; name: string; slug: string } } | null> {
    if (!CHECKIN_TOKEN_RE.test(token || "")) return null;
    const { data: link, error } = await supabase.from("aitickets_checkin_links").select(LINK_COLUMNS).eq("token_hash", sha256(token)).maybeSingle();
    if (error || !link || linkStatus(link) !== "active") return null;
    const { data: event } = await supabase
        .from("events")
        .select("id, name, slug, organization_id")
        .eq("id", link.event_id)
        .eq("organization_id", link.organization_id)
        .maybeSingle();
    if (!event) return null;
    return { link, event: { id: Number(event.id), name: event.name, slug: event.slug } };
}

/** Registra el uso del link (best effort; nunca falla la petición). */
export async function touchCheckinLink(supabase: any, link: CheckinLinkRow, scanned: boolean) {
    try {
        const patch: Record<string, unknown> = { last_used_at: new Date().toISOString() };
        if (scanned) patch.scan_count = (Number(link.scan_count) || 0) + 1;
        await supabase.from("aitickets_checkin_links").update(patch).eq("id", link.id);
    } catch {
        /* ignorar */
    }
}

/** Acepta la hora de validación del dispositivo (offline) si es razonable; si no, ahora. */
export function resolveValidatedAt(value: unknown, now = Date.now()): string {
    const t = typeof value === "string" && value ? Date.parse(value) : NaN;
    if (Number.isFinite(t) && t <= now + 5 * 60_000 && t >= now - 48 * 3_600_000) return new Date(t).toISOString();
    return new Date(now).toISOString();
}

export type CheckInResult =
    | { ok: true; ticket_id: string; validated_at: string; function_mismatch: boolean; function_label: string | null; ticket: any }
    | { ok: false; code: "not_found" | "already_validated" | "invalid_status"; message: string; validated_at?: string | null; status?: string | null };

const TICKET_SELECT = "id, event_id, qr_code, status, validated_at, event_order_id, is_complimentary, attendees ( first_name, last_name, email ), event_tickets ( ticket_name, event_date_id )";

/** Busca una entrada del evento por id (uuid) o QR. */
export async function findEventTicket(supabase: any, eventId: number, ref: { ticketId?: string | null; qrCode?: string | null }) {
    let query = supabase.from("event_attendees").select(TICKET_SELECT).eq("event_id", eventId);
    if (ref.ticketId) {
        if (!UUID_RE.test(ref.ticketId)) return null;
        query = query.eq("id", ref.ticketId);
    } else if (ref.qrCode) {
        query = query.eq("qr_code", String(ref.qrCode).trim().slice(0, 200));
    } else return null;
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(error.message);
    return data || null;
}

/**
 * Marca el ingreso de una entrada (misma regla que /api/confirm-ticket): solo si su estado es activo
 * (NULL en entradas antiguas = activa). El UPDATE va condicionado al estado, así que dos dispositivos no
 * pueden validar la misma entrada dos veces.
 */
export async function checkInTicket(
    supabase: any,
    eventId: number,
    ref: { ticketId?: string | null; qrCode?: string | null },
    validatedAtInput?: unknown,
): Promise<CheckInResult> {
    const ticket = await findEventTicket(supabase, eventId, ref);
    if (!ticket) return { ok: false, code: "not_found", message: "No existe una entrada con ese código en este evento." };
    const reject = (row: { status?: string | null; validated_at?: string | null }): CheckInResult =>
        row.status === "validated"
            ? { ok: false, code: "already_validated", message: "Entrada ya validada.", validated_at: row.validated_at ?? null }
            : { ok: false, code: "invalid_status", message: `Entrada no válida (estado: ${row.status || "desconocido"}).`, status: row.status ?? null };
    if (ticket.status != null && ticket.status !== "active") return reject(ticket);

    const validatedAt = resolveValidatedAt(validatedAtInput);
    const patch = { status: "validated", validated_at: validatedAt };
    // Dos UPDATE condicionados (status = 'active' y status IS NULL) en vez de .or(): mismo efecto atómico por fila.
    let updated = 0;
    for (const cond of ["active", null] as const) {
        let q = supabase.from("event_attendees").update(patch, { count: "exact" }).eq("id", ticket.id).eq("event_id", eventId);
        q = cond === null ? q.is("status", null) : q.eq("status", cond);
        const { count, error } = await q;
        if (error) throw new Error(error.message);
        updated += Number(count) || 0;
        if (updated) break;
    }
    if (!updated) {
        const { data: current } = await supabase.from("event_attendees").select("status, validated_at").eq("id", ticket.id).maybeSingle();
        return reject(current || {});
    }
    const fn = await getFunctionCheck(supabase, eventId, ticket.event_tickets?.event_date_id ?? null);
    return { ok: true, ticket_id: ticket.id, validated_at: validatedAt, function_mismatch: Boolean(fn.function_mismatch), function_label: fn.function_label ?? null, ticket };
}

/**
 * Entrada en la forma que usa ValidateQR.vue, con datos mínimos para la puerta: nombre y tipo de entrada
 * (sin email ni orden: el escáner sin cuenta no reenvía entradas). El QR NUNCA va en claro: solo su sha256
 * (qr_hash), suficiente para reconocer offline un QR escaneado sin que un link filtrado permita clonar entradas.
 */
export function presentDoorTicket(row: any) {
    return {
        id: row.id,
        event_id: row.event_id,
        qr_hash: row.qr_code ? sha256(String(row.qr_code)) : null,
        status: row.status ?? "active",
        validated_at: row.validated_at ?? null,
        is_complimentary: Boolean(row.is_complimentary),
        attendees: { first_name: row.attendees?.first_name || "", last_name: row.attendees?.last_name || "" },
        event_tickets: { ticket_name: row.event_tickets?.ticket_name || "", event_date_id: row.event_tickets?.event_date_id ?? null },
    };
}

export const DOOR_TICKET_SELECT = "id, event_id, qr_code, status, validated_at, is_complimentary, attendees ( first_name, last_name ), event_tickets ( ticket_name, event_date_id )";
