// Servidor de autorización OAuth 2.1 para la API de productores (MCP). Ver
// db/migrations/202610010200_producer_oauth.sql y https://modelcontextprotocol.io/specification (Authorization).
//
// - Authorization code + PKCE S256 obligatorio. Sin implicit ni password.
// - Clientes: registro dinámico (RFC 7591, /api/oauth/register) o Client ID Metadata Document (client_id es
//   una URL https que publica { client_id, client_name, redirect_uris }).
// - redirect_uri: coincidencia exacta; loopback http (localhost/127.0.0.1/[::1]) con cualquier puerto (RFC 8252).
// - Access token = fila de aitickets_api_keys (1 h) ligada al grant; refresh token rotativo (90 días).
// - Todos los tokens/códigos se guardan como sha256.
import { API_ROLES } from "./permissions";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { generateApiKey, hashApiKey, normalizeScopes, API_SCOPES, type ApiScope } from "./keys";
import { fetchPublic, SafeFetchError } from "../safe-fetch";

export const ACCESS_TOKEN_TTL_SECONDS = 3600;
export const REFRESH_TOKEN_TTL_DAYS = 90;
export const CODE_TTL_SECONDS = 600;
export const DEFAULT_OAUTH_SCOPES: ApiScope[] = ["read", "write"];

export class OAuthError extends Error {
    error: string;
    status: number;
    constructor(error: string, description: string, status = 400) {
        super(description);
        this.error = error;
        this.status = status;
    }
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const randomToken = (prefix: string) => prefix + randomBytes(32).toString("base64url");

export const mcpResource = (origin: string) => `${origin}/api/mcp`;

// ---------------------------------------------------------------------------
// Metadatos (RFC 8414 y RFC 9728)
// ---------------------------------------------------------------------------

export function authorizationServerMetadata(origin: string) {
    return {
        issuer: origin,
        authorization_endpoint: `${origin}/oauth/authorize`,
        token_endpoint: `${origin}/api/oauth/token`,
        registration_endpoint: `${origin}/api/oauth/register`,
        revocation_endpoint: `${origin}/api/oauth/revoke`,
        response_types_supported: ["code"],
        response_modes_supported: ["query"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
        revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
        scopes_supported: [...API_SCOPES],
        client_id_metadata_document_supported: true,
        authorization_response_iss_parameter_supported: true,
        service_documentation: `${origin}/dashboard/ia`,
    };
}

export function protectedResourceMetadata(origin: string) {
    return {
        resource: mcpResource(origin),
        authorization_servers: [origin],
        scopes_supported: [...API_SCOPES],
        bearer_methods_supported: ["header"],
        resource_name: "AI Tickets",
        resource_documentation: `${origin}/dashboard/ia`,
    };
}

export const resourceMetadataUrl = (origin: string) => `${origin}/.well-known/oauth-protected-resource/api/mcp`;

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "about:", "blob:", "ftp:", "ws:", "wss:"]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Valida un redirect_uri registrable: https, http loopback o esquema propio de app nativa (cursor://…). */
export function isValidRedirectUri(raw: unknown): boolean {
    if (typeof raw !== "string" || raw.length > 2000) return false;
    let u: URL;
    try {
        u = new URL(raw);
    } catch {
        return false;
    }
    if (u.hash || u.username || u.password) return false;
    if (u.protocol === "https:") return Boolean(u.hostname);
    if (u.protocol === "http:") return LOOPBACK.has(u.hostname);
    if (BLOCKED_SCHEMES.has(u.protocol)) return false;
    return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol);
}

/** ¿`requested` coincide con algún redirect registrado? Exacta, salvo el puerto en loopback http. */
export function redirectUriMatches(requested: string, registered: string[]): boolean {
    if (registered.includes(requested)) return true;
    let r: URL;
    try {
        r = new URL(requested);
    } catch {
        return false;
    }
    if (r.protocol !== "http:" || !LOOPBACK.has(r.hostname)) return false;
    return registered.some((reg) => {
        try {
            const g = new URL(reg);
            return g.protocol === "http:" && g.hostname === r.hostname && g.pathname === r.pathname && g.search === r.search;
        } catch {
            return false;
        }
    });
}

export type OAuthClient = {
    client_id: string;
    client_name: string;
    redirect_uris: string[];
    token_endpoint_auth_method: "none" | "client_secret_post" | "client_secret_basic";
    client_secret_hash: string | null;
    client_uri?: string | null;
    source: "registered" | "metadata_document";
};

const cleanName = (v: unknown, fallback: string) => {
    const s = typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 100) : "";
    return s || fallback;
};

/** Registro dinámico (RFC 7591). Devuelve la respuesta de registro (con client_secret si es confidencial). */
export async function registerClient(supabase: any, body: any) {
    const redirectUris = Array.isArray(body?.redirect_uris) ? body.redirect_uris : [];
    if (!redirectUris.length || redirectUris.length > 10 || !redirectUris.every(isValidRedirectUri)) {
        throw new OAuthError("invalid_redirect_uri", "redirect_uris debe tener entre 1 y 10 URIs válidas (https, http://localhost o esquema de app).");
    }
    const method = body?.token_endpoint_auth_method ?? "none";
    if (!["none", "client_secret_post", "client_secret_basic"].includes(method)) {
        throw new OAuthError("invalid_client_metadata", "token_endpoint_auth_method no soportado.");
    }
    const grants = body?.grant_types ?? ["authorization_code", "refresh_token"];
    if (!Array.isArray(grants) || !grants.includes("authorization_code") || grants.some((g: string) => !["authorization_code", "refresh_token"].includes(g))) {
        throw new OAuthError("invalid_client_metadata", "grant_types debe incluir authorization_code (y opcionalmente refresh_token).");
    }
    const responseTypes = body?.response_types ?? ["code"];
    if (!Array.isArray(responseTypes) || responseTypes.some((r: string) => r !== "code")) {
        throw new OAuthError("invalid_client_metadata", "Solo se soporta response_type=code.");
    }
    const clientUri = typeof body?.client_uri === "string" && /^https:\/\//.test(body.client_uri) ? body.client_uri.slice(0, 500) : null;

    const clientId = randomToken("aitc_");
    const secret = method === "none" ? null : randomToken("aits_");
    const row = {
        client_id: clientId,
        client_secret_hash: secret ? sha256(secret) : null,
        client_name: cleanName(body?.client_name, "Cliente MCP"),
        redirect_uris: redirectUris,
        token_endpoint_auth_method: method,
        client_uri: clientUri,
    };
    const { error } = await supabase.from("aitickets_oauth_clients").insert(row);
    if (error) throw error;
    return {
        client_id: clientId,
        ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: row.client_name,
        redirect_uris: redirectUris,
        token_endpoint_auth_method: method,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        ...(clientUri ? { client_uri: clientUri } : {}),
    };
}

/** Busca un cliente registrado o, si client_id es una URL https, lee su Client ID Metadata Document. */
export async function resolveClient(supabase: any, clientId: string, fetchImpl: typeof fetch = fetch): Promise<OAuthClient | null> {
    if (!clientId || clientId.length > 500) return null;
    if (clientId.startsWith("https://")) {
        let doc: any;
        try {
            const { buffer } = await fetchPublic(clientId, { maxBytes: 64 * 1024, accept: "application/json", timeoutMs: 5000, fetchImpl });
            doc = JSON.parse(buffer.toString("utf8"));
        } catch (err) {
            if (err instanceof SafeFetchError || err instanceof SyntaxError) return null;
            throw err;
        }
        if (!doc || doc.client_id !== clientId) return null;
        const uris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.filter(isValidRedirectUri).slice(0, 10) : [];
        if (!uris.length) return null;
        return {
            client_id: clientId,
            client_name: cleanName(doc.client_name, new URL(clientId).hostname),
            redirect_uris: uris,
            token_endpoint_auth_method: "none",
            client_secret_hash: null,
            client_uri: typeof doc.client_uri === "string" ? doc.client_uri : null,
            source: "metadata_document",
        };
    }
    const { data } = await supabase
        .from("aitickets_oauth_clients")
        .select("client_id, client_name, redirect_uris, token_endpoint_auth_method, client_secret_hash, client_uri")
        .eq("client_id", clientId)
        .maybeSingle();
    return data ? { ...data, source: "registered" } : null;
}

/** Autentica al cliente en el token endpoint según su método registrado. */
export function authenticateClient(client: OAuthClient, presentedSecret: string | null) {
    if (client.token_endpoint_auth_method === "none") return;
    if (!presentedSecret || !client.client_secret_hash) throw new OAuthError("invalid_client", "Autenticación del cliente inválida.", 401);
    const a = Buffer.from(sha256(presentedSecret), "hex");
    const b = Buffer.from(client.client_secret_hash, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new OAuthError("invalid_client", "Autenticación del cliente inválida.", 401);
}

// ---------------------------------------------------------------------------
// Autorización
// ---------------------------------------------------------------------------

export function parseScope(raw: unknown): ApiScope[] {
    if (typeof raw !== "string" || !raw.trim()) return DEFAULT_OAUTH_SCOPES;
    return normalizeScopes(raw.split(/\s+/));
}

export function verifyPkce(verifier: unknown, challenge: string): boolean {
    if (typeof verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
    const computed = createHash("sha256").update(verifier).digest("base64url");
    const a = Buffer.from(computed);
    const b = Buffer.from(challenge);
    return a.length === b.length && timingSafeEqual(a, b);
}

export type AuthorizeRequest = {
    client: OAuthClient;
    redirectUri: string;
    state: string | null;
    codeChallenge: string;
    scopes: ApiScope[];
    resource: string | null;
};

/**
 * Valida los parámetros de /oauth/authorize.
 * - `fatal`: client_id o redirect_uri inválidos → se muestra un error y NUNCA se redirige.
 * - `redirectError`: el resto de errores se devuelven al cliente por su redirect_uri.
 */
export async function validateAuthorizeParams(
    supabase: any,
    params: URLSearchParams,
    origin: string,
    fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; req: AuthorizeRequest } | { ok: false; fatal: string } | { ok: false; redirectError: { redirectUri: string; error: string; description: string; state: string | null } }> {
    const clientId = params.get("client_id") || "";
    const client = await resolveClient(supabase, clientId, fetchImpl);
    if (!client) return { ok: false, fatal: "La aplicación que intenta conectarse no está registrada o no es válida." };
    const redirectUri = params.get("redirect_uri") || (client.redirect_uris.length === 1 ? client.redirect_uris[0] : "");
    if (!redirectUri || !redirectUriMatches(redirectUri, client.redirect_uris)) {
        return { ok: false, fatal: "La dirección de retorno (redirect_uri) no coincide con la registrada por la aplicación." };
    }
    const state = params.get("state");
    const fail = (error: string, description: string) => ({ ok: false as const, redirectError: { redirectUri, error, description, state } });
    if (params.get("response_type") !== "code") return fail("unsupported_response_type", "Solo se soporta response_type=code.");
    const challenge = params.get("code_challenge") || "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(challenge) || params.get("code_challenge_method") !== "S256") {
        return fail("invalid_request", "PKCE es obligatorio (code_challenge con code_challenge_method=S256).");
    }
    const resource = params.get("resource");
    if (resource && resource.replace(/\/+$/, "") !== mcpResource(origin) && resource.replace(/\/+$/, "") !== origin) {
        return fail("invalid_target", "resource no corresponde a este servidor.");
    }
    return { ok: true, req: { client, redirectUri, state, codeChallenge: challenge, scopes: parseScope(params.get("scope")), resource } };
}

/** Crea un código de autorización y devuelve la URL de retorno al cliente. */
export async function createAuthorizationCode(
    supabase: any,
    req: AuthorizeRequest,
    user: { id: number; organization_id: number },
    grantedScopes: ApiScope[],
    origin: string,
): Promise<string> {
    const code = randomToken("aitcode_");
    const { error } = await supabase.from("aitickets_oauth_codes").insert({
        code_hash: sha256(code),
        client_id: req.client.client_id,
        client_name: req.client.client_name,
        user_id: user.id,
        organization_id: user.organization_id,
        redirect_uri: req.redirectUri,
        code_challenge: req.codeChallenge,
        scopes: normalizeScopes(grantedScopes),
        resource: req.resource,
        expires_at: new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString(),
    });
    if (error) throw error;
    return buildRedirect(req.redirectUri, { code, state: req.state, iss: origin });
}

export function buildRedirect(redirectUri: string, params: Record<string, string | null | undefined>): string {
    const u = new URL(redirectUri);
    for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
    return u.toString();
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

async function issueAccessToken(supabase: any, grant: { id: string; client_name: string; user_id: number; organization_id: number; scopes: string[] }) {
    const { key, prefix, hash } = generateApiKey();
    const { error } = await supabase.from("aitickets_api_keys").insert({
        organization_id: grant.organization_id,
        user_id: grant.user_id,
        name: grant.client_name.slice(0, 80),
        key_prefix: prefix,
        key_hash: hash,
        scopes: normalizeScopes(grant.scopes),
        expires_at: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
        oauth_grant_id: grant.id,
    });
    if (error) throw error;
    // Limpieza: tokens vencidos de este grant
    await supabase.from("aitickets_api_keys").delete().eq("oauth_grant_id", grant.id).lt("expires_at", new Date().toISOString());
    return key;
}

const tokenResponse = (accessToken: string, refreshToken: string, scopes: string[]) => ({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: normalizeScopes(scopes).join(" "),
});

/** grant_type=authorization_code */
export async function exchangeAuthorizationCode(
    supabase: any,
    client: OAuthClient,
    { code, redirectUri, codeVerifier }: { code: string; redirectUri: string | null; codeVerifier: string | null },
) {
    if (!code) throw new OAuthError("invalid_request", "Falta code.");
    // Canje atómico: solo la primera petición marca used_at
    const { data: rows, error } = await supabase
        .from("aitickets_oauth_codes")
        .update({ used_at: new Date().toISOString() })
        .eq("code_hash", sha256(code))
        .is("used_at", null)
        .select("client_id, client_name, user_id, organization_id, redirect_uri, code_challenge, scopes, expires_at");
    if (error) throw error;
    const row = rows?.[0];
    if (!row) throw new OAuthError("invalid_grant", "El código no es válido o ya fue usado.");
    if (row.client_id !== client.client_id) throw new OAuthError("invalid_grant", "El código no pertenece a este cliente.");
    if (new Date(row.expires_at).getTime() < Date.now()) throw new OAuthError("invalid_grant", "El código venció.");
    if ((redirectUri || row.redirect_uri) !== row.redirect_uri) throw new OAuthError("invalid_grant", "redirect_uri no coincide.");
    if (!verifyPkce(codeVerifier, row.code_challenge)) throw new OAuthError("invalid_grant", "code_verifier inválido (PKCE).");

    const refresh = randomToken("aitr_");
    const { data: grant, error: grantError } = await supabase
        .from("aitickets_oauth_grants")
        .insert({
            client_id: client.client_id,
            client_name: row.client_name,
            user_id: row.user_id,
            organization_id: row.organization_id,
            scopes: row.scopes,
            refresh_hash: sha256(refresh),
            refresh_expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86400000).toISOString(),
            last_used_at: new Date().toISOString(),
        })
        .select("id, client_name, user_id, organization_id, scopes")
        .single();
    if (grantError) throw grantError;
    const access = await issueAccessToken(supabase, grant);
    // Limpieza oportunista de códigos viejos
    await supabase.from("aitickets_oauth_codes").delete().lt("expires_at", new Date(Date.now() - 86400000).toISOString());
    return tokenResponse(access, refresh, grant.scopes);
}

/** grant_type=refresh_token (rotación: el refresh token usado deja de servir). */
export async function refreshAccessToken(supabase: any, client: OAuthClient, refreshToken: string | null, requestedScope: string | null) {
    if (!refreshToken) throw new OAuthError("invalid_request", "Falta refresh_token.");
    const oldHash = sha256(refreshToken);
    const invalid = () => new OAuthError("invalid_grant", "El refresh token no es válido, venció o fue revocado.");

    // 1. Validar sin consumir: un error (scope, usuario) no debe quemar el refresh token
    const { data: grant, error } = await supabase
        .from("aitickets_oauth_grants")
        .select("id, client_id, client_name, user_id, organization_id, scopes, refresh_expires_at, revoked_at")
        .eq("refresh_hash", oldHash)
        .maybeSingle();
    if (error) throw error;
    if (!grant || grant.revoked_at || grant.client_id !== client.client_id || new Date(grant.refresh_expires_at).getTime() <= Date.now()) throw invalid();

    let scopes: string[] = grant.scopes;
    if (requestedScope) {
        // RFC 6749 §6: solo se puede pedir un subconjunto de lo autorizado
        const requested = parseScope(requestedScope);
        if (requested.some((s) => !grant.scopes.includes(s))) throw new OAuthError("invalid_scope", "Los scopes pedidos exceden los autorizados.");
        scopes = requested;
    }

    // El usuario debe seguir activo, en la organización y con rol de gestión (si no, se revoca la conexión)
    const { data: user } = await supabase.from("users").select("id, organization_id, role, active").eq("id", grant.user_id).maybeSingle();
    if (!user || user.active === false || Number(user.organization_id) !== Number(grant.organization_id) || !API_ROLES.includes(user.role || "")) {
        await supabase.from("aitickets_oauth_grants").update({ revoked_at: new Date().toISOString() }).eq("id", grant.id);
        await revokeGrantTokens(supabase, grant.id);
        throw new OAuthError("invalid_grant", "El usuario ya no tiene acceso a la organización.");
    }

    // 2. Rotar de forma atómica: solo gana la petición que aún ve el hash anterior
    const next = randomToken("aitr_");
    const { data: rotated, error: rotateError } = await supabase
        .from("aitickets_oauth_grants")
        .update({ refresh_hash: sha256(next), last_used_at: new Date().toISOString(), refresh_expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86400000).toISOString() })
        .eq("id", grant.id)
        .eq("refresh_hash", oldHash)
        .is("revoked_at", null)
        .select("id");
    if (rotateError) throw rotateError;
    if (!rotated?.length) throw invalid();

    const access = await issueAccessToken(supabase, { ...grant, scopes });
    return tokenResponse(access, next, scopes);
}

/** Invalida los access tokens vivos de una conexión. */
export async function revokeGrantTokens(supabase: any, grantId: string) {
    await supabase.from("aitickets_api_keys").update({ revoked_at: new Date().toISOString() }).eq("oauth_grant_id", grantId).is("revoked_at", null);
}

/** RFC 7009: revoca un access token (su fila) o un refresh token (toda la conexión). Siempre "ok". */
export async function revokeToken(supabase: any, client: OAuthClient, token: string) {
    if (!token) return;
    const hash = sha256(token);
    const { data: revoked } = await supabase
        .from("aitickets_oauth_grants")
        .update({ revoked_at: new Date().toISOString() })
        .eq("refresh_hash", hash)
        .eq("client_id", client.client_id)
        .select("id");
    for (const g of revoked || []) await revokeGrantTokens(supabase, g.id);
    const { data: key } = await supabase.from("aitickets_api_keys").select("id, oauth_grant_id").eq("key_hash", hashApiKey(token)).maybeSingle();
    if (key?.oauth_grant_id) {
        const { data: grant } = await supabase.from("aitickets_oauth_grants").select("client_id").eq("id", key.oauth_grant_id).maybeSingle();
        if (grant?.client_id === client.client_id) {
            await supabase.from("aitickets_api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", key.id);
        }
    }
}

/** Lee credenciales del cliente: Basic auth o client_id/client_secret en el cuerpo. */
export function clientCredentials(request: Request, form: Record<string, string>): { clientId: string; secret: string | null } {
    const basic = /^Basic\s+(.+)$/i.exec(request.headers.get("authorization") || "");
    if (basic) {
        try {
            const decoded = Buffer.from(basic[1], "base64").toString("utf8");
            const i = decoded.indexOf(":");
            if (i > 0) return { clientId: decodeURIComponent(decoded.slice(0, i)), secret: decodeURIComponent(decoded.slice(i + 1)) };
        } catch { /* cae al cuerpo */ }
    }
    return { clientId: form.client_id || "", secret: form.client_secret || null };
}
