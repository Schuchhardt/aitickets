// Decisión del consentimiento OAuth (formulario de /oauth/authorize, con la sesión del productor).
// Revalida todos los parámetros y redirige (303) al redirect_uri del cliente con code o error.
// Protección CSRF: el middleware exige mismo origen para los POST a /api con cookie.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, hasRole, jsonResponse } from "../../../lib/supabaseServer";
import { API_ROLES } from "../../../lib/producer-api/permissions";
import { siteUrl } from "../_lib/server-utils";
import { buildRedirect, createAuthorizationCode, validateAuthorizeParams } from "../../../lib/producer-api/oauth";
import { normalizeScopes } from "../../../lib/producer-api/keys";

export const prerender = false;

export const POST: APIRoute = async (context) => {
    const origin = siteUrl() || context.url.origin;
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ error: "Unauthorized" }, 401);
    if (!hasRole(session.dbUser, API_ROLES)) return jsonResponse({ message: "Tu rol no permite conectar asistentes de IA" }, 403);

    const form = await context.request.formData();
    const params = new URLSearchParams(String(form.get("params") || ""));
    const supabase = getSupabaseAdmin();
    const result = await validateAuthorizeParams(supabase, params, origin);
    if (!result.ok) {
        if ("fatal" in result) return jsonResponse({ message: result.fatal }, 400);
        const e = result.redirectError;
        return context.redirect(buildRedirect(e.redirectUri, { error: e.error, error_description: e.description, state: e.state, iss: origin }), 303);
    }
    const { req } = result;

    if (form.get("decision") !== "allow") {
        return context.redirect(buildRedirect(req.redirectUri, { error: "access_denied", error_description: "El usuario canceló la conexión.", state: req.state, iss: origin }), 303);
    }
    const granted = normalizeScopes(form.getAll("scope").map(String));
    try {
        const location = await createAuthorizationCode(supabase, req, { id: session.dbUser.id, organization_id: session.dbUser.organization_id }, granted, origin);
        return context.redirect(location, 303);
    } catch (err: any) {
        console.error("oauth authorize POST:", err?.message);
        return context.redirect(buildRedirect(req.redirectUri, { error: "server_error", state: req.state, iss: origin }), 303);
    }
};
