// Autenticación del MCP de administración (/api/admin/mcp). Ver docs/specs/mcp-admin.md (secciones 4 y 8).
//
// - Llave estática "aitkadm_" + 32 bytes en base64url. En el entorno solo vive su sha256 (hex):
//     AITICKETS_ADMIN_KEY_SHA256           llave completa (admite dos valores separados por coma para rotar)
//     AITICKETS_ADMIN_READONLY_KEY_SHA256  opcional: llave que solo ve y ejecuta herramientas de lectura
//     ADMIN_MCP_ENABLED=true               interruptor (sin él, el endpoint no existe)
//   Se leen en runtime (serverEnv = process.env), nunca import.meta.env: Vite incrusta esos valores en el bundle.
//   Deben estar SOLO en el contexto Production de Netlify: los deploy previews comparten la BD y ejecutan
//   código no confiable.
// - Solo responde en el host de SITE_URL (deja fuera *.netlify.app y los dominios de productores).
// - Endpoint deshabilitado u otro host → 404 (no existe). Llave inválida → 401 y cuenta para el límite por IP.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { notifySlack, serverEnv, siteUrl } from "../../pages/api/_lib/server-utils";
import { rateLimit } from "../../../netlify/lib/rate-limit.mjs";
import { clientIp } from "../producer-api/http";

export const ADMIN_KEY_PREFIX = "aitkadm_";
const ADMIN_KEY_RE = /^aitkadm_[A-Za-z0-9_-]{43}$/;
const HASH_RE = /^[0-9a-f]{64}$/;

export const ADMIN_REQUESTS_PER_MINUTE = 300;
export const AUTH_FAILURE_WINDOW_SECONDS = 15 * 60;
export const AUTH_FAILURES_PER_WINDOW = 10;

export type AdminKeyKind = "full" | "readonly";

export type AdminAuth =
    | { ok: true; keyKind: AdminKeyKind; fingerprint: string; ipHash: string }
    | { ok: false; status: 401 | 404 | 429; error: string };

export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** Llave nueva y su hash (scripts/admin-key.mjs). La llave en claro se muestra una sola vez. */
export function generateAdminKey(): { key: string; hash: string } {
    const key = ADMIN_KEY_PREFIX + randomBytes(32).toString("base64url");
    return { key, hash: sha256(key) };
}

const hashList = (name: string) =>
    (serverEnv(name) || "")
        .split(",")
        .map((h) => h.trim().toLowerCase())
        .filter((h) => HASH_RE.test(h));

export function adminConfig() {
    return {
        enabled: serverEnv("ADMIN_MCP_ENABLED") === "true",
        full: hashList("AITICKETS_ADMIN_KEY_SHA256"),
        readonly: hashList("AITICKETS_ADMIN_READONLY_KEY_SHA256"),
    };
}

/** Host real de la petición (como rawRequestHost del middleware: nunca X-Forwarded-Host). */
function requestHost(request: Request): string {
    return (request.headers.get("host") || new URL(request.url).host).split(",")[0].trim().toLowerCase();
}

/** El MCP de admin solo existe en el host de SITE_URL. Sin SITE_URL no hay host válido. */
export function isAdminHost(request: Request): boolean {
    const site = siteUrl();
    if (!site) return false;
    try {
        return requestHost(request) === new URL(site).host.toLowerCase();
    } catch {
        return false;
    }
}

function bearer(request: Request): string | null {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("authorization") || "");
    return match ? match[1] : null;
}

const matchesAny = (hash: string, list: string[]) => {
    const given = Buffer.from(hash, "hex");
    let found = false;
    // Se comparan todas (sin salir antes) en tiempo constante
    for (const h of list) if (timingSafeEqual(given, Buffer.from(h, "hex"))) found = true;
    return found;
};

/** ¿El endpoint está habilitado en este host? (si no, todo responde 404). */
export function adminEndpointAvailable(request: Request): boolean {
    const cfg = adminConfig();
    return cfg.enabled && cfg.full.length + cfg.readonly.length > 0 && isAdminHost(request);
}

export async function authenticateAdminRequest(request: Request, supabase: any): Promise<AdminAuth> {
    if (!adminEndpointAvailable(request)) return { ok: false, status: 404, error: "Not found" };
    const cfg = adminConfig();
    const ip = clientIp(request);
    const ipHash = sha256(ip);

    const raw = bearer(request);
    const hash = raw && ADMIN_KEY_RE.test(raw) ? sha256(raw) : null;
    const keyKind: AdminKeyKind | null = hash ? (matchesAny(hash, cfg.full) ? "full" : matchesAny(hash, cfg.readonly) ? "readonly" : null) : null;

    if (!hash || !keyKind) {
        const limit = await rateLimit("admin:authfail", ip, { windowSeconds: AUTH_FAILURE_WINDOW_SECONDS, max: AUTH_FAILURES_PER_WINDOW, supabase });
        if (!limit.allowed) {
            // Un aviso por IP y hora, no uno por intento
            const alert = await rateLimit("admin:authfail-alert", ip, { windowSeconds: 3600, max: 1, supabase });
            if (alert.allowed) {
                await notifySlack(
                    `🚨 *MCP de admin: intentos con llave inválida*\n• *IP:* ${ip}\n• Más de ${AUTH_FAILURES_PER_WINDOW} en ${AUTH_FAILURE_WINDOW_SECONDS / 60} min: bloqueada temporalmente. ` +
                        "Si no fuiste tú, rota la llave (docs/api/admin.md).",
                );
            }
            return { ok: false, status: 429, error: "Demasiados intentos. Espera unos minutos." };
        }
        return { ok: false, status: 401, error: "Llave de administración inválida." };
    }

    const fingerprint = hash.slice(0, 8);
    const limit = await rateLimit("admin:key", fingerprint, { windowSeconds: 60, max: ADMIN_REQUESTS_PER_MINUTE, supabase });
    if (!limit.allowed) return { ok: false, status: 429, error: `Demasiadas peticiones: máximo ${ADMIN_REQUESTS_PER_MINUTE} por minuto.` };
    return { ok: true, keyKind, fingerprint, ipHash };
}
