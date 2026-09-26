import type { APIRoute } from "astro";
import { getSiteBySlug, siteCanonicalOrigin, type SiteRecord } from "../../../lib/sites";

export const prerender = false;

// robots.txt de un sitio de productor servido en su dominio propio (el middleware reescribe
// /robots.txt a esta ruta; la Edge Function evita que gane el public/robots.txt estático).
export const GET: APIRoute = async ({ params, locals }) => {
  const slug = String(params.site || "").toLowerCase();
  const local = locals.site as SiteRecord | null | undefined;
  const site = local && local.slug === slug ? local : await getSiteBySlug(slug);
  if (!site) return new Response("Not found", { status: 404 });

  const lines = site.is_demo
    ? ["User-agent: *", "Disallow: /"]
    : ["User-agent: *", "Allow: /", "Disallow: /api/", "", `Sitemap: ${siteCanonicalOrigin(site)}/sitemap.xml`];
  return new Response(`${lines.join("\n")}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
};
