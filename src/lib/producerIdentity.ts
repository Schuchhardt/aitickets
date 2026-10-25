// Identidad del productor (Didit) y titular de la cuenta bancaria: operaciones con la BD.
// La lógica pura (RUT, comparación, firma, mapeo de estados) vive en netlify/lib/identity.mjs.
//
// Reglas (Términos para productores §2 bis):
//   * Publicar un evento con entradas pagadas exige identidad aprobada (identityApproved).
//   * Los retiros exigen identidad aprobada y holder_match_status = 'match' (titular = identidad verificada).
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

/** true si el evento tiene algún tipo de entrada pagado (precio > 0), sin contar cortesías. */
export async function eventHasPaidTickets(supabase: any, eventId: number): Promise<boolean> {
    const { data, error } = await supabase.from("event_tickets").select("id, price, is_gift").eq("event_id", eventId).gt("price", 0);
    if (error) throw error;
    return (data || []).some((t: any) => !t.is_gift && Number(t.price) > 0);
}

export const IDENTITY_REQUIRED_MESSAGE =
    "Para publicar eventos con entradas pagadas debes verificar tu identidad. Hazlo en Configuración > Verificación de identidad (/dashboard/settings#identidad). Los eventos gratuitos no lo requieren.";

/**
 * true si la organización tiene eventos publicados con entradas pagadas y aún no verifica su identidad.
 * Esos eventos siguen a la venta (no se pausan); solo se le pide verificar para poder retirar.
 */
export async function needsIdentityForPublishedEvents(supabase: any, orgId: number): Promise<boolean> {
    if (identityApproved(await loadOrgIdentity(supabase, orgId))) return false;
    const { data, error } = await supabase
        .from("events")
        .select("id, event_tickets!inner(id)")
        .eq("organization_id", orgId)
        .eq("status", "published")
        .gt("event_tickets.price", 0)
        .limit(1);
    if (error) return false;
    return (data || []).length > 0;
}

/** Mensaje de bloqueo si el evento no se puede publicar por falta de identidad verificada; null si puede. */
export async function identityPublishBlocker(supabase: any, orgId: number, eventId: number): Promise<string | null> {
    if (!(await eventHasPaidTickets(supabase, eventId))) return null;
    const org = await loadOrgIdentity(supabase, orgId);
    return identityApproved(org) ? null : IDENTITY_REQUIRED_MESSAGE;
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
    if (result.status === "mismatch" && acc.holder_match_status !== "mismatch") {
        await notifySlack(
            `⚠️ *Titular de cuenta ≠ identidad verificada* (org ${orgId}). Retiros bloqueados hasta revisión manual.\n• ${result.reason}`,
        );
    }
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
