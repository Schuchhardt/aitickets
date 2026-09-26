import { defineMiddleware } from "astro:middleware";
import { createEphemeralAuthClient } from "./lib/auth-helpers";
import { setSessionCookies, clearSessionCookies } from "./lib/supabaseServer";

// Rutas que requieren sesión de productor
const PROTECTED_PAGE_PREFIX = "/dashboard";

/** Decodifica el `exp` del JWT sin verificarlo (la verificación la hace getSessionUser). */
function tokenExpiresSoon(token: string, marginSeconds = 60): boolean {
    try {
        const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
        return typeof payload.exp !== "number" || payload.exp * 1000 < Date.now() + marginSeconds * 1000;
    } catch {
        return true;
    }
}

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Host de la petición (considera proxies de Netlify). */
function requestHost(request: Request, url: URL): string {
    return (request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host).split(",")[0].trim().toLowerCase();
}

/**
 * Protección CSRF para las APIs de Astro que usan la cookie de sesión:
 * - Si viene Origin, su host debe coincidir con el host de la petición.
 * - Si no viene Origin, se acepta solo si Sec-Fetch-Site es same-origin/none o no viene (clientes no navegador).
 * Las Netlify Functions (/api/* redirigidas en netlify.toml) no pasan por este middleware.
 */
function isCrossSiteRequest(request: Request, url: URL): boolean {
    const origin = request.headers.get("origin");
    if (origin) {
        if (origin === "null") return true;
        try {
            return new URL(origin).host.toLowerCase() !== requestHost(request, url);
        } catch {
            return true;
        }
    }
    const fetchSite = request.headers.get("sec-fetch-site");
    return !!fetchSite && fetchSite !== "same-origin" && fetchSite !== "none";
}

export const onRequest = defineMiddleware(async (context, next) => {
    const { pathname } = context.url;
    const isDashboard = pathname === PROTECTED_PAGE_PREFIX || pathname.startsWith(`${PROTECTED_PAGE_PREFIX}/`);
    const isApi = pathname.startsWith("/api/");
    const isQrValidator = pathname.startsWith("/qr/");

    if (isApi && STATE_CHANGING_METHODS.has(context.request.method.toUpperCase()) && isCrossSiteRequest(context.request, context.url)) {
        return new Response(JSON.stringify({ error: "Origen no permitido" }), {
            status: 403,
            headers: { "Content-Type": "application/json", "X-Robots-Tag": "noindex, nofollow" },
        });
    }

    if (isDashboard || isApi || isQrValidator) {
        const accessToken = context.cookies.get("sb-access-token")?.value;
        const refreshToken = context.cookies.get("sb-refresh-token")?.value;

        // Refrescar la sesión si el access token venció (dura 1 hora) para que el productor no pierda la sesión
        if (refreshToken && (!accessToken || tokenExpiresSoon(accessToken))) {
            const { data, error } = await createEphemeralAuthClient().auth.refreshSession({ refresh_token: refreshToken });
            if (data?.session && !error) {
                setSessionCookies(context, data.session.access_token, data.session.refresh_token);
            } else {
                clearSessionCookies(context);
            }
        }

        if (isDashboard && !context.cookies.get("sb-access-token")?.value) {
            return context.redirect("/organizadores/login");
        }
    }

    const response = await next();

    // Nada del dashboard ni de las APIs debe indexarse
    if (isDashboard || isApi || isQrValidator) {
        response.headers.set("X-Robots-Tag", "noindex, nofollow");
    }
    return response;
});
