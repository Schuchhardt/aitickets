import { defineMiddleware } from "astro:middleware";
import { createEphemeralAuthClient } from "./lib/auth-helpers";
import { setSessionCookies, clearSessionCookies } from "./lib/supabaseServer";
import {
    getSiteBySlug,
    getTrustedTenantProxy,
    isMainHost,
    mainOrigin,
    normalizeHost,
    resolveSiteByHost,
    type SiteRecord,
} from "./lib/sites";

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

/**
 * Host real de la petición: el Host que fija la plataforma (Netlify lo toma de la conexión/SNI; el adapter
 * arma context.url con ese mismo host). Nunca X-Forwarded-Host: lo puede mandar el cliente, y confiar en él
 * permitiría que una URL de aitickets.cl se resolviera como el tenant que el atacante elija (y que el CDN
 * guardara esa respuesta bajo la URL de aitickets.cl). El único host "reenviado" válido es el del proxy de
 * tenants firmado con TENANT_PROXY_SECRET (getTrustedTenantProxy).
 */
function rawRequestHost(request: Request, url: URL): string {
    return (request.headers.get("host") || url.host).split(",")[0].trim().toLowerCase();
}

/**
 * Host efectivo: el X-Tenant-Host del proxy de tenants solo si trae el secreto correcto
 * (TENANT_PROXY_SECRET, comparado en tiempo constante); si no, el Host real.
 */
function requestHost(request: Request, url: URL): string {
    const proxied = getTrustedTenantProxy(request);
    return proxied ? proxied.host : rawRequestHost(request, url);
}

/**
 * Protección CSRF para las APIs de Astro que usan la cookie de sesión:
 * - Si viene Origin, su host debe coincidir con el host (efectivo) de la petición.
 * - Si no viene Origin, se acepta solo si Sec-Fetch-Site es same-origin/none o no viene (clientes no navegador).
 * Las Netlify Functions (/api/* redirigidas en netlify.toml) no pasan por este middleware.
 */
function isCrossSiteRequest(request: Request, url: URL): boolean {
    const origin = request.headers.get("origin");
    if (origin) {
        if (origin === "null") return true;
        try {
            return normalizeHost(new URL(origin).host) !== normalizeHost(requestHost(request, url));
        } catch {
            return true;
        }
    }
    const fetchSite = request.headers.get("sec-fetch-site");
    return !!fetchSite && fetchSite !== "same-origin" && fetchSite !== "none";
}

// ---------------------------------------------------------------------------
// Sitios de productor en su propio host (dominio propio o <slug>.aitickets.cl)
// ---------------------------------------------------------------------------

/** Prefijo que agrega la Edge Function netlify/tenant-router/tenant-router.ts para saltarse los estáticos. */
const EDGE_TENANT_PREFIX = "/o/_host";

/** En un host de tenant estas rutas viven en aitickets.cl. */
const MAIN_ONLY_PREFIXES = ["/dashboard", "/organizadores", "/auth", "/api/auth", "/qr", "/order", "/ticket", "/payment-confirmation", "/pago"];

/** APIs de Astro permitidas en un host de tenant. */
const TENANT_API_ALLOWLIST = new Set(["/api/sites/contact"]);

const matchesPrefix = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

const notFoundResponse = (json = false) =>
    json
        ? new Response(JSON.stringify({ error: "No encontrado" }), {
              status: 404,
              headers: { "Content-Type": "application/json", "X-Robots-Tag": "noindex, nofollow" },
          })
        : new Response(
              '<!doctype html><html lang="es-CL"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Página no encontrada</title></head>' +
                  '<body style="font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f9fafb;color:#111827">' +
                  '<main style="text-align:center;padding:24px"><h1 style="font-size:1.5rem">Página no encontrada</h1>' +
                  '<p>El sitio o la página que buscas no existe.</p><p><a href="https://aitickets.cl" style="color:#4d7c0f">Ir a AI Tickets</a></p></main></body></html>',
              { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" } }
          );

/**
 * Ruta interna (/o/<slug>/...) para una ruta pública del tenant, o null si no está permitida.
 * Permitidas: /, /eventos/<slug>, /contacto, /sitemap.xml, /robots.txt.
 */
function tenantRewritePath(slug: string, pathname: string): string | null {
    const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
    if (path === "/" || path === "") return `/o/${slug}`;
    if (path === "/contacto") return `/o/${slug}/contacto`;
    if (path === "/sitemap.xml") return `/o/${slug}/sitemap.xml`;
    if (path === "/robots.txt") return `/o/${slug}/robots.txt`;
    const eventMatch = /^\/eventos\/([^/]+)$/.exec(path);
    if (eventMatch) return `/o/${slug}/eventos/${eventMatch[1]}`;
    return null;
}

export const onRequest = defineMiddleware(async (context, next) => {
    // Páginas prerenderizadas (build): no hay headers ni host real. En producción los dominios propios
    // nunca llegan a ellas (la Edge Function tenant-router reescribe antes a /o/_host/*).
    if (context.isPrerendered) return next();

    const { request, url } = context;
    const effectiveHost = normalizeHost(requestHost(request, url));
    context.locals.effectiveHost = effectiveHost;
    context.locals.site = null;

    // ----- Resolución del tenant -----
    let tenantSite: SiteRecord | null = null;
    let isTenantHost = false;
    if (!isMainHost(effectiveHost)) {
        isTenantHost = true;
        tenantSite = await resolveSiteByHost(effectiveHost);
    } else if (import.meta.env.DEV) {
        // Solo en desarrollo: ?__site=<slug> simula un host de tenant
        const simulated = url.searchParams.get("__site");
        if (simulated) {
            isTenantHost = true;
            tenantSite = await getSiteBySlug(simulated, { includeUnpublished: true });
        }
    }

    if (isTenantHost) {
        // Nunca se refrescan ni se escriben cookies de sesión en un host de tenant.
        let pathname = url.pathname;
        if (matchesPrefix(pathname, EDGE_TENANT_PREFIX)) pathname = pathname.slice(EDGE_TENANT_PREFIX.length) || "/";

        // Rutas de la app principal => aitickets.cl (también si el host es desconocido)
        if (MAIN_ONLY_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) {
            const search = new URLSearchParams(url.search);
            search.delete("__site");
            const qs = search.toString();
            return context.redirect(`${mainOrigin()}${pathname}${qs ? `?${qs}` : ""}`, 302);
        }

        if (!tenantSite) return notFoundResponse(pathname.startsWith("/api/"));
        context.locals.site = tenantSite;

        if (pathname.startsWith("/api/")) {
            if (!TENANT_API_ALLOWLIST.has(pathname)) return notFoundResponse(true);
            if (STATE_CHANGING_METHODS.has(request.method.toUpperCase()) && isCrossSiteRequest(request, url)) {
                return new Response(JSON.stringify({ error: "Origen no permitido" }), {
                    status: 403,
                    headers: { "Content-Type": "application/json", "X-Robots-Tag": "noindex, nofollow" },
                });
            }
            const response = await next();
            response.headers.set("X-Robots-Tag", "noindex, nofollow");
            return response;
        }

        // Rutas internas ya reescritas (o accedidas directo) del mismo sitio
        if (matchesPrefix(pathname, `/o/${tenantSite.slug}`)) return next();

        const target = tenantRewritePath(tenantSite.slug, pathname);
        if (!target) return notFoundResponse();
        const rewriteUrl = new URL(url);
        rewriteUrl.pathname = target;
        return context.rewrite(rewriteUrl);
    }

    // ----- Host principal (aitickets.cl): lógica existente -----
    const { pathname } = url;
    const isDashboard = pathname === PROTECTED_PAGE_PREFIX || pathname.startsWith(`${PROTECTED_PAGE_PREFIX}/`);
    const isApi = pathname.startsWith("/api/");
    const isQrValidator = pathname.startsWith("/qr/");
    // /o/<slug>: la vista previa de un sitio no publicado necesita la sesión del dueño vigente
    const isSitePreviewable = pathname.startsWith("/o/");

    if (isApi && STATE_CHANGING_METHODS.has(request.method.toUpperCase()) && isCrossSiteRequest(request, url)) {
        return new Response(JSON.stringify({ error: "Origen no permitido" }), {
            status: 403,
            headers: { "Content-Type": "application/json", "X-Robots-Tag": "noindex, nofollow" },
        });
    }

    if (isDashboard || isApi || isQrValidator || isSitePreviewable) {
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
