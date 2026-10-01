// Revocación de tokens (RFC 7009). Responde 200 aunque el token no exista.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { OAuthError, authenticateClient, clientCredentials, resolveClient, revokeToken } from "../../../lib/producer-api/oauth";
import { apiJson, preflight, readFormOrJson } from "../../../lib/producer-api/http";

export const prerender = false;
export const OPTIONS: APIRoute = () => preflight();

export const POST: APIRoute = async ({ request }) => {
    const supabase = getSupabaseAdmin();
    const form = await readFormOrJson(request);
    try {
        const { clientId, secret } = clientCredentials(request, form);
        const client = await resolveClient(supabase, clientId);
        if (!client) throw new OAuthError("invalid_client", "Cliente desconocido.", 401);
        authenticateClient(client, secret);
        await revokeToken(supabase, client, form.token || "");
        return apiJson({}, 200);
    } catch (err: any) {
        if (err instanceof OAuthError) return apiJson({ error: err.error, error_description: err.message }, err.status);
        console.error("oauth revoke:", err?.message);
        return apiJson({ error: "server_error" }, 500);
    }
};
