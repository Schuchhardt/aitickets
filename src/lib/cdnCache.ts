// Caché de páginas públicas en el CDN de Netlify (plan gratis: las funciones corren en us-east-2 y Supabase
// en sa-east-1, así que cada render cuesta ~1 s; desde el CDN, ~0,1 s).
//
// - cachePublicPage: el CDN guarda la respuesta `sMaxAge` segundos y la sigue sirviendo hasta
//   `staleWhileRevalidate` más mientras la regenera en segundo plano. El navegador siempre revalida.
//   La etiqueta EVENT_PAGES_TAG permite vaciarlas todas de una vez.
// - purgeEventPages: vacía esa etiqueta cuando un productor cambia algo que se ve en la página pública
//   (src/middleware.ts para el panel, src/lib/producer-api/registry.ts para la API/MCP). Así los cambios
//   se ven al instante; el TTL corto solo acota el atraso del stock ("Quedan N cupos"), que la compra
//   valida igual en el servidor.
//
// Solo para respuestas iguales para todos: nunca con sesión, vista previa ni por el proxy de tenants (su
// Host real no forma parte de la clave del CDN).

export const EVENT_PAGES_TAG = "event-pages";
/** Páginas del blog: las vacía netlify/lib/blog/publish.mjs (BLOG_CACHE_TAG) al publicar o actualizar un artículo. */
export const BLOG_PAGES_TAG = "blog-pages";

export function cachePublicPage(
  headers: Headers,
  { sMaxAge, staleWhileRevalidate, tag = EVENT_PAGES_TAG }: { sMaxAge: number; staleWhileRevalidate: number; tag?: string },
) {
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  headers.set("Netlify-CDN-Cache-Control", `public, durable, s-maxage=${sMaxAge}, stale-while-revalidate=${staleWhileRevalidate}`);
  headers.set("Netlify-Cache-Tag", tag);
}

const PURGE_TIMEOUT_MS = 2500;

/**
 * Vacía del CDN las páginas con esas etiquetas. Nunca lanza: si falla, el TTL corto las renueva igual.
 * Fuera de Netlify (astro dev, tests) no hace nada: no hay NETLIFY_PURGE_API_TOKEN ni SITE_ID.
 */
export async function purgeCacheTags(tags: string[]): Promise<void> {
  const token = process.env.NETLIFY_PURGE_API_TOKEN;
  const siteId = process.env.SITE_ID;
  if (!token || !siteId || !tags.length) return;
  try {
    const res = await fetch("https://api.netlify.com/api/v1/purge", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf8", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ site_id: siteId, cache_tags: tags }),
      signal: AbortSignal.timeout(PURGE_TIMEOUT_MS),
    });
    if (!res.ok) console.error(`No se pudo vaciar la caché (${tags.join(", ")}):`, res.status);
  } catch (err: any) {
    console.error(`No se pudo vaciar la caché (${tags.join(", ")}):`, err?.message || err);
  }
}

/** Vacía del CDN las páginas de eventos (y el listado). */
export const purgeEventPages = (): Promise<void> => purgeCacheTags([EVENT_PAGES_TAG]);

/** Páginas de /panoramas (src/lib/panoramas.ts): las vacían las herramientas de eventos externos y de moderación. */
export const PANORAMA_PAGES_TAG = "panorama-pages";
