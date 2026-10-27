// GET /og/sitios/<slug>.jpg?v=<versión> → imagen para compartir el sitio de un productor (1200×630 JPEG < 300 KB).
// La referencia src/components/sites/SiteMetaTags.astro. Misma lógica que /og/eventos/<id>.jpg:
//
// - Versión correcta: se genera desde la foto del sitio (siteShareImageSource) y se cachea en el CDN para siempre.
// - Versión vieja: 301 a la vigente (solo sitios públicos: getSiteBySlug no devuelve los no publicados).
// - Sin foto, sitio inexistente o error al procesar: la foto original o la tarjeta genérica, con caché corta.
import type { APIRoute } from "astro";
import { renderOgImage } from "../../../lib/imageOptimize";
import { ogImageVersion, siteOgImagePath } from "../../../lib/ogImage";
import { defaultOgImagePath } from "../../../lib/ogPages";
import { fetchPublic } from "../../../lib/safe-fetch";
import { getSiteBySlug, siteShareImageSource } from "../../../lib/sites";

export const prerender = false;

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
  const slug = String(params.slug || "").toLowerCase();
  const site = await getSiteBySlug(slug);
  const imageUrl = site ? await siteShareImageSource(site) : null;
  if (!site || !imageUrl || !/^https:\/\//i.test(imageUrl)) return redirect(defaultOgImagePath());

  if (url.searchParams.get("v") !== ogImageVersion(imageUrl)) {
    return redirect(siteOgImagePath(site.slug, imageUrl)!, 301, 3600);
  }

  let rendered: Buffer | null = null;
  try {
    const { buffer } = await fetchPublic(imageUrl, { maxBytes: MAX_SOURCE_BYTES, accept: "image/*", timeoutMs: 8000 });
    rendered = await renderOgImage(buffer);
  } catch (err: any) {
    console.error("og/sitios: no se pudo descargar la foto:", err?.message || err);
  }
  if (!rendered) return redirect(imageUrl, 302, 600);

  return new Response(new Uint8Array(rendered), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(rendered.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Netlify-CDN-Cache-Control": "public, durable, max-age=31536000, immutable",
      "X-Robots-Tag": "noindex",
    },
  });
};
