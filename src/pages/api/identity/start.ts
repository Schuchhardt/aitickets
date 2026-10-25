// Inicia la verificación de identidad del productor con Didit (documento + prueba de vida).
//   POST { consent: true } → { url }  (el panel redirige al flujo de Didit)
// Exige el consentimiento expreso para datos biométricos (se guarda identity_consent_at) y rol dueño/administrador.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, hasRole, ORG_ADMIN_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { siteUrl } from "../_lib/server-utils";
import { loadOrgIdentity } from "../../../lib/producerIdentity";
import { createDiditSession, DiditError } from "../../../../netlify/lib/identity.mjs";

export const prerender = false;

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ error: "Unauthorized" }, 401);
    const { dbUser } = session;
    if (!hasRole(dbUser, ORG_ADMIN_ROLES)) {
        return jsonResponse({ message: "Solo el dueño o un administrador de la organización puede verificar la identidad." }, 403);
    }
    let body: any = {};
    try {
        body = await context.request.json();
    } catch {
        body = {};
    }
    if (body?.consent !== true) {
        return jsonResponse({ message: "Debes autorizar el tratamiento de tus datos biométricos para continuar." }, 400);
    }

    const supabase = getSupabaseAdmin();
    const orgId = Number(dbUser.organization_id);
    const org = await loadOrgIdentity(supabase, orgId);
    if (!org) return jsonResponse({ message: "Organización no encontrada" }, 404);
    if (org.identity_status === "approved") return jsonResponse({ message: "Tu identidad ya está verificada." }, 409);

    const origin = siteUrl() || new URL(context.request.url).origin;
    try {
        const { sessionId, url } = await createDiditSession({ orgId, callback: `${origin}/dashboard/settings?identidad=volver#identidad` });
        const now = new Date().toISOString();
        const { error } = await supabase
            .from("organizations")
            .update({ identity_session_id: sessionId, identity_status: "pending", identity_consent_at: now, identity_checked_at: now })
            .eq("id", orgId);
        if (error) throw error;
        return jsonResponse({ url }, 200);
    } catch (err: any) {
        if (err instanceof DiditError) {
            console.error("Didit:", err.code, err.message);
            return jsonResponse({ message: err.message }, err.code === "not_configured" ? 503 : 502);
        }
        console.error("identity/start:", err?.message || err);
        return jsonResponse({ message: "No pudimos iniciar la verificación. Inténtalo de nuevo." }, 500);
    }
};
