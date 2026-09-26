// Edge Function: sitios de productor en dominio propio (alias de dominio del mismo sitio de Netlify).
//
// Problema que resuelve: en un dominio propio, "/" y "/robots.txt" los serviría el CDN como archivos
// estáticos de aitickets.cl (index.astro es prerender y public/robots.txt es estático) sin pasar por
// el SSR. Esta función corre antes que los estáticos y, SOLO para hosts que no son de AI Tickets,
// reescribe la ruta a /o/_host/<ruta>, que siempre llega al SSR. Ahí src/middleware.ts resuelve el
// sitio por el Host (dominio con domain_status='active'), valida la ruta (allowlist) y la reescribe
// a /o/<slug>/...; un host desconocido responde 404.
//
// En aitickets.cl, www, localhost y *.netlify.app no hace nada (una comparación de strings).
// La configuración va inline (export const config).
//
// IMPORTANTE: este archivo NO vive en netlify/edge-functions/ a propósito. Con cualquier archivo en esa
// carpeta, `astro dev` (emulación de Edge Functions del adapter de Netlify) intenta levantar Deno y las
// peticiones locales quedan colgadas. Por eso se publica con la Frameworks API de Netlify:
// netlify/tenant-router/emit.mjs lo copia a .netlify/v1/edge-functions/ después de `astro build`
// (el servidor de desarrollo no mira esa carpeta). Sin ese paso, los dominios propios funcionan igual
// salvo "/" y "/robots.txt", que mostrarían los archivos estáticos de aitickets.cl.

declare const Netlify: { env: { get(name: string): string | undefined } } | undefined;

const EDGE_TENANT_PREFIX = "/o/_host";

function envGet(name: string): string {
  try {
    return (typeof Netlify !== "undefined" && Netlify?.env?.get(name)) || "";
  } catch {
    return "";
  }
}

function isMainHost(host: string): boolean {
  const root = (envGet("SITES_ROOT_DOMAIN") || "aitickets.cl").toLowerCase();
  if (!host) return true;
  if (host === root || host === `www.${root}` || host === "aitickets.cl" || host === "www.aitickets.cl") return true;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "0.0.0.0") return true;
  if (host.endsWith(".netlify.app") || host.endsWith(".netlify.live")) return true;
  const siteUrl = envGet("SITE_URL") || envGet("URL");
  if (siteUrl) {
    try {
      if (new URL(siteUrl).hostname.toLowerCase() === host) return true;
    } catch {
      /* URL inválida */
    }
  }
  return envGet("MAIN_HOSTS")
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/:\d+$/, ""))
    .filter(Boolean)
    .includes(host);
}

// Archivos que nunca se reescriben (además de config.excludedPath)
const PASSTHROUGH_RE = /^\/(?:_astro\/|\.netlify\/|api\/|_image|favicon|apple-touch-icon|android-chrome|site\.webmanifest|videos\/)/;

export default async function tenantRouter(request: Request): Promise<URL | undefined> {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isMainHost(host)) return undefined; // sigue el flujo normal

  const path = url.pathname;
  if (path === EDGE_TENANT_PREFIX || path.startsWith(`${EDGE_TENANT_PREFIX}/`)) return undefined; // ya reescrita
  if (PASSTHROUGH_RE.test(path)) return undefined;

  // Reescritura interna (misma petición, mismo Host): el SSR decide qué servir
  return new URL(`${EDGE_TENANT_PREFIX}${path === "/" ? "" : path}${url.search}`, url);
}

export const config = {
  path: "/*",
  excludedPath: [
    "/_astro/*",
    "/.netlify/*",
    "/api/*",
    "/*.css",
    "/*.js",
    "/*.map",
    "/*.png",
    "/*.jpg",
    "/*.jpeg",
    "/*.webp",
    "/*.avif",
    "/*.gif",
    "/*.svg",
    "/*.ico",
    "/*.mp4",
    "/*.woff",
    "/*.woff2",
    "/*.webmanifest",
  ],
};
