// Helpers de servidor del editor del sitio del productor (carpeta "_lib" => no es ruta).
// Los usan /dashboard/sitio y las APIs /api/sites/*.
//
// Seguridad: la service role se salta RLS. TODA lectura/escritura de aitickets_sites y
// aitickets_site_banners se filtra por el organization_id de la sesión (nunca por un id que mande el
// cliente). Solo los roles admin/producer (ORG_ADMIN_ROLES) editan el sitio.
import type { AstroCookies } from "astro";
import { getSupabaseAdmin } from "../../../../lib/auth-helpers";
import { getSessionContext, hasRole, ORG_ADMIN_ROLES, type SessionContext } from "../../../../lib/supabaseServer";
import { sanitizeRichText } from "../../../../lib/sanitize";
import { getOrgVerification, getOrgVerifiedEmail } from "../../../../lib/email-verification";
import {
  SITE_FONTS,
  ensureOrgSite,
  invalidateSiteCache,
  mainOrigin,
  type SiteTemplate,
} from "../../../../lib/sites";
import { domainView, getDomainProvider } from "../../../../../netlify/lib/domains/index.mjs";

/** Plantillas que ofrece el editor (el renderizador soporta más; ver src/lib/sites.ts). */
export const EDITOR_TEMPLATES: SiteTemplate[] = ["clasico", "nocturno"];
export const MAX_BANNERS = 10;
export const EDITOR_FONTS = SITE_FONTS;

export const SITE_EDITOR_COLUMNS =
  "id, organization_id, slug, template, theme, content, seo, contact_email, contact_form_enabled, published, published_at, custom_domain, domain_status, domain_provider, domain_provider_id, domain_verification, domain_error, domain_requested_at, domain_checked_at, domain_verified_at, updated_at";

export const BANNER_COLUMNS = "id, site_id, image_url, link_url, alt, placement, starts_at, ends_at, sort_order, active, created_at";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export class SitesUnavailableError extends Error {
  constructor() {
    super("La tabla aitickets_sites no existe (migración pendiente)");
    this.name = "SitesUnavailableError";
  }
}

export function isMissingTable(error: any): boolean {
  return !!error && (error.code === "42P01" || error.code === "PGRST205" || (/aitickets_site/.test(error.message || "") && /does not exist|schema cache/.test(error.message || "")));
}

type AuthResult = { ok: true; session: SessionContext; orgId: number } | { ok: false; response: Response };

/** Sesión de productor con rol admin/producer. */
export async function requireSiteAdmin(ctx: { cookies: AstroCookies }): Promise<AuthResult> {
  const session = await getSessionContext(ctx);
  if (!session) return { ok: false, response: json({ message: "No autorizado" }, 401) };
  if (!hasRole(session.dbUser, ORG_ADMIN_ROLES)) {
    return { ok: false, response: json({ message: "Solo los administradores de la productora pueden editar el sitio." }, 403) };
  }
  return { ok: true, session, orgId: Number(session.dbUser.organization_id) };
}

/** Sitio de la organización (lo crea si no existe). Lanza SitesUnavailableError si falta la migración. */
export async function loadOrgSite(orgId: number): Promise<any> {
  const supabase = getSupabaseAdmin();
  const read = async () => {
    const { data, error } = await supabase.from("aitickets_sites").select(SITE_EDITOR_COLUMNS).eq("organization_id", orgId).maybeSingle();
    if (error) {
      if (isMissingTable(error)) throw new SitesUnavailableError();
      throw error;
    }
    return data;
  };
  let site = await read();
  if (!site) {
    const { data: org } = await supabase.from("organizations").select("public_name").eq("id", orgId).maybeSingle();
    try {
      await ensureOrgSite(orgId, org?.public_name || `org-${orgId}`);
    } catch (err: any) {
      if (isMissingTable(err)) throw new SitesUnavailableError();
      throw err;
    }
    site = await read();
  }
  if (!site) throw new Error("No se pudo crear el sitio");
  return site;
}

export async function loadBanners(siteId: number): Promise<any[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("aitickets_site_banners")
    .select(BANNER_COLUMNS)
    .eq("site_id", siteId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    if (!isMissingTable(error)) console.error("sites: error al leer banners", error.message);
    return [];
  }
  return data || [];
}

function envValue(name: string): string {
  const v = (import.meta.env as any)[name] ?? (globalThis as any).process?.env?.[name];
  return typeof v === "string" ? v.trim() : "";
}

/** URLs del sitio: gratis (/o/<slug>), subdominio (si el comodín está activo) y dominio propio activo. */
export function siteUrls(site: any): { free: string; subdomain: string | null; custom: string | null } {
  const root = (envValue("SITES_ROOT_DOMAIN") || "aitickets.cl").toLowerCase();
  return {
    free: `${mainOrigin()}/o/${site.slug}`,
    subdomain: envValue("SITES_WILDCARD_ENABLED") === "true" ? `https://${site.slug}.${root}` : null,
    custom: site.custom_domain && site.domain_status === "active" ? `https://${site.custom_domain}` : null,
  };
}

/** Invalida la caché de lectura del sitio (slug actual, slug anterior y dominio). */
export function invalidateSite(site: any, previousSlug?: string | null) {
  invalidateSiteCache(site?.slug);
  if (previousSlug && previousSlug !== site?.slug) invalidateSiteCache(previousSlug);
  if (site?.custom_domain) invalidateSiteCache(site.custom_domain);
}

/** Datos para el editor (sin datos internos del proveedor de dominios). */
export function editorView(site: any, banners: any[]) {
  return {
    site: {
      id: site.id,
      slug: site.slug,
      template: site.template,
      theme: site.theme || {},
      content: site.content || {},
      seo: site.seo || {},
      contact_email: site.contact_email || "",
      contact_form_enabled: site.contact_form_enabled !== false,
      published: site.published !== false,
      published_at: site.published_at,
      updated_at: site.updated_at,
    },
    banners: banners.map(bannerView),
    urls: siteUrls(site),
    domain: domainView(site),
  };
}

export function bannerView(b: any) {
  return {
    id: b.id,
    image_url: b.image_url,
    link_url: b.link_url || "",
    alt: b.alt || "",
    placement: b.placement || "hero",
    starts_at: b.starts_at,
    ends_at: b.ends_at,
    sort_order: b.sort_order || 0,
    active: b.active !== false,
  };
}

/** Estado de la organización para los avisos del editor. */
export async function orgStatus(orgId: number) {
  const supabase = getSupabaseAdmin();
  const [{ verified }, verifiedEmail, { data: org }, { count }] = await Promise.all([
    getOrgVerification(orgId),
    getOrgVerifiedEmail(orgId),
    supabase.from("organizations").select("public_name").eq("id", orgId).maybeSingle(),
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "published"),
  ]);
  return {
    publicName: org?.public_name || "",
    // Solo el correo que la organización probó controlar (organizations.email_verified_for). Es el destino
    // del formulario de contacto cuando no hay contact_email; organizations.email se edita sin verificar.
    orgEmail: verifiedEmail || "",
    // null = columna aún no existe (preview sin migrar): se trata como verificada
    emailVerified: verified !== false,
    publishedEvents: count || 0,
    domainProvider: getDomainProvider().name as string,
  };
}

// ---------------------------------------------------------------------------
// Saneamiento de lo que envía el editor
// ---------------------------------------------------------------------------
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function safeUrl(value: unknown, { httpsOnly = false, max = 1000 } = {}): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (!v || v.length > max) return undefined;
  try {
    const u = new URL(v);
    if (u.protocol === "https:" || (!httpsOnly && u.protocol === "http:")) return u.toString();
  } catch {
    /* inválida */
  }
  return undefined;
}

/** Acepta "instagram.com/x" o "https://..." y devuelve una URL http(s) o undefined. */
function socialUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  let v = value.trim();
  if (!v) return undefined;
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  return safeUrl(v, { max: 300 });
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max) : "");

export function sanitizeTheme(input: any): Record<string, unknown> {
  const t = input && typeof input === "object" ? input : {};
  const out: Record<string, unknown> = {};
  for (const key of ["primary", "accent", "background", "text"]) {
    const v = typeof t[key] === "string" ? t[key].trim() : "";
    if (HEX_RE.test(v)) out[key] = v.toLowerCase();
  }
  if (typeof t.font === "string" && SITE_FONTS.includes(t.font)) out.font = t.font;
  const logo = safeUrl(t.logo_url, { httpsOnly: true });
  if (logo) out.logo_url = logo;
  const hero = safeUrl(t.hero_image_url, { httpsOnly: true });
  if (hero) out.hero_image_url = hero;
  if (typeof t.dark === "boolean") out.dark = t.dark;
  return out;
}

export function sanitizeContent(input: any, previous: any = {}): Record<string, unknown> {
  const c = input && typeof input === "object" ? input : {};
  // Conserva claves que el editor no maneja (p. ej. section_order futuro)
  const out: Record<string, unknown> = { ...(previous && typeof previous === "object" ? previous : {}) };
  out.title = text(c.title, 80) || undefined;
  out.tagline = text(c.tagline, 200) || undefined;
  const about = sanitizeRichText(typeof c.about === "string" ? c.about.slice(0, 8000) : "");
  out.about = about ? about.slice(0, 6000) : undefined;
  const s = c.socials && typeof c.socials === "object" ? c.socials : {};
  const socials: Record<string, string> = {};
  for (const key of ["instagram", "facebook", "tiktok", "x", "youtube", "website"]) {
    const url = socialUrl(s[key]);
    if (url) socials[key] = url;
  }
  const wa = String(s.whatsapp || "").replace(/[^\d]/g, "");
  if (wa.length >= 8 && wa.length <= 15) socials.whatsapp = wa;
  out.socials = socials;
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

export function sanitizeSeo(input: any): Record<string, unknown> {
  const s = input && typeof input === "object" ? input : {};
  const out: Record<string, unknown> = {};
  const title = text(s.title, 70);
  if (title) out.title = title;
  const description = text(s.description, 170);
  if (description) out.description = description;
  const og = safeUrl(s.og_image, { httpsOnly: true });
  if (og) out.og_image = og;
  return out;
}

/** Fecha ISO válida o null. */
export function isoOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
