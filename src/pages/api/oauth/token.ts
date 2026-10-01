// Token endpoint OAuth 2.1: authorization_code (+PKCE) y refresh_token (rotativo).
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import {
    OAuthError, authenticateClient, clientCredentials, exchangeAuthorizationCode, refreshAccessToken, resolveClient,
} from "../../../lib/producer-api/oauth";
import { apiJson, clientIp, preflight, readFormOrJson } from "../../../lib/producer-api/http";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";

export const prerender = false;
export const OPTIONS: APIRoute = () => preflight();

const oauthError = (err: OAuthError) =>
    apiJson({ error: err.error, error_description: err.message }, err.status, { Pragma: "no-cache", ...(err.status === 401 ? { "WWW-Authenticate": 'Basic realm="aitickets"' } : {}) });

export const POST: APIRoute = async ({ request }) => {
    const supabase = getSupabaseAdmin();
    const limit = await rateLimit("oauth:token", clientIp(request), { windowSeconds: 60, max: 60, supabase });
    if (!limit.allowed) return apiJson({ error: "slow_down", error_description: "Demasiadas peticiones." }, 429, { "Retry-After": "60" });

    const form = await readFormOrJson(request);
    try {
        const { clientId, secret } = clientCredentials(request, form);
        const client = await resolveClient(supabase, clientId);
        if (!client) throw new OAuthError("invalid_client", "Cliente desconocido.", 401);
        authenticateClient(client, secret);

        if (form.grant_type === "authorization_code") {
            const tokens = await exchangeAuthorizationCode(supabase, client, {
                code: form.code || "",
                redirectUri: form.redirect_uri || null,
                codeVerifier: form.code_verifier || null,
            });
            return apiJson(tokens, 200, { Pragma: "no-cache" });
        }
        if (form.grant_type === "refresh_token") {
            return apiJson(await refreshAccessToken(supabase, client, form.refresh_token || null, form.scope || null), 200, { Pragma: "no-cache" });
        }
        throw new OAuthError("unsupported_grant_type", "grant_type no soportado.");
    } catch (err: any) {
        if (err instanceof OAuthError) return oauthError(err);
        console.error("oauth token:", err?.message);
        return apiJson({ error: "server_error" }, 500);
    }
};
