// /og/paginas/<clave>.jpg → imagen para compartir de una página pública (1200×630 JPEG < 300 KB).
// Se generan todas en el build (prerender): quedan como archivos estáticos en el CDN, sin función ni satori en
// producción. Textos y fotos en src/lib/ogPages.ts, render en src/lib/ogCard.ts. Las referencia Layout.astro con
// ?v=<hash del contenido> (la query no cambia el archivo servido, solo la clave de caché de cada red social).
import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";
import { renderOgCard } from "../../../lib/ogCard";
import { guideOgCard, ogPageKey, staticOgCards, type OgCard } from "../../../lib/ogPages";

export const prerender = true;

export const getStaticPaths = (async () => {
  const guides = await getCollection("guias");
  const cards: Record<string, OgCard> = {
    ...staticOgCards(),
    ...Object.fromEntries(guides.map((g) => [ogPageKey(`/guias/${g.id}`), guideOgCard(g)])),
  };
  return Object.entries(cards).map(([page, card]) => ({ params: { page }, props: { card } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const jpg = await renderOgCard((props as { card: OgCard }).card);
  return new Response(new Uint8Array(jpg), { headers: { "Content-Type": "image/jpeg" } });
};
