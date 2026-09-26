// Utilidades compartidas de las rutas de equipo (archivo "_" => no es ruta).
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { ORG_ADMIN_ROLES } from "../../../lib/supabaseServer";

/** Roles que un administrador puede asignar desde el dashboard. 'producer' (dueño de la cuenta) no se asigna. */
export const ASSIGNABLE_ROLES = ["admin", "editor", "validator"];

export const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Cantidad de administradores (admin/producer) activos de la organización, excluyendo opcionalmente a un usuario. */
export async function countActiveOrgAdmins(organizationId: number, excludeUserId?: number): Promise<number> {
    let query = getSupabaseAdmin()
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .in("role", ORG_ADMIN_ROLES)
        .or("active.is.null,active.eq.true");
    if (excludeUserId) query = query.neq("id", excludeUserId);
    const { count } = await query;
    return count || 0;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Marca de las cuentas de Supabase Auth creadas por AI Tickets (el proyecto Auth es compartido con otras apps). */
export const AITICKETS_APP_METADATA = { app: "aitickets" } as const;

/**
 * true si el usuario de Auth fue creado por AI Tickets (app_metadata.app === 'aitickets').
 * Solo a esas cuentas se les puede cambiar el email o bloquear el login desde AI Tickets;
 * para las demás solo se modifica public.users.
 */
export async function isAiticketsAuthUser(authUserId: string): Promise<boolean> {
    const { data, error } = await getSupabaseAdmin().auth.admin.getUserById(authUserId);
    if (error || !data?.user) return false;
    return (data.user.app_metadata as Record<string, unknown> | undefined)?.app === "aitickets";
}
