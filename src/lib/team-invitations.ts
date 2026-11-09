// Invitaciones al equipo de una organización (aitickets_team_invitations, migración 202610090200).
// El token va solo en el link del correo (/invitacion/<token>); en la BD queda su sha256. Lo usan la
// herramienta invite_member de la API de productores y la página pública de aceptación.
import { createHash, randomBytes } from "node:crypto";
import { ROLE_LABELS, ROLE_PERMISSIONS, PERMISSION_LABELS } from "./producer-api/permissions";

export const INVITATION_TTL_DAYS = 7;
export const INVITATION_COLUMNS =
    "id, organization_id, email, name, role, event_ids, invited_by, invited_via, expires_at, accepted_at, accepted_user_id, revoked_at, email_sent_at, created_at";

const TOKEN_RE = /^aitinv_[A-Za-z0-9_-]{43}$/;

export const hashInvitationToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function generateInvitationToken(): { token: string; hash: string } {
    const token = `aitinv_${randomBytes(32).toString("base64url")}`;
    return { token, hash: hashInvitationToken(token) };
}

export const isInvitationToken = (token: unknown): token is string => typeof token === "string" && TOKEN_RE.test(token);

export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export function invitationStatus(row: { accepted_at?: string | null; revoked_at?: string | null; expires_at?: string | null }, now = new Date()): InvitationStatus {
    if (row.accepted_at) return "accepted";
    if (row.revoked_at) return "revoked";
    if (!row.expires_at || new Date(row.expires_at).getTime() <= now.getTime()) return "expired";
    return "pending";
}

export const invitationUrl = (origin: string, token: string) => `${origin.replace(/\/+$/, "")}/invitacion/${token}`;

/** Descripción corta de lo que permite un rol (para el correo y la página de aceptación). */
export function roleDescription(role: string): string {
    const perms = ROLE_PERMISSIONS[role] || [];
    return perms.map((p) => PERMISSION_LABELS[p]).join(" · ");
}

export const roleLabel = (role: string) => ROLE_LABELS[role] || role;

/**
 * Cuenta de Auth que creó AI Tickets y que nadie ha usado nunca (sin ningún inicio de sesión, ni con contraseña ni
 * con Google ni desde otra app del proyecto compartido). Es el caso de un "agregar miembro" que falló a medias: la
 * contraseña temporal nunca se mostró, así que nadie la conoce y se le puede poner otra sin quitarle nada a nadie.
 * Cualquier cuenta que no cumpla esto es de alguien: solo se vincula con SU contraseña.
 */
export function isUnclaimedAuthUser(user: any): boolean {
    if (!user) return false;
    return (user.app_metadata as any)?.app === "aitickets" && !user.last_sign_in_at;
}

/**
 * ¿Al aceptar la invitación hay que pedir la contraseña de una cuenta existente? false = se crea una contraseña
 * nueva: correo sin cuenta, o una cuenta que nadie ha usado (huérfano de un alta a medias, o un miembro al que se
 * le "reenvía el acceso" porque nunca entró). Debe coincidir con acceptTeamInvitation (src/lib/team-accept.ts).
 */
export async function invitationNeedsExistingPassword(supabase: any, email: string): Promise<boolean> {
    const { data: user } = await supabase
        .from("users")
        .select("id, auth_user_id, organization_id")
        .ilike("email", String(email).trim().toLowerCase().replace(/[\\%_]/g, (c: string) => `\\${c}`))
        .maybeSingle();
    if (!user?.auth_user_id) return false;
    try {
        const { data } = await supabase.auth.admin.getUserById(user.auth_user_id);
        return !isUnclaimedAuthUser(data?.user);
    } catch {
        return true;
    }
}

/** Carga una invitación por su token (o null si el token no tiene formato válido o no existe). */
export async function loadInvitationByToken(supabase: any, token: unknown) {
    if (!isInvitationToken(token)) return null;
    const { data, error } = await supabase
        .from("aitickets_team_invitations")
        .select(INVITATION_COLUMNS)
        .eq("token_hash", hashInvitationToken(token))
        .maybeSingle();
    if (error) {
        console.warn("loadInvitationByToken:", error.message);
        return null;
    }
    return data || null;
}

/** Agrega filas de aitickets_event_staff (ignora las que ya existen). Solo eventos de la organización. */
export async function addEventStaff(supabase: any, orgId: number, userId: number, eventIds: number[], createdBy: number | null) {
    if (!eventIds.length) return;
    const { data: existing } = await supabase.from("aitickets_event_staff").select("event_id").eq("user_id", userId);
    const have = new Set((existing || []).map((r: any) => Number(r.event_id)));
    const rows = eventIds
        .filter((id) => !have.has(Number(id)))
        .map((event_id) => ({ organization_id: orgId, event_id, user_id: userId, created_by: createdBy }));
    if (!rows.length) return;
    const { error } = await supabase.from("aitickets_event_staff").insert(rows);
    if (error) throw error;
}
