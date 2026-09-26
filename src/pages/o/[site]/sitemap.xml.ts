import type { APIRoute } from "astro";
import { getSiteBySlug, getSiteEvents, siteUrl, type SiteRecord } from "../../../lib/sites";

export const prerender = false;

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// Sitemap del sitio del productor, en su origen canónico. Solo incluye las URLs propias del sitio
// (inicio y contacto): las páginas de evento tienen canónico en aitickets.cl/eventos/<slug> y ya
// están en el sitemap principal. Vacío mientras el sitio no tenga eventos publicados (noindex).
export const GET: APIRoute = async ({ params, locals }) => {
  const slug = String(params.site || "").toLowerCase();
  const local = locals.site as SiteRecord | null | undefined;
  const site = local && local.slug === slug ? local : await getSiteBySlug(slug);
  if (!site) return new Response("Not found", { status: 404 });

  const urls: string[] = [];
  if (!site.is_demo) {
    const events = await getSiteEvents(site, 1);
    if (events.length > 0) {
      urls.push(siteUrl(site, "/"));
      if (site.contact_form_enabled) urls.push(siteUrl(site, "/contacto"));
    }
  }

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${xmlEscape(u)}</loc></url>`).join("\n") +
    `\n</urlset>\n`;
  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=600" },
  });
};
