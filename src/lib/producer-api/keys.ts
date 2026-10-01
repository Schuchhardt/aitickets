// Llaves de API de productores (REST /api/v1 y MCP /api/mcp). Ver db/migrations/202610010100_producer_api_keys.sql.
//
// Formato: "aitk_" + 32 bytes aleatorios en base64url. En la BD solo queda el sha256 (hex): con 256 bits de
// entropía no hace falta un hash lento ni pimienta. Cada llave actúa como el usuario que la creó y la
// autorización se re-evalúa en CADA petición (usuario activo, misma organización, rol de gestión de eventos).
import { createHash, randomBytes } from "node:crypto";
import { EVENT_MANAGER_ROLES } from "../supabaseServer";

export const API_KEY_PREFIX = "aitk_";
export const API_SCOPES = ["read", "write", "publish", "attendees"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const SCOPE_LABELS: Record<ApiScope, string> = {
    read: "Ver eventos, entradas, descuentos y estadísticas",
    write: "Crear y editar eventos, entradas, descuentos e imágenes",
    publish: "Publicar/pausar eventos y publicar en redes sociales",
    attendees: "Ver compradores (nombre, email, teléfono)",
};

export const MAX_KEYS_PER_USER = 10;
export const API_KEY_COLUMNS = "id, organization_id, user_id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_at";

const KEY_RE = /^aitk_[A-Za-z0-9_-]{43}$/;

export type ApiActor = {
    keyId: string;
    userId: number;
    orgId: number;
    role: string;
    name: string | null;
    email: string | null;
    scopes: ApiScope[];
};

export type AuthResult =
    | { ok: true; actor: ApiActor }
    | { ok: false; status: 401 | 403 | 503; error: string };

export function generateApiKey(): { key: string; prefix: string; hash: string } {
    const key = API_KEY_PREFIX + randomBytes(32).toString("base64url");
    return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
    return createHash("sha256").update(key).digest("hex");
}

/** Normaliza la lista de scopes pedida. Sin "read" no se puede hacer nada útil: se agrega siempre. */
export function normalizeScopes(raw: unknown): ApiScope[] {
    const list = Array.isArray(raw) ? raw : [];
    const set = new Set<ApiScope>(["read"]);
    for (const s of list) if ((API_SCOPES as readonly string[]).includes(String(s))) set.add(s as ApiScope);
    return API_SCOPES.filter((s) => set.has(s));
}

/** Extrae la llave de "Authorization: Bearer aitk_..." o "X-API-Key: aitk_...". */
export function extractApiKey(request: Request): string | null {
    const auth = request.headers.get("authorization") || "";
    const match = /^Bearer\s+(\S+)\s*$/i.exec(auth);
    const raw = match ? match[1] : (request.headers.get("x-api-key") || "").trim();
    return raw || null;
}

/** La tabla todavía no existe (deploy preview sobre una BD sin la migración). */
export const isMissingApiSchema = (error: any) =>
    ["42P01", "PGRST205", "42703", "PGRST204"].includes(String(error?.code || "")) || /aitickets_api_keys/.test(String(error?.message || ""));

const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

/** Autentica una petición con llave de API. */
export async function authenticateApiKey(supabase: any, rawKey: string | null, now = new Date()): Promise<AuthResult> {
    if (!rawKey) return { ok: false, status: 401, error: "Falta la llave de API (Authorization: Bearer aitk_...)." };
    if (!KEY_RE.test(rawKey)) return { ok: false, status: 401, error: "Llave de API inválida." };

    const { data: key, error } = await supabase
        .from("aitickets_api_keys")
        .select("id, organization_id, user_id, scopes, last_used_at, expires_at, revoked_at")
        .eq("key_hash", hashApiKey(rawKey))
        .maybeSingle();
    if (error) {
        if (isMissingApiSchema(error)) return { ok: false, status: 503, error: "La API todavía no está disponible. Intenta en unos minutos." };
        console.error("authenticateApiKey:", error.message);
        return { ok: false, status: 503, error: "No se pudo validar la llave. Intenta nuevamente." };
    }
    if (!key || key.revoked_at) return { ok: false, status: 401, error: "Llave de API inválida o revocada." };
    if (key.expires_at && new Date(key.expires_at).getTime() <= now.getTime()) {
        return { ok: false, status: 401, error: "La llave de API venció. Crea una nueva en el panel." };
    }

    const { data: user } = await supabase
        .from("users")
        .select("id, name, email, organization_id, role, active")
        .eq("id", key.user_id)
        .maybeSingle();
    if (!user || user.active === false || Number(user.organization_id) !== Number(key.organization_id)) {
        return { ok: false, status: 401, error: "El usuario de esta llave ya no tiene acceso a la organización." };
    }
    if (!EVENT_MANAGER_ROLES.includes(user.role || "")) {
        return { ok: false, status: 403, error: "Tu rol no permite usar la API (requiere admin, productor o editor)." };
    }

    if (!key.last_used_at || now.getTime() - new Date(key.last_used_at).getTime() > LAST_USED_THROTTLE_MS) {
        const { error: touchError } = await supabase
            .from("aitickets_api_keys")
            .update({ last_used_at: now.toISOString() })
            .eq("id", key.id);
        if (touchError) console.warn("api key last_used_at:", touchError.message);
    }

    return {
        ok: true,
        actor: {
            keyId: String(key.id),
            userId: Number(user.id),
            orgId: Number(key.organization_id),
            role: String(user.role),
            name: user.name ?? null,
            email: user.email ?? null,
            scopes: normalizeScopes(key.scopes),
        },
    };
}
