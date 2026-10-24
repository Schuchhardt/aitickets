// Contexto del MCP de administración y el actor "Soporte AI Tickets" con el que org_* actúa como una organización.
import { API_SCOPES } from "../producer-api/keys";
import { ToolError, type ConfirmationSummary, type ToolContext } from "../producer-api/registry";
import type { AdminKeyKind } from "./auth";

export type AdminContext = {
    /** Cliente service role: se salta RLS. Las herramientas de admin son las ÚNICAS que consultan entre organizaciones. */
    supabase: any;
    /** Origen público del sitio (SITE_URL), sin "/" final. */
    origin: string;
    requestUrl: URL;
    keyKind: AdminKeyKind;
    /** Primeros 8 caracteres del sha256 de la llave usada (para la bitácora y la rotación). */
    fingerprint: string;
    ipHash: string;
    /** Resumen que el dueño confirmó (segunda llamada de una herramienta con confirm). */
    confirmed?: ConfirmationSummary;
};

export const SUPPORT_ACTOR_NAME = "Soporte AI Tickets";

let supportUserId: number | null = null;

/** Para los tests. */
export function resetSupportUserCache() {
    supportUserId = null;
}

/** users.id del usuario de servicio (migración 202610250100_admin_api.sql), leído una vez. */
export async function getSupportUserId(supabase: any): Promise<number> {
    if (supportUserId) return supportUserId;
    const { data, error } = await supabase.from("aitickets_platform_settings").select("value").eq("key", "support_user_id").maybeSingle();
    if (error && !["42P01", "PGRST205"].includes(String(error.code || ""))) throw error;
    const id = Number(data?.value);
    if (!Number.isInteger(id) || id <= 0) {
        throw new ToolError("unavailable", "Falta el usuario de soporte: la migración 202610250100_admin_api.sql aún no se aplica en esta base.");
    }
    supportUserId = id;
    return id;
}

/** Organización por id o not_found con un mensaje accionable. */
export async function loadOrganization<T = any>(actx: Pick<AdminContext, "supabase">, orgId: number, columns = "id, public_name"): Promise<T> {
    const { data, error } = await actx.supabase.from("organizations").select(columns).eq("id", orgId).maybeSingle();
    if (error) throw error;
    if (!data) throw new ToolError("not_found", `No existe la organización ${orgId}. Usa search_organizations para ver los IDs.`);
    return data as T;
}

/**
 * ToolContext de una herramienta de productor ejecutada por el admin COMO la organización `orgId`:
 * rol producer (todos los permisos; lo que soporte no debe hacer lo bloquea mirror.ts), todos los scopes, sin
 * restricción por evento y con el usuario de servicio como autor (created_by, requested_by…). Canal "admin":
 * la acción queda en la bitácora del productor firmada por Soporte AI Tickets.
 */
export async function orgToolContext(actx: AdminContext, orgId: number): Promise<ToolContext> {
    await loadOrganization(actx, orgId, "id");
    const userId = await getSupportUserId(actx.supabase);
    return {
        supabase: actx.supabase,
        actor: {
            keyId: null,
            userId,
            orgId,
            role: "producer",
            name: SUPPORT_ACTOR_NAME,
            email: null,
            scopes: [...API_SCOPES],
            eventIds: null,
        },
        origin: actx.origin,
        requestUrl: actx.requestUrl,
        channel: "admin",
    };
}
