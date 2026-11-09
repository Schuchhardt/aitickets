// RSS del blog (últimos 30 artículos): lo leen agregadores y ayuda a que los buscadores descubran lo nuevo rápido.
import type { APIRoute } from "astro";
import { listPublishedPosts } from "../../lib/blog";
import { BLOG_PAGES_TAG, cachePublicPage } from "../../lib/cdnCache";

export const prerender = false;

const SITE_URL = (import.meta.env.SITE_URL || "https://aitickets.cl").replace(/\/$/, "");
const esc = (v: unknown) =>
    String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

export const GET: APIRoute = async () => {
    const posts = await listPublishedPosts({ limit: 30 });
    const items = posts
        .map((p) =>
            [
                "    <item>",
                `      <title>${esc(p.title)}</title>`,
                `      <link>${SITE_URL}/blog/${p.slug}</link>`,
                `      <guid isPermaLink="true">${SITE_URL}/blog/${p.slug}</guid>`,
                p.published_at ? `      <pubDate>${new Date(p.published_at).toUTCString()}</pubDate>` : "",
                `      <description>${esc(p.excerpt || p.description)}</description>`,
                "    </item>",
            ]
                .filter(Boolean)
                .join("\n"),
        )
        .join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Blog de AI Tickets para productores</title>
    <link>${SITE_URL}/blog</link>
    <atom:link href="${SITE_URL}/blog/rss.xml" rel="self" type="application/rss+xml" />
    <description>Cómo producir, difundir y llenar tus eventos en Chile.</description>
    <language>es-cl</language>
${items}
  </channel>
</rss>
`;
    const headers = new Headers({ "Content-Type": "application/rss+xml; charset=utf-8" });
    cachePublicPage(headers, { sMaxAge: 1800, staleWhileRevalidate: 86400, tag: BLOG_PAGES_TAG });
    return new Response(xml, { status: 200, headers });
};
