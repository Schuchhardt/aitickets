// Cookies de la sesión de asistentes (netlify/lib/buyer-session.mjs) en páginas y APIs de Astro.
import type { AstroGlobal } from "astro";
import {
    BUYER_COOKIE,
    BUYER_HINT_COOKIE,
    BUYER_SESSION_DAYS,
    signBuyerSession,
    verifyBuyerSession,
} from "../../netlify/lib/buyer-session.mjs";

type CookieContext = Pick<AstroGlobal, "cookies">;

const BASE = { path: "/", secure: import.meta.env.PROD, sameSite: "lax" as const, maxAge: 60 * 60 * 24 * BUYER_SESSION_DAYS };

/** Email del asistente con sesión iniciada, o null. */
export function getBuyerSession(context: CookieContext): { email: string } | null {
    const token = context.cookies.get(BUYER_COOKIE)?.value;
    return token ? verifyBuyerSession(token) : null;
}

/** Crea la sesión del asistente. false si no se pudo firmar (falta el secreto). */
export function setBuyerSession(context: CookieContext, email: string): boolean {
    const token = signBuyerSession(email);
    if (!token) return false;
    context.cookies.set(BUYER_COOKIE, token, { ...BASE, httpOnly: true });
    context.cookies.set(BUYER_HINT_COOKIE, "1", { ...BASE, httpOnly: false });
    return true;
}

export function clearBuyerSession(context: CookieContext) {
    context.cookies.delete(BUYER_COOKIE, { path: "/" });
    context.cookies.delete(BUYER_HINT_COOKIE, { path: "/" });
}
