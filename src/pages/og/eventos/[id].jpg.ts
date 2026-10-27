// GET /og/eventos/<id>.jpg?v=<versión> → imagen para compartir el evento (1200×630 JPEG < 300 KB).
// La referencian og:image y twitter:image (src/components/EventMetaTags.astro, src/lib/ogImage.ts).
//
// - Versión correcta: se genera desde la portada y se cachea en el CDN de Netlify para siempre
//   (la URL cambia cuando cambia la portada).
// - Versión vieja de un evento publicado: 301 a la versión vigente (links compartidos antes del cambio).
// - Borradores: solo con la versión exacta (no se pueden enumerar portadas de eventos no publicados).
// - Sin portada, evento inexistente o error al procesar: redirección a la portada original o a la imagen
//   genérica de AI Tickets, con caché corta.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { renderOgImage } from "../../../lib/imageOptimize";
import { eventOgImagePath, ogImageVersion } from "../../../lib/ogImage";
import { defaultOgImagePath } from "../../../lib/ogPages";
import { fetchPublic } from "../../../lib/safe-fetch";

export const prerender = false;

// Tarjeta genérica de AI Tickets (estática, generada en el build)
const FALLBACK_IMAGE = defaultOgImagePath();
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

const redirect = (location: string, status = 302, maxAge = 300) =>
  new Response(null, {
    status,
    headers: {
      Location: location,
      "Cache-Control": `public, max-age=${maxAge}`,
      "Netlify-CDN-Cache-Control": `public, max-age=${maxAge}`,
    },
  });

export const GET: APIRoute = async ({ params, url }) => {
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return redirect(FALLBACK_IMAGE);

  const { data: event, error } = await getSupabaseAdmin()
    .from("events")
    .select("id, image_url, status")
    .eq("id", id)
    .maybeSingle();
  if (error) console.error("og/eventos:", error.message);
  const imageUrl: string | null = event?.image_url && /^https:\/\//i.test(event.image_url) ? event.image_url : null;
  if (!event || !imageUrl) return redirect(FALLBACK_IMAGE);

  const published = event.status === "published";
  if (url.searchParams.get("v") !== ogImageVersion(imageUrl)) {
    if (!published) return redirect(FALLBACK_IMAGE);
    return redirect(eventOgImagePath(id, imageUrl)!, 301, 3600);
  }

  let rendered: Buffer | null = null;
  try {
    const { buffer } = await fetchPublic(imageUrl, { maxBytes: MAX_SOURCE_BYTES, accept: "image/*", timeoutMs: 8000 });
    rendered = await renderOgImage(buffer);
  } catch (err: any) {
    console.error("og/eventos: no se pudo descargar la portada:", err?.message || err);
  }
  // Sin sharp o imagen ilegible: la portada original es mejor que nada
  if (!rendered) return redirect(imageUrl, 302, 600);

  return new Response(new Uint8Array(rendered), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(rendered.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      // durable: la caché del CDN se comparte entre regiones (se genera una sola vez por versión)
      "Netlify-CDN-Cache-Control": "public, durable, max-age=31536000, immutable",
      "X-Robots-Tag": "noindex",
    },
  });
};
