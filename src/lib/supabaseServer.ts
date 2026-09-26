import type { AstroGlobal } from 'astro';
import type { User } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "./auth-helpers";

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
}

export function clearSessionCookies(context: CookieContext) {
    context.cookies.delete("sb-access-token", { path: "/" });
    context.cookies.delete("sb-refresh-token", { path: "/" });
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

/**
 * Usuario autenticado + su fila en public.users (con organización y rol).
 * Devuelve null si no hay sesión, no existe el usuario, está inactivo o no tiene organización.
 */
export const getSessionContext = async (context: CookieContext): Promise<SessionContext | null> => {
    const authUser = await getSessionUser(context);
    if (!authUser) return null;

    const { data: dbUser } = await getSupabaseAdmin()
        .from("users")
        .select("id, name, email, organization_id, role, active")
        .eq("auth_user_id", authUser.id)
        .single();

    if (!dbUser || !dbUser.organization_id || dbUser.active === false) return null;
    return { authUser, dbUser: dbUser as DbUser };
}

/** Roles que pueden administrar eventos (crear/editar/publicar). */
export const EVENT_MANAGER_ROLES = ["admin", "producer", "editor"];
/** Roles que pueden administrar el equipo y la organización. */
export const ORG_ADMIN_ROLES = ["admin", "producer"];

export const hasRole = (dbUser: DbUser, roles: string[]) => roles.includes(dbUser.role || "");

/**
 * Carga un evento solo si pertenece a la organización del usuario. Devuelve null si no.
 */
export async function getOwnedEvent<T = any>(eventId: number | string, organizationId: number, columns = "*"): Promise<T | null> {
    const { data } = await getSupabaseAdmin()
        .from("events")
        .select(columns)
        .eq("id", eventId)
        .eq("organization_id", organizationId)
        .single();
    return (data as T) || null;
}

export const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
