// Identidad del productor (Didit) y titular de la cuenta bancaria: operaciones con la BD.
// La lógica pura (RUT, comparación, firma, mapeo de estados) vive en netlify/lib/identity.mjs.
//
// Reglas (Términos para productores §2 bis):
//   * Publicar y vender: siempre permitido, sin verificación de identidad.
//   * Los retiros exigen identidad aprobada cuando la organización lleva más de IDENTITY_FREE_SOLD_TICKETS
//     entradas pagadas vendidas en total (holder_match_status = 'match' sigue siendo necesario).
//   * holder_match_status se recalcula al guardar la cuenta bancaria y al aprobarse la identidad;
//     un 'mismatch' avisa a Slack para revisión manual.
// Tolera columnas que aún no existen (deploy preview sin migrar): se comporta como "sin verificar".
import {
    computeHolderMatch,
    extractIdentity,
    getDiditDecision,
    identityKind,
    mapDiditStatus,
    normalizeRut,
} from "../../netlify/lib/identity.mjs";
import { notifySlack } from "../pages/api/_lib/server-utils";
import { purgeEventPages } from "./cdnCache";

export type IdentityStatus = "pending" | "approved" | "declined" | "in_review" | null;

export type OrgIdentity = {
    id: number;
    identity_status: IdentityStatus;
    identity_verified_at: string | null;
    identity_name: string | null;
    identity_rut: string | null;
    identity_session_id: string | null;
    identity_consent_at: string | null;
    identity_kind: string | null;
    legal_name: string | null;
    legal_id: string | null;
};

const isMissing = (error: any) => ["42P01", "PGRST205", "42703", "PGRST204"].includes(String(error?.code || ""));

const IDENTITY_COLUMNS =
    "id, identity_status, identity_verified_at, identity_name, identity_rut, identity_session_id, identity_consent_at, identity_kind, legal_name, legal_id";

export const IDENTITY_STATUS_LABELS: Record<string, string> = {
    approved: "Identidad verificada",
    pending: "Verificación en curso",
    in_review: "Verificación en revisión",
    declined: "Verificación rechazada",
};

/** Identidad de la organización (null si no existe; columnas faltantes => sin verificar). */
export async function loadOrgIdentity(supabase: any, orgId: number): Promise<OrgIdentity | null> {
    const { data, error } = await supabase.from("organizations").select(IDENTITY_COLUMNS).eq("id", orgId).maybeSingle();
    if (error) {
        if (!isMissing(error)) throw error;
        return { id: orgId, identity_status: null, identity_verified_at: null, identity_name: null, identity_rut: null, identity_session_id: null, identity_consent_at: null, identity_kind: null, legal_name: null, legal_id: null };
    }
    if (!data) return null;
    return { ...data, identity_status: (data.identity_status ?? null) as IdentityStatus } as OrgIdentity;
}

export const identityApproved = (org: Pick<OrgIdentity, "identity_status"> | null | undefined) => org?.identity_status === "approved";

/** Hasta este número de entradas pagadas vendidas (en toda la organización) se puede retirar sin verificar identidad. */
export const IDENTITY_FREE_SOLD_TICKETS = 10;

/** @deprecated Se mantiene por compatibilidad; la publicación ya no se bloquea. */
export const IDENTITY_FREE_PAID_CAPACITY = IDENTITY_FREE_SOLD_TICKETS;

type TicketCapacity = { price?: unknown; total_quantity?: unknown; is_gift?: unknown };

/** Cupos pagados: suma de total_quantity de las entradas con precio > 0, sin cortesías. null = alguna sin límite. */
export function paidCapacity(tickets: TicketCapacity[]): number | null {
    let total = 0;
    for (const t of tickets || []) {
        if (t.is_gift || !(Number(t.price) > 0)) continue;
        if (t.total_quantity === null || t.total_quantity === undefined) return null;
        total += Math.max(0, Number(t.total_quantity) || 0);
    }
    return total;
}

/** @deprecated La publicación ya no exige identidad. Usar orgExceedsFreeSoldTickets para el check de retiros. */
export function ticketsRequireIdentity(tickets: TicketCapacity[]): boolean {
    const capacity = paidCapacity(tickets);
    return capacity === null || capacity > IDENTITY_FREE_SOLD_TICKETS;
}

/** @deprecated La publicación ya no exige identidad. */
export async function loadCapacityTickets(supabase: any, eventId: number): Promise<(TicketCapacity & { id: number })[]> {
    const { data, error } = await supabase.from("event_tickets").select("id, price, is_gift, total_quantity").eq("event_id", eventId);
    if (error) throw error;
    return data || [];
}

/** @deprecated La publicación ya no exige identidad. */
export async function eventRequiresIdentity(supabase: any, eventId: number): Promise<boolean> {
    return ticketsRequireIdentity(await loadCapacityTickets(supabase, eventId));
}

/**
 * Entradas pagadas vendidas por la organización (órdenes 'paid' con precio > 0, sin cortesías ni transferencias).
 * Se usa para determinar si la organización necesita verificar identidad para retirar dinero.
 */
export async function orgPaidTicketsSold(supabase: any, orgId: number): Promise<number> {
    const { data: events, error: evError } = await supabase
        .from("events")
        .select("id")
        .eq("organization_id", orgId);
    if (evError) throw evError;
    const eventIds = (events || []).map((e: any) => Number(e.id));
    if (!eventIds.length) return 0;
    const { count, error } = await supabase
        .from("event_attendees")
        .select("id", { count: "exact", head: true })
        .in("event_id", eventIds)
        .not("event_order_id", "is", null);
    if (error) throw error;
    return count || 0;
}

/** true si la organización superó el umbral gratuito de entradas vendidas y debe verificar identidad para retirar. */
export async function orgExceedsFreeSoldTickets(supabase: any, orgId: number): Promise<boolean> {
    return (await orgPaidTicketsSold(supabase, orgId)) > IDENTITY_FREE_SOLD_TICKETS;
}

export const IDENTITY_REQUIRED_FOR_PAYOUT_MESSAGE =
    `Llevas más de ${IDENTITY_FREE_SOLD_TICKETS} entradas vendidas: para retirar dinero debes verificar tu identidad. Hazlo en Configuración > Verificación de identidad (/dashboard/settings#identidad).`;

/** @deprecated Usar IDENTITY_REQUIRED_FOR_PAYOUT_MESSAGE. */
export const IDENTITY_REQUIRED_MESSAGE = IDENTITY_REQUIRED_FOR_PAYOUT_MESSAGE;

/**
 * true si la organización lleva más de IDENTITY_FREE_SOLD_TICKETS entradas vendidas y aún no verifica su identidad.
 * Sus eventos siguen a la venta (no se pausan); solo se le pide verificar para poder retirar.
 */
export async function needsIdentityForPublishedEvents(supabase: any, orgId: number): Promise<boolean> {
    if (identityApproved(await loadOrgIdentity(supabase, orgId))) return false;
    try {
        return await orgExceedsFreeSoldTickets(supabase, orgId);
    } catch {
        return false;
    }
}

// Aviso del layout del panel (DashboardLayout): se calcula a lo más una vez por minuto y organización en este
// proceso, para no sumar dos consultas a cada cambio de sección. El aviso puede tardar eso en aparecer o irse.
const IDENTITY_NOTICE_TTL_MS = 60_000;
const identityNoticeCache = new Map<number, { value: boolean; expiresAt: number }>();

/** needsIdentityForPublishedEvents con caché corta (solo para el aviso del panel; nunca para bloquear algo). */
export async function needsIdentityNotice(supabase: any, orgId: number): Promise<boolean> {
    const hit = identityNoticeCache.get(orgId);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const value = await needsIdentityForPublishedEvents(supabase, orgId);
    if (identityNoticeCache.size > 1000) identityNoticeCache.clear();
    identityNoticeCache.set(orgId, { value, expiresAt: Date.now() + IDENTITY_NOTICE_TTL_MS });
    return value;
}

/** @deprecated La publicación ya no se bloquea por identidad. Siempre devuelve null. */
export async function identityPublishBlocker(_supabase: any, _orgId: number, _eventId: number): Promise<string | null> {
    return null;
}

/**
 * Recalcula holder_match_status de la cuenta bancaria de la organización y lo guarda.
 * Avisa a Slack cuando pasa a 'mismatch'. Nunca lanza por columnas faltantes.
 */
export async function recomputeHolderMatch(supabase: any, orgId: number): Promise<{ status: "match" | "mismatch" | "pending"; reason: string } | null> {
    const org = await loadOrgIdentity(supabase, orgId);
    const { data: acc, error } = await supabase
        .from("organization_payout_accounts")
        .select("organization_id, legal_rut, bank_account_rut, bank_account_holder, holder_match_status")
        .eq("organization_id", orgId)
        .maybeSingle();
    if (error) {
        if (isMissing(error)) return null;
        throw error;
    }
    if (!acc) return null;
    const result = computeHolderMatch(org, acc) as { status: "match" | "mismatch" | "pending"; reason: string };
    // Solo se escriben columnas que el trigger de verificación bancaria no mira (no anula verified_at)
    const { error: updError } = await supabase
        .from("organization_payout_accounts")
        .update({ holder_match_status: result.status, holder_checked_at: new Date().toISOString() })
        .eq("organization_id", orgId);
    if (updError && !isMissing(updError)) throw updError;
    return result;
}

/** Copia razón social y RUT de los datos de pago a la organización (se muestran en la página del evento). */
export async function syncOrganizerLegalData(supabase: any, orgId: number, data: { legal_name?: string | null; legal_rut?: string | null }) {
    const patch: Record<string, string | null> = {};
    if (data.legal_name !== undefined) patch.legal_name = data.legal_name || null;
    if (data.legal_rut !== undefined) patch.legal_id = data.legal_rut ? normalizeRut(data.legal_rut) || data.legal_rut : null;
    if (!Object.keys(patch).length) return;
    const { error } = await supabase.from("organizations").update(patch).eq("id", orgId);
    if (error && !isMissing(error)) throw error;
}

/**
 * Aplica una decisión de Didit a la organización: estado y, si hay, nombre y RUT verificados.
 * Al aprobarse recalcula el titular de la cuenta. Devuelve el nuevo estado (o null si no cambia nada).
 */
export async function applyDiditDecision(
    supabase: any,
    orgId: number,
    { sessionId, status, decision }: { sessionId: string | null; status: string | null; decision?: any },
): Promise<IdentityStatus> {
    const mapped = mapDiditStatus(status) as IdentityStatus;
    if (!mapped) return null;
    const org = await loadOrgIdentity(supabase, orgId);
    if (!org) return null;
    // Una sesión vieja no pisa el resultado de la sesión vigente
    if (sessionId && org.identity_session_id && org.identity_session_id !== sessionId) return null;

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { identity_status: mapped, identity_checked_at: now };
    if (decision) {
        const { name, rut } = extractIdentity(decision);
        if (name) patch.identity_name = name;
        if (rut) patch.identity_rut = rut;
    }
    if (mapped === "approved") {
        const rut = (patch.identity_rut as string) || org.identity_rut;
        if (!rut) {
            // Aprobado sin RUN legible: se revisa a mano antes de habilitar publicaciones y retiros
            patch.identity_status = "in_review";
            await notifySlack(`🪪 Didit aprobó la identidad de la org ${orgId} pero no se pudo leer el RUN del documento. Revisar a mano (organizations.identity_rut).`);
        } else {
            patch.identity_verified_at = org.identity_verified_at || now;
            patch.identity_kind = identityKind(rut, org.legal_id);
        }
    } else if (org.identity_status === "approved") {
        patch.identity_verified_at = null;
    }
    const { error } = await supabase.from("organizations").update(patch).eq("id", orgId);
    if (error) throw error;

    const finalStatus = patch.identity_status as IdentityStatus;
    if (finalStatus !== org.identity_status) {
        const label = IDENTITY_STATUS_LABELS[finalStatus || ""] || finalStatus;
        await notifySlack(`🪪 *Identidad de productor:* org ${orgId} → ${label}${patch.identity_name ? ` (${patch.identity_name})` : ""}.`);
    }
    if (finalStatus === "approved" || org.identity_status === "approved") {
        await recomputeHolderMatch(supabase, orgId);
        // Sello "Productor verificado" en las páginas de eventos
        if (finalStatus !== org.identity_status) await purgeEventPages();
    }
    return finalStatus;
}

/** Consulta la decisión en Didit (por si el webhook no llegó) y la aplica. */
export async function syncIdentityFromDidit(supabase: any, orgId: number): Promise<IdentityStatus> {
    const org = await loadOrgIdentity(supabase, orgId);
    if (!org?.identity_session_id || org.identity_status === "approved") return org?.identity_status ?? null;
    const decision: any = await getDiditDecision(org.identity_session_id);
    return applyDiditDecision(supabase, orgId, { sessionId: org.identity_session_id, status: decision?.status, decision });
}
