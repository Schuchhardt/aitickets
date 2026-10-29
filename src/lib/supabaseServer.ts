import type { AstroGlobal } from 'astro';
import type { User } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "./auth-helpers";
import { canAccessEventByStaff } from "../../netlify/lib/event-staff.mjs";
import { PRODUCER_HINT_COOKIE } from "../../netlify/lib/buyer-session.mjs";

type CookieContext = Pick<AstroGlobal, 'cookies'>;

export const SESSION_COOKIE_OPTIONS = {
    path: "/",
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 30, // 1 mes
};

export function setSessionCookies(context: CookieContext, accessToken: string, refreshToken: string) {
    context.cookies.set("sb-access-token", accessToken, SESSION_COOKIE_OPTIONS);
    context.cookies.set("sb-refresh-token", refreshToken, SESSION_COOKIE_OPTIONS);
    setProducerHint(context);
}

/**
 * Pista sin datos (legible por JS) de que hay una sesión de productor: la portada y las páginas estáticas la
 * miran para mostrar "Ir a mi panel" sin llamar a /api/auth/session en cada visita anónima.
 */
export function setProducerHint(context: CookieContext) {
    context.cookies.set(PRODUCER_HINT_COOKIE, "1", { ...SESSION_COOKIE_OPTIONS, httpOnly: false });
}

/**
 * Registra un inicio de sesión en public.users (last_access_at + login_count). Llamar en cada ruta que
 * crea una sesión nueva (contraseña, Google, magic link, verificación, invitación), no en los refrescos.
 * Best effort: nunca bloquea el ingreso.
 */
export async function recordLogin(match: { id: number } | { auth_user_id: string } | { email: string }) {
    try {
        const [column, value] = Object.entries(match)[0];
        const admin = getSupabaseAdmin();
        const { data: row } = await admin.from("users").select("id, login_count").eq(column, value).maybeSingle();
        if (!row) return;
        await admin
            .from("users")
            .update({ last_access_at: new Date().toISOString(), login_count: (row.login_count || 0) + 1 })
            .eq("id", row.id);
    } catch (err: any) {
        console.warn("recordLogin:", err?.message || err);
    }
}

export function clearSessionCookies(context: CookieContext) {
    context.cookies.delete("sb-access-token", { path: "/" });
    context.cookies.delete("sb-refresh-token", { path: "/" });
    context.cookies.delete(PRODUCER_HINT_COOKIE, { path: "/" });
}

/**
 * Valida el JWT de la cookie contra Supabase Auth (con la service role) y devuelve el usuario de auth.
 * El middleware (src/middleware.ts) ya refrescó el token si estaba vencido.
 */
export const getSessionUser = async (context: CookieContext): Promise<User | null> => {
    const accessToken = context.cookies.get("sb-access-token")?.value;
    if (!accessToken) return null;

    const { data: { user }, error } = await getSupabaseAdmin().auth.getUser(accessToken);
    if (error || !user) return null;
    return user;
}

export type DbUser = {
    id: number;
    name: string | null;
    email: string | null;
    organization_id: number;
    role: string | null;
    active: boolean | null;
};

export type SessionContext = { authUser: User; dbUser: DbUser };

// Organizaciones ya verificadas en este proceso: la verificación nunca se revierte, así que se
// evita repetir la consulta en cada petición.
const verifiedOrgCache = new Set<number>();

/**
 * ¿La organización puede usar el panel? Exige organizations.email_verified_at (WP7) en TODA sesión,
 * no solo en /api/auth/login: el proyecto Supabase es compartido y no se puede depender de su
 * configuración "Confirm email" (alguien podría obtener tokens directo contra Supabase Auth con la
 * anon key de otra app y ponerlos como cookies).
 * - Columna inexistente (preview sin migrar) o error de lectura: se permite, igual que en login.
 * - Cuentas antiguas (sin aceptación de términos) ya confirmadas en Auth: se marcan verificadas.
 */
async function isOrgEmailVerified(orgId: number, authUser: User): Promise<boolean> {
    if (verifiedOrgCache.has(orgId)) return true;
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
        .from("organizations")
        .select("id, email_verified_at, terms_accepted_at")
        .eq("id", orgId)
        .maybeSingle();
    if (error) {
        const missingColumn = error.code === "42703" || /email_verified_at|terms_accepted_at/.test(error.message || "");
        if (!missingColumn) console.error("getSessionContext: error leyendo verificación de la organización", error.message);
        return true;
    }
    if (!data) return false;
    if (data.email_verified_at) {
        verifiedOrgCache.add(orgId);
        return true;
    }
    if (!data.terms_accepted_at && authUser.email_confirmed_at) {
        await admin
            .from("organizations")
            .update({ email_verified_at: new Date().toISOString() })
            .eq("id", orgId)
            .is("email_verified_at", null);
        verifiedOrgCache.add(orgId);
        return true;
    }
    return false;
}

/**
 * Usuario autenticado + su fila en public.users (con organización y rol).
 * Devuelve null si no hay sesión, no existe el usuario, está inactivo, no tiene organización o la
 * organización no ha verificado su correo.
 */
export const getSessionContext = async (context: CookieContext): Promise<SessionContext | null> => {
    const accessToken = context.cookies.get("sb-access-token")?.value;
    const cached = accessToken ? readCachedSession(accessToken) : null;
    if (cached) return cached;

    const authUser = await getSessionUser(context);
    if (!authUser) return null;

    const { data: dbUser } = await getSupabaseAdmin()
        .from("users")
        .select("id, name, email, organization_id, role, active")
        .eq("auth_user_id", authUser.id)
        .single();

    if (!dbUser || !dbUser.organization_id || dbUser.active === false) return null;
    if (!(await isOrgEmailVerified(Number(dbUser.organization_id), authUser))) return null;
    const session = { authUser, dbUser: dbUser as DbUser };
    if (accessToken) cacheSession(accessToken, session);
    return session;
}

// Sesiones ya validadas en este proceso, por access token. Cada página del panel y cada llamada a /api pedía
// a Supabase Auth el usuario (una ida y vuelta de red) y luego su fila en public.users: con esto, al navegar
// entre secciones se valida una vez cada SESSION_CACHE_MS. Solo se guardan sesiones válidas; un cambio de rol
// o una desactivación tarda como máximo eso en notarse. El token vence solo (1 h) y al refrescarlo cambia la llave.
const SESSION_CACHE_MS = 30_000;
const SESSION_CACHE_MAX = 500;
const sessionCache = new Map<string, { session: SessionContext; expiresAt: number }>();

function readCachedSession(accessToken: string): SessionContext | null {
    const hit = sessionCache.get(accessToken);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
        sessionCache.delete(accessToken);
        return null;
    }
    return hit.session;
}

function cacheSession(accessToken: string, session: SessionContext) {
    if (sessionCache.size >= SESSION_CACHE_MAX) {
        const oldest = sessionCache.keys().next().value;
        if (oldest !== undefined) sessionCache.delete(oldest);
    }
    sessionCache.set(accessToken, { session, expiresAt: Date.now() + SESSION_CACHE_MS });
}

/** Olvida la sesión de este token (logout): que no siga valiendo desde la caché. */
export function forgetCachedSession(accessToken: string | null | undefined) {
    if (accessToken) sessionCache.delete(accessToken);
}

/** Olvida las sesiones de un usuario (cambió su nombre, rol o estado) para que la próxima página lo lea de nuevo. */
export function forgetCachedSessionsOfUser(userId: number | string | null | undefined) {
    if (userId == null) return;
    for (const [token, entry] of sessionCache) {
        if (Number(entry.session.dbUser.id) === Number(userId)) sessionCache.delete(token);
    }
}

/** Roles que pueden administrar eventos (crear/editar/publicar). */
export const EVENT_MANAGER_ROLES = ["admin", "producer", "editor"];
/** Roles que pueden administrar el equipo y la organización. */
export const ORG_ADMIN_ROLES = ["admin", "producer"];

export const hasRole = (dbUser: DbUser, roles: string[]) => roles.includes(dbUser.role || "");

/**
 * Carga un evento solo si pertenece a la organización del usuario. Devuelve null si no.
 * Con userId, además exige que el usuario tenga acceso a ese evento (aitickets_event_staff: equipo asignado
 * a ciertos eventos). Las rutas del panel deben pasarlo siempre.
 */
export async function getOwnedEvent<T = any>(eventId: number | string, organizationId: number, columns = "*", userId: number | null = null): Promise<T | null> {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
        .from("events")
        .select(columns)
        .eq("id", eventId)
        .eq("organization_id", organizationId)
        .single();
    if (!data) return null;
    if (userId != null && !(await canAccessEventByStaff(supabase, userId, eventId))) return null;
    return (data as T) || null;
}

export const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
