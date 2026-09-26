import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../lib/auth-helpers";

export const prerender = false;

const SITE_URL = (import.meta.env.SITE_URL || "https://aitickets.cl").replace(/\/$/, "");

const STATIC_PAGES: { path: string; changefreq: string; priority: string }[] = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/eventos", changefreq: "daily", priority: "0.9" },
  { path: "/organizadores", changefreq: "weekly", priority: "0.9" },
  { path: "/organizadores/registro", changefreq: "monthly", priority: "0.7" },
  { path: "/presentacion", changefreq: "monthly", priority: "0.5" },
  { path: "/privacy", changefreq: "yearly", priority: "0.2" },
  { path: "/terms", changefreq: "yearly", priority: "0.2" },
];

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const urlEntry = (loc: string, opts: { lastmod?: string | null; changefreq?: string; priority?: string } = {}) =>
  [
    "  <url>",
    `    <loc>${escapeXml(loc)}</loc>`,
    opts.lastmod ? `    <lastmod>${opts.lastmod}</lastmod>` : "",
    opts.changefreq ? `    <changefreq>${opts.changefreq}</changefreq>` : "",
    opts.priority ? `    <priority>${opts.priority}</priority>` : "",
    "  </url>",
  ]
    .filter(Boolean)
    .join("\n");

export const GET: APIRoute = async () => {
  const entries = STATIC_PAGES.map((p) =>
    urlEntry(`${SITE_URL}${p.path}`, { changefreq: p.changefreq, priority: p.priority })
  );

  try {
    const supabase = getSupabaseAdmin();
    const now = new Date();
    // "Hoy" en Chile continental (en-CA formatea YYYY-MM-DD), no en UTC
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now);

    // Eventos publicados, públicos y próximos (C3). Columnas explícitas (C4).
    const { data: events, error } = await supabase
      .from("events")
      .select("id, slug, created_at, end_date")
      .eq("status", "published")
      .or("accessibility.is.null,accessibility.eq.public")
      .not("slug", "is", null);

    if (error) throw error;

    const ids = (events || []).map((e) => e.id);
    const lastDateByEvent = new Map<number, string>();
    if (ids.length) {
      const { data: dates } = await supabase
        .from("event_dates")
        .select("event_id, date")
        .in("event_id", ids);
      for (const d of dates || []) {
        const date = String(d.date).slice(0, 10);
        const prev = lastDateByEvent.get(d.event_id);
        if (!prev || date > prev) lastDateByEvent.set(d.event_id, date);
      }
    }

    for (const e of events || []) {
      const lastDate = lastDateByEvent.get(e.id);
      const upcoming = !e.end_date || new Date(e.end_date) >= now || (lastDate !== undefined && lastDate >= today);
      if (!upcoming) continue;
      entries.push(
        urlEntry(`${SITE_URL}/eventos/${encodeURIComponent(e.slug)}`, {
          lastmod: e.created_at ? new Date(e.created_at).toISOString() : null,
          changefreq: "daily",
          priority: "0.8",
        })
      );
    }
  } catch (err) {
    console.error("Error generando sitemap:", err);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>
`;

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
};
