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

export function cachePublicPage(headers: Headers, { sMaxAge, staleWhileRevalidate }: { sMaxAge: number; staleWhileRevalidate: number }) {
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  headers.set("Netlify-CDN-Cache-Control", `public, durable, s-maxage=${sMaxAge}, stale-while-revalidate=${staleWhileRevalidate}`);
  headers.set("Netlify-Cache-Tag", EVENT_PAGES_TAG);
}

const PURGE_TIMEOUT_MS = 2500;

/**
 * Vacía del CDN las páginas de eventos (y el listado). Nunca lanza: si falla, el TTL corto las renueva igual.
 * Fuera de Netlify (astro dev, tests) no hace nada: no hay NETLIFY_PURGE_API_TOKEN ni SITE_ID.
 */
export async function purgeEventPages(): Promise<void> {
  const token = process.env.NETLIFY_PURGE_API_TOKEN;
  const siteId = process.env.SITE_ID;
  if (!token || !siteId) return;
  try {
    const res = await fetch("https://api.netlify.com/api/v1/purge", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf8", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ site_id: siteId, cache_tags: [EVENT_PAGES_TAG] }),
      signal: AbortSignal.timeout(PURGE_TIMEOUT_MS),
    });
    if (!res.ok) console.error("No se pudo vaciar la caché de eventos:", res.status);
  } catch (err: any) {
    console.error("No se pudo vaciar la caché de eventos:", err?.message || err);
  }
}
