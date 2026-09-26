import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../lib/auth-helpers";
import { indexableComparisonSlugs } from "../data/comparisons";

export const prerender = false;

const SITE_URL = (import.meta.env.SITE_URL || "https://aitickets.cl").replace(/\/$/, "");

const STATIC_PAGES: { path: string; changefreq: string; priority: string }[] = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/eventos", changefreq: "daily", priority: "0.9" },
  { path: "/organizadores", changefreq: "weekly", priority: "0.9" },
  { path: "/organizadores/registro", changefreq: "monthly", priority: "0.7" },
  { path: "/precios", changefreq: "monthly", priority: "0.8" },
  { path: "/web-gratis", changefreq: "monthly", priority: "0.7" },
  { path: "/bot", changefreq: "yearly", priority: "0.2" },
  { path: "/presentacion", changefreq: "monthly", priority: "0.5" },
  { path: "/privacy", changefreq: "yearly", priority: "0.2" },
  { path: "/terms", changefreq: "yearly", priority: "0.2" },
  { path: "/terminos-productores", changefreq: "yearly", priority: "0.2" },
  // Comparaciones: solo las que tienen todos sus datos verificados con fuente y fecha (las demás son noindex)
  ...indexableComparisonSlugs().map((slug) => ({ path: `/comparar/${slug}`, changefreq: "monthly", priority: "0.5" })),
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

async function producerSiteEntries(orgsWithUpcoming: Set<number>): Promise<string[]> {
  if (!orgsWithUpcoming.size) return [];
  try {
    const supabase = getSupabaseAdmin();
    const orgIds = [...orgsWithUpcoming];
    const { data: sites, error } = await supabase
      .from("aitickets_sites")
      .select("organization_id, slug, custom_domain, domain_status, updated_at")
      .eq("published", true)
      .in("organization_id", orgIds);
    if (error) return []; // tabla inexistente (preview sin migrar) u otro error: sin webs en el sitemap
    const candidates = (sites || []).filter((s) => !(s.custom_domain && s.domain_status === "active"));
    if (!candidates.length) return [];

    // Organizaciones verificadas (si la columna aún no existe, se consideran verificadas)
    let verified: Set<number> | null = null;
    const { data: orgs, error: orgError } = await supabase
      .from("organizations")
      .select("id, email_verified_at")
      .in("id", candidates.map((s) => s.organization_id));
    if (!orgError) verified = new Set((orgs || []).filter((o) => o.email_verified_at).map((o) => Number(o.id)));

    return candidates
      .filter((s) => !verified || verified.has(Number(s.organization_id)))
      .map((s) =>
        urlEntry(`${SITE_URL}/o/${encodeURIComponent(s.slug)}`, {
          lastmod: s.updated_at ? new Date(s.updated_at).toISOString() : null,
          changefreq: "weekly",
          priority: "0.6",
        })
      );
  } catch (err) {
    console.error("Error agregando webs de productores al sitemap:", err);
    return [];
  }
}

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
      .select("id, slug, created_at, end_date, organization_id")
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

    const orgsWithUpcoming = new Set<number>();
    for (const e of events || []) {
      const lastDate = lastDateByEvent.get(e.id);
      const upcoming = !e.end_date || new Date(e.end_date) >= now || (lastDate !== undefined && lastDate >= today);
      if (!upcoming) continue;
      if (e.organization_id != null) orgsWithUpcoming.add(Number(e.organization_id));
      entries.push(
        urlEntry(`${SITE_URL}/eventos/${encodeURIComponent(e.slug)}`, {
          lastmod: e.created_at ? new Date(e.created_at).toISOString() : null,
          changefreq: "daily",
          priority: "0.8",
        })
      );
    }

    // Webs de productores (/o/<slug>): publicadas, con correo verificado, con al menos un evento próximo
    // (antes van con noindex) y SIN dominio propio activo (esas tienen su propio sitemap en su dominio).
    entries.push(...(await producerSiteEntries(orgsWithUpcoming)));
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
