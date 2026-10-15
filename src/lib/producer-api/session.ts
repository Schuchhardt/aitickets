// Contexto de herramientas para el panel: ejecuta las mismas herramientas de la API de productores
// (permisos por rol, confirmación en dos pasos, idempotencia y bitácora) con la sesión del usuario en vez de una llave.
import type { APIContext } from "astro";
import { getSupabaseAdmin } from "../auth-helpers";
import { getSessionContext } from "../supabaseServer";
import { API_SCOPES, loadStaffEventIds } from "./keys";
import { API_ROLES } from "./permissions";
import { publicOrigin } from "./http";
import type { ToolContext } from "./registry";

export type DashboardToolAuth = { ok: true; ctx: ToolContext } | { ok: false; status: 401 | 403; error: string };

export async function dashboardToolContext(context: Pick<APIContext, "cookies" | "request">): Promise<DashboardToolAuth> {
    const session = await getSessionContext(context as any);
    if (!session) return { ok: false, status: 401, error: "Inicia sesión para continuar." };
    const { dbUser } = session;
    if (!API_ROLES.includes(dbUser.role || "")) return { ok: false, status: 403, error: "Tu rol no permite esta acción." };
    const supabase = getSupabaseAdmin();
    const requestUrl = new URL(context.request.url);
    return {
        ok: true,
        ctx: {
            supabase,
            actor: {
                keyId: null,
                userId: Number(dbUser.id),
                orgId: Number(dbUser.organization_id),
                role: String(dbUser.role),
                name: dbUser.name ?? null,
                email: dbUser.email ?? null,
                // El panel no limita por alcance de llave: manda el rol (permissions.ts).
                scopes: [...API_SCOPES],
                eventIds: await loadStaffEventIds(supabase, Number(dbUser.id)),
            },
            origin: publicOrigin(requestUrl),
            requestUrl,
            channel: "dashboard",
        },
    };
}
