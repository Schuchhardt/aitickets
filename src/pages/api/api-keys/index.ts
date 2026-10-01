// Llaves de API (MCP + REST) desde el dashboard (sesión con cookie).
//   GET    /api/api-keys        llaves activas: las propias; admin/productor ve las de toda la organización
//   POST   /api/api-keys        crea { name, scopes[], expiresInDays? } y devuelve la llave en claro UNA vez
//   DELETE /api/api-keys?id=…   revoca (propia, o cualquiera de la organización si es admin/productor)
//   DELETE /api/api-keys?grant=… desconecta una app OAuth (misma regla) e invalida sus tokens
// GET también devuelve `connections`: apps conectadas por OAuth (claude.ai, ChatGPT…). Sus access tokens
// (filas con oauth_grant_id) no se listan como llaves.
// Roles: EVENT_MANAGER_ROLES (la llave actúa como el usuario que la crea). Todo filtra por organization_id.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, hasRole, EVENT_MANAGER_ROLES, ORG_ADMIN_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { generateApiKey, normalizeScopes, isMissingApiSchema, MAX_KEYS_PER_USER, API_KEY_COLUMNS } from "../../../lib/producer-api/keys";
import { revokeGrantTokens } from "../../../lib/producer-api/oauth";
import { notifySlack } from "../_lib/server-utils";

export const prerender = false;

const UNAVAILABLE = "Las llaves de API aún no están disponibles. Intenta nuevamente en unos minutos.";

async function requireManager(context: Parameters<APIRoute>[0]) {
    const session = await getSessionContext(context);
    if (!session) return { ok: false as const, response: jsonResponse({ error: "Unauthorized" }, 401) };
    if (!hasRole(session.dbUser, EVENT_MANAGER_ROLES)) {
        return { ok: false as const, response: jsonResponse({ message: "No tienes permisos para gestionar llaves de API" }, 403) };
    }
    return { ok: true as const, user: session.dbUser, isOrgAdmin: hasRole(session.dbUser, ORG_ADMIN_ROLES) };
}

function present(row: any, users: Map<number, string>, currentUserId: number) {
    return {
        id: row.id,
        name: row.name,
        prefix: row.key_prefix,
        scopes: row.scopes || [],
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
        expiresAt: row.expires_at,
        owner: users.get(Number(row.user_id)) || null,
        mine: Number(row.user_id) === currentUserId,
    };
}

/** Apps OAuth activas de la organización (o solo del usuario). Sin la migración: lista vacía. */
async function listConnections(supabase: any, orgId: number, userId: number | null) {
    let query = supabase
        .from("aitickets_oauth_grants")
        .select("id, client_name, user_id, scopes, created_at, last_used_at")
        .eq("organization_id", orgId)
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
        .limit(100);
    if (userId != null) query = query.eq("user_id", userId);
    const { data, error } = await query;
    if (error) return [];
    return data || [];
}

export const GET: APIRoute = async (context) => {
    const auth = await requireManager(context);
    if (!auth.ok) return auth.response;
    const supabase = getSupabaseAdmin();

    let query = supabase
        .from("aitickets_api_keys")
        .select(API_KEY_COLUMNS)
        .eq("organization_id", auth.user.organization_id)
        .is("revoked_at", null)
        .is("oauth_grant_id", null)
        .order("created_at", { ascending: false })
        .limit(200);
    if (!auth.isOrgAdmin) query = query.eq("user_id", auth.user.id);
    const { data, error } = await query;
    const connections = await listConnections(supabase, auth.user.organization_id, auth.isOrgAdmin ? null : auth.user.id);
    if (error) {
        if (isMissingApiSchema(error)) return jsonResponse({ keys: [], unavailable: true });
        console.error("api-keys GET:", error.message);
        return jsonResponse({ message: "No se pudieron cargar las llaves" }, 500);
    }
    const userIds = [...new Set([...(data || []), ...connections].map((r: any) => Number(r.user_id)))];
    const users = new Map<number, string>();
    if (userIds.length) {
        const { data: rows } = await supabase.from("users").select("id, name, email").eq("organization_id", auth.user.organization_id).in("id", userIds);
        for (const u of rows || []) users.set(Number(u.id), u.name || u.email || `Usuario ${u.id}`);
    }
    return jsonResponse({
        keys: (data || []).map((r: any) => present(r, users, auth.user.id)),
        connections: connections.map((g: any) => ({
            id: g.id,
            name: g.client_name,
            scopes: g.scopes || [],
            createdAt: g.created_at,
            lastUsedAt: g.last_used_at,
            owner: users.get(Number(g.user_id)) || null,
            mine: Number(g.user_id) === auth.user.id,
        })),
    });
};

export const POST: APIRoute = async (context) => {
    const auth = await requireManager(context);
    if (!auth.ok) return auth.response;
    const supabase = getSupabaseAdmin();

    let body: any;
    try {
        body = await context.request.json();
    } catch {
        return jsonResponse({ message: "Solicitud inválida" }, 400);
    }
    const name = String(body?.name || "").trim().slice(0, 80);
    if (!name) return jsonResponse({ message: "Ponle un nombre a la llave (ej: Claude de Sebastián)." }, 400);
    const scopes = normalizeScopes(body?.scopes);
    const days = body?.expiresInDays == null || body.expiresInDays === "" ? null : Math.floor(Number(body.expiresInDays));
    if (days !== null && (!Number.isFinite(days) || days < 1 || days > 730)) {
        return jsonResponse({ message: "La vigencia debe estar entre 1 y 730 días (o sin vencimiento)." }, 400);
    }

    const { count, error: countError } = await supabase
        .from("aitickets_api_keys")
        .select("id", { count: "exact", head: true })
        .eq("user_id", auth.user.id)
        .is("revoked_at", null)
        .is("oauth_grant_id", null);
    if (countError && isMissingApiSchema(countError)) return jsonResponse({ message: UNAVAILABLE }, 503);
    if ((count || 0) >= MAX_KEYS_PER_USER) {
        return jsonResponse({ message: `Tienes ${MAX_KEYS_PER_USER} llaves activas. Revoca alguna antes de crear otra.` }, 409);
    }

    const { key, prefix, hash } = generateApiKey();
    const { data, error } = await supabase
        .from("aitickets_api_keys")
        .insert({
            organization_id: auth.user.organization_id,
            user_id: auth.user.id,
            name,
            key_prefix: prefix,
            key_hash: hash,
            scopes,
            expires_at: days ? new Date(Date.now() + days * 86400000).toISOString() : null,
        })
        .select(API_KEY_COLUMNS)
        .single();
    if (error) {
        if (isMissingApiSchema(error)) return jsonResponse({ message: UNAVAILABLE }, 503);
        console.error("api-keys POST:", error.message);
        return jsonResponse({ message: "No se pudo crear la llave" }, 500);
    }
    await notifySlack(`🔑 *Llave de API creada*\n• *Org:* ${auth.user.organization_id}\n• *Usuario:* ${auth.user.name || auth.user.email}\n• *Permisos:* ${scopes.join(", ")}`);
    const users = new Map([[Number(auth.user.id), auth.user.name || auth.user.email || ""]]);
    return jsonResponse({ key, apiKey: present(data, users, auth.user.id) }, 201);
};

export const DELETE: APIRoute = async (context) => {
    const auth = await requireManager(context);
    if (!auth.ok) return auth.response;
    const supabase = getSupabaseAdmin();

    const grantId = context.url.searchParams.get("grant");
    if (grantId !== null) {
        if (!/^[0-9a-f-]{36}$/i.test(grantId)) return jsonResponse({ message: "Conexión inválida" }, 400);
        let grantQuery = supabase
            .from("aitickets_oauth_grants")
            .update({ revoked_at: new Date().toISOString() })
            .eq("id", grantId)
            .eq("organization_id", auth.user.organization_id)
            .is("revoked_at", null);
        if (!auth.isOrgAdmin) grantQuery = grantQuery.eq("user_id", auth.user.id);
        const { data: revoked, error: grantError } = await grantQuery.select("id");
        if (grantError) return jsonResponse({ message: "No se pudo desconectar la app" }, 500);
        if (!revoked?.length) return jsonResponse({ message: "Conexión no encontrada" }, 404);
        await revokeGrantTokens(supabase, grantId);
        return jsonResponse({ revoked: true });
    }

    const id = context.url.searchParams.get("id") || "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonResponse({ message: "Llave inválida" }, 400);

    let query = supabase
        .from("aitickets_api_keys")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id)
        .eq("organization_id", auth.user.organization_id)
        .is("revoked_at", null);
    if (!auth.isOrgAdmin) query = query.eq("user_id", auth.user.id);
    const { data, error } = await query.select("id");
    if (error) {
        if (isMissingApiSchema(error)) return jsonResponse({ message: UNAVAILABLE }, 503);
        console.error("api-keys DELETE:", error.message);
        return jsonResponse({ message: "No se pudo revocar la llave" }, 500);
    }
    if (!data?.length) return jsonResponse({ message: "Llave no encontrada" }, 404);
    return jsonResponse({ revoked: true });
};
