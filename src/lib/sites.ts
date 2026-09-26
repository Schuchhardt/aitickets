// Sitios públicos de productores (tabla aitickets_sites, migración 202609270200_sites.sql).
//
// URLs de un sitio:
//   * https://aitickets.cl/o/<slug>            siempre (no requiere DNS)
//   * https://<slug>.aitickets.cl              solo si SITES_WILDCARD_ENABLED=true (proxy con X-Tenant-Host)
//   * https://<dominio propio>                 cuando domain_status = 'active' (alias de dominio en Netlify)
//
// Todo el acceso es server-side con la service role (src/lib/auth-helpers.ts). Este módulo solo LEE
// datos públicos del sitio y crea el sitio de una organización (ensureOrgSite). Las rutas que editan el
// sitio (WP4) deben autorizar por sesión + organization_id antes de escribir y luego llamar a
// invalidateSiteCache().
//
// Las previews de deploy comparten la BD de producción y pueden correr SIN la migración aplicada:
// si la tabla no existe, todo degrada a "sitio no encontrado" (404) sin romper el resto del sitio.
import { createHash, timingSafeEqual } from "node:crypto";
import { getSupabaseAdmin } from "./auth-helpers";
import { DEMO_EVENT_SLUG, getDemoEventDate } from "./demoEvent.mjs";
import { getZonedParts, zonedDateTimeToDate } from "../utils/dateHelpers.js";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
export type SiteTemplate = "clasico" | "nocturno" | "minimal" | "festival";
export const SITE_TEMPLATES: SiteTemplate[] = ["clasico", "nocturno", "minimal", "festival"];

export type DomainStatus = "none" | "pending_provider" | "pending_dns" | "pending_ssl" | "active" | "failed" | "removing";

export interface SiteTheme {
  primary?: string;
  accent?: string;
  background?: string;
  text?: string;
  font?: string;
  logo_url?: string;
  hero_image_url?: string;
  dark?: boolean;
}

export interface SiteSocials {
  instagram?: string;
  facebook?: string;
  tiktok?: string;
  x?: string;
  youtube?: string;
  whatsapp?: string;
  website?: string;
}

export interface SiteContent {
  /** Nombre a mostrar (por defecto organizations.public_name). */
  title?: string;
  tagline?: string;
  /** HTML enriquecido: se sanitiza con sanitizeRichText antes de renderizar. */
  about?: string;
  socials?: SiteSocials;
  [key: string]: any;
}

export interface SiteSeo {
  title?: string;
  description?: string;
  og_image?: string;
}

export interface SiteBanner {
  id: number;
  image_url: string;
  link_url: string | null;
  alt: string | null;
  placement: "hero" | "top_bar" | "inline";
  sort_order: number;
}

export interface SiteOrganization {
  id: number;
  public_name: string;
  /** Correo de la organización. Solo para el servidor (destino del formulario de contacto): nunca pasarlo al cliente. */
  email: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
  /** false si la organización no ha verificado su correo (el sitio no se publica). */
  email_verified: boolean;
  /**
   * Correo que la organización probó controlar (organizations.email_verified_for). Solo servidor. Es el
   * único respaldo válido del formulario de contacto: organizations.email se edita sin verificación.
   */
  verified_email?: string | null;
}

export interface SiteRecord {
  id: number;
  organization_id: number;
  slug: string;
  template: SiteTemplate;
  theme: SiteTheme;
  content: SiteContent;
  seo: SiteSeo;
  contact_email: string | null;
  contact_form_enabled: boolean;
  published: boolean;
  published_at: string | null;
  custom_domain: string | null;
  domain_status: DomainStatus;
  org: SiteOrganization | null;
  /** Sitio de demostración estático (slug 'demo'), sin fila en la BD. */
  is_demo?: boolean;
  [key: string]: any;
}

/** Datos del sitio seguros para enviar al cliente (sin correos internos). */
export interface PublicSiteProps {
  slug: string;
  name: string;
  template: SiteTemplate;
  theme: SiteTheme;
  content: SiteContent;
  socials: SiteSocials;
  contact_form_enabled: boolean;
  is_demo: boolean;
}

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------
function readEnv(value: string | undefined, name: string): string {
  const v = value ?? (globalThis as any).process?.env?.[name];
  return typeof v === "string" ? v.trim() : "";
}

const envSitesRootDomain = () => readEnv(import.meta.env.SITES_ROOT_DOMAIN, "SITES_ROOT_DOMAIN").toLowerCase() || "aitickets.cl";
const envWildcardEnabled = () => readEnv(import.meta.env.SITES_WILDCARD_ENABLED, "SITES_WILDCARD_ENABLED") === "true";
const envMainHosts = () =>
  readEnv(import.meta.env.MAIN_HOSTS, "MAIN_HOSTS")
    .split(",")
    .map((h) => normalizeHost(h))
    .filter(Boolean);
const envTenantProxySecret = () => readEnv(import.meta.env.TENANT_PROXY_SECRET, "TENANT_PROXY_SECRET");

/** Origen del sitio principal (checkout, dashboard, páginas /o/<slug>). */
export function mainOrigin(): string {
  return (readEnv(import.meta.env.SITE_URL, "SITE_URL") || "https://aitickets.cl").replace(/\/+$/, "");
}

/** Debe coincidir con el CHECK aitickets_sites_slug_reserved de la migración. */
export const RESERVED_SLUGS: string[] = [
  "www", "api", "app", "admin", "dashboard", "mail", "mg", "sites", "sites-origin", "status", "blog",
  "docs", "cdn", "static", "assets", "soporte", "ayuda", "demo", "o", "eventos", "organizadores",
  "precios", "comparar", "web-gratis", "bot", "outreach", "order", "ticket", "pago", "qr",
];

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
export const DEMO_SITE_SLUG = "demo";

// ---------------------------------------------------------------------------
// Slugs y hosts
// ---------------------------------------------------------------------------
/** "Producciones Ñandú SpA" -> "producciones-nandu-spa" (máx. 40, sin guiones al borde). */
export function slugify(input: string): string {
  return String(input || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  return typeof slug === "string" && SLUG_RE.test(slug) && !RESERVED_SLUGS.includes(slug);
}

/** Host en minúsculas, sin puerto ni punto final. Acepta "Host: a.cl:443". */
export function normalizeHost(host: string | null | undefined): string {
  let h = String(host || "").split(",")[0].trim().toLowerCase();
  if (!h) return "";
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end > 0 ? h.slice(0, end + 1) : h;
  }
  h = h.replace(/:\d+$/, "").replace(/\.$/, "");
  return h;
}

/**
 * Hosts que sirven la app principal (no un sitio de productor): aitickets.cl, www, localhost,
 * *.netlify.app (deploys y previews), el host de SITE_URL y los de MAIN_HOSTS (separados por coma).
 */
export function isMainHost(host: string | null | undefined): boolean {
  const h = normalizeHost(host);
  if (!h) return true;
  const root = envSitesRootDomain();
  if (h === root || h === `www.${root}` || h === "aitickets.cl" || h === "www.aitickets.cl") return true;
  if (h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "0.0.0.0") return true;
  if (h.endsWith(".netlify.app") || h.endsWith(".netlify.live")) return true;
  try {
    if (normalizeHost(new URL(mainOrigin()).host) === h) return true;
  } catch {
    /* SITE_URL inválida */
  }
  return envMainHosts().includes(h);
}

/** true si el host pertenece a aitickets.cl (incluye subdominios). Ahí Turnstile y las cookies funcionan. */
export function isUnderRootDomain(host: string | null | undefined): boolean {
  const h = normalizeHost(host);
  const root = envSitesRootDomain();
  return h === root || h.endsWith(`.${root}`) || h === "aitickets.cl" || h.endsWith(".aitickets.cl");
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

/**
 * Headers del proxy de tenants (x-tenant-host, x-tenant-proxy-secret, x-tenant-client-ip).
 * Solo se confía en ellos si TENANT_PROXY_SECRET está configurado y el secreto coincide (tiempo constante).
 * Devuelve null si no vienen o no son válidos (entonces se usa el Host real).
 */
export function getTrustedTenantProxy(request: Request): { host: string; clientIp: string | null } | null {
  const tenantHost = request.headers.get("x-tenant-host");
  const provided = request.headers.get("x-tenant-proxy-secret") || "";
  const secret = envTenantProxySecret();
  if (!tenantHost || !secret || !provided) return null;
  if (!safeEqual(provided, secret)) return null;
  const host = normalizeHost(tenantHost);
  if (!host) return null;
  const clientIp = (request.headers.get("x-tenant-client-ip") || "").split(",")[0].trim() || null;
  return { host, clientIp };
}

/** IP del cliente (considera el proxy de tenants verificado y los headers de Netlify). */
export function clientIpFrom(request: Request): string {
  const proxied = getTrustedTenantProxy(request);
  if (proxied?.clientIp) return proxied.clientIp;
  return (
    request.headers.get("x-nf-client-connection-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

// ---------------------------------------------------------------------------
// Sitio de demostración (sin BD)
// ---------------------------------------------------------------------------
export const DEMO_SITE: SiteRecord = Object.freeze({
  id: 0,
  organization_id: 0,
  slug: DEMO_SITE_SLUG,
  template: "clasico",
  theme: { primary: "#111827", accent: "#a3e635", background: "#ffffff", text: "#111827", font: "Unbounded" },
  content: {
    title: "Productora Demo",
    tagline: "Así se ve el sitio web gratis que AI Tickets crea para cada productora.",
    about:
      "<p>Este es un <strong>sitio de demostración</strong>. Cada productora que usa AI Tickets recibe un sitio como este, " +
      "con sus próximos eventos, banners, formulario de contacto y, si quiere, su propio dominio.</p>" +
      "<p>Las compras en el evento de demostración son simuladas: no se cobra nada.</p>",
    socials: { instagram: "https://www.instagram.com/aitickets.cl", website: "https://aitickets.cl" },
  },
  seo: {
    title: "Productora Demo – Sitio de ejemplo | AI Tickets",
    description: "Ejemplo del sitio web gratis para productoras de eventos que incluye AI Tickets.",
  },
  contact_email: null,
  contact_form_enabled: true,
  published: true,
  published_at: null,
  custom_domain: null,
  domain_status: "none",
  org: {
    id: 0,
    public_name: "Productora Demo",
    email: null,
    website: "https://aitickets.cl",
    instagram: null,
    facebook: null,
    tiktok: null,
    email_verified: true,
    verified_email: null,
  },
  is_demo: true,
  /** Slug del evento de demostración que lista este sitio (src/lib/demoEvent.mjs). */
  demo_event_slug: DEMO_EVENT_SLUG,
}) as SiteRecord;

// ---------------------------------------------------------------------------
// Caché en memoria (60 s) por slug y por host
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 1000;
type CacheEntry = { value: SiteRecord | null; expires: number };
const cacheBySlug = new Map<string, CacheEntry>();
const cacheByHost = new Map<string, CacheEntry>();

function cacheGet(map: Map<string, CacheEntry>, key: string): SiteRecord | null | undefined {
  const entry = map.get(key);
  if (!entry) return undefined;
  if (entry.expires < Date.now()) {
    map.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet(map: Map<string, CacheEntry>, key: string, value: SiteRecord | null) {
  if (map.size >= CACHE_MAX_ENTRIES) map.clear();
  map.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

/** Invalida la caché de un slug o host (o toda si no se indica). Llamar después de editar un sitio. */
export function invalidateSiteCache(slugOrHost?: string | null) {
  if (!slugOrHost) {
    cacheBySlug.clear();
    cacheByHost.clear();
    return;
  }
  const key = String(slugOrHost).toLowerCase();
  cacheBySlug.delete(key);
  cacheByHost.delete(normalizeHost(key));
  // Un host puede apuntar al slug invalidado (dominio propio): limpiar las entradas que lo referencian
  for (const [host, entry] of cacheByHost) {
    if (entry.value?.slug === key || entry.value?.custom_domain === key) cacheByHost.delete(host);
  }
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------
const SITE_COLUMNS =
  "id, organization_id, slug, template, theme, content, seo, contact_email, contact_form_enabled, published, published_at, custom_domain, domain_status";

const ORG_COLUMNS = "id, public_name, email, website, instagram, facebook, tiktok";

// organizations.email_verified_at llega con la migración 202609270400 (WP7). Si aún no existe
// (preview sin migrar), se considera verificada para no esconder sitios existentes.
let orgVerifiedColumnMissing = false;
// organizations.email_verified_for llega con la migración 202609270500. Si no existe, no hay respaldo
// verificado (el formulario solo escribe al contact_email confirmado).
let orgVerifiedForColumnMissing = false;

async function loadOrganization(organizationId: number): Promise<SiteOrganization | null> {
  const supabase = getSupabaseAdmin();
  let row: any = null;
  let verified = true;
  if (!orgVerifiedColumnMissing) {
    const select: string = orgVerifiedForColumnMissing ? `${ORG_COLUMNS}, email_verified_at` : `${ORG_COLUMNS}, email_verified_at, email_verified_for`;
    let { data, error }: { data: any; error: any } = await supabase.from("organizations").select(select).eq("id", organizationId).maybeSingle();
    if (error && !orgVerifiedForColumnMissing && /email_verified_for/.test(error.message || "")) {
      orgVerifiedForColumnMissing = true;
      ({ data, error } = await supabase
        .from("organizations")
        .select(`${ORG_COLUMNS}, email_verified_at`)
        .eq("id", organizationId)
        .maybeSingle());
    }
    if (error && (error.code === "42703" || /email_verified_at/.test(error.message || ""))) {
      orgVerifiedColumnMissing = true;
    } else if (error) {
      console.error("sites: error al leer la organización", error);
      return null;
    } else {
      row = data;
      verified = !!data?.email_verified_at;
    }
  }
  if (orgVerifiedColumnMissing) {
    const { data, error } = await supabase.from("organizations").select(ORG_COLUMNS).eq("id", organizationId).maybeSingle();
    if (error) {
      console.error("sites: error al leer la organización", error);
      return null;
    }
    row = data;
    verified = true;
  }
  if (!row) return null;
  return {
    id: row.id,
    public_name: row.public_name,
    email: row.email || null,
    website: row.website || null,
    instagram: row.instagram || null,
    facebook: row.facebook || null,
    tiktok: row.tiktok || null,
    email_verified: verified,
    verified_email: row.email_verified_for ? String(row.email_verified_for).trim().toLowerCase() : null,
  };
}

function normalizeSiteRow(row: any, org: SiteOrganization | null): SiteRecord {
  const template = SITE_TEMPLATES.includes(row.template) ? row.template : "clasico";
  return {
    ...row,
    template,
    theme: row.theme && typeof row.theme === "object" ? row.theme : {},
    content: row.content && typeof row.content === "object" ? row.content : {},
    seo: row.seo && typeof row.seo === "object" ? row.seo : {},
    contact_form_enabled: row.contact_form_enabled !== false,
    published: row.published !== false,
    domain_status: row.domain_status || "none",
    org,
  };
}

async function fetchSite(column: "slug" | "custom_domain", value: string): Promise<SiteRecord | null> {
  let query = getSupabaseAdmin().from("aitickets_sites").select(SITE_COLUMNS).eq(column, value);
  if (column === "custom_domain") query = query.eq("domain_status", "active");
  const { data, error } = await query.maybeSingle();
  if (error) {
    // 42P01 = tabla inexistente (preview sin migrar): se trata como "no encontrado"
    if (error.code !== "42P01" && error.code !== "PGRST205") console.error("sites: error al leer el sitio", error);
    return null;
  }
  if (!data) return null;
  const org = await loadOrganization(data.organization_id);
  return normalizeSiteRow(data, org);
}

/**
 * Un sitio es público si está publicado y su organización verificó el correo.
 * (El sitio demo siempre es público.)
 */
export function isSitePublic(site: SiteRecord | null | undefined): boolean {
  if (!site) return false;
  if (site.is_demo) return true;
  return site.published && !!site.org && site.org.email_verified !== false;
}

/**
 * Sitio por slug. Por defecto solo devuelve sitios públicos; con includeUnpublished también los no
 * publicados (para la vista previa del dueño; el llamador debe verificar la sesión).
 */
export async function getSiteBySlug(
  slug: string | null | undefined,
  opts: { includeUnpublished?: boolean; fresh?: boolean } = {}
): Promise<SiteRecord | null> {
  const key = String(slug || "").toLowerCase();
  if (key === DEMO_SITE_SLUG) return DEMO_SITE;
  if (!SLUG_RE.test(key)) return null;

  // fresh: ignora la caché por instancia (vista previa del dueño tras editar) y la actualiza
  let site = opts.fresh ? undefined : cacheGet(cacheBySlug, key);
  if (site === undefined) {
    try {
      site = await fetchSite("slug", key);
    } catch (err) {
      console.error("sites: getSiteBySlug", err);
      site = null;
    }
    cacheSet(cacheBySlug, key, site);
  }
  if (!site) return null;
  return opts.includeUnpublished || isSitePublic(site) ? site : null;
}

/**
 * Sitio por host del visitante: <slug>.<SITES_ROOT_DOMAIN> (si SITES_WILDCARD_ENABLED) o dominio propio
 * con domain_status='active'. Solo devuelve sitios públicos. null para hosts principales o desconocidos.
 */
export async function resolveSiteByHost(host: string | null | undefined): Promise<SiteRecord | null> {
  const h = normalizeHost(host);
  if (!h || isMainHost(h)) return null;

  const root = envSitesRootDomain();
  if (h.endsWith(`.${root}`)) {
    if (!envWildcardEnabled()) return null;
    const sub = h.slice(0, -(root.length + 1));
    if (sub.includes(".")) return null;
    return getSiteBySlug(sub);
  }

  let site = cacheGet(cacheByHost, h);
  if (site === undefined) {
    try {
      site = await fetchSite("custom_domain", h);
    } catch (err) {
      console.error("sites: resolveSiteByHost", err);
      site = null;
    }
    cacheSet(cacheByHost, h, site);
  }
  return isSitePublic(site) ? site : null;
}

/** Banners activos y vigentes del sitio, ordenados. */
export async function getSiteBanners(site: SiteRecord): Promise<SiteBanner[]> {
  if (site.is_demo || !site.id) return [];
  const now = Date.now();
  const { data, error } = await getSupabaseAdmin()
    .from("aitickets_site_banners")
    .select("id, image_url, link_url, alt, placement, sort_order, starts_at, ends_at")
    .eq("site_id", site.id)
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true })
    .limit(20);
  if (error) {
    if (error.code !== "42P01" && error.code !== "PGRST205") console.error("sites: error al leer banners", error);
    return [];
  }
  return (data || [])
    .filter((b: any) => (!b.starts_at || new Date(b.starts_at).getTime() <= now) && (!b.ends_at || new Date(b.ends_at).getTime() >= now))
    .filter((b: any) => isSafeHttpUrl(b.image_url))
    .map((b: any) => ({
      id: b.id,
      image_url: b.image_url,
      link_url: isSafeHttpUrl(b.link_url) ? b.link_url : null,
      alt: b.alt || null,
      placement: b.placement || "hero",
      sort_order: b.sort_order || 0,
    }));
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------
/**
 * Origen canónico del sitio (sin barra final): dominio propio activo > /o/<slug> en aitickets.cl.
 * El subdominio <slug>.aitickets.cl sirve el sitio, pero no es canónico.
 */
export function siteCanonicalOrigin(site: Pick<SiteRecord, "slug" | "custom_domain" | "domain_status">): string {
  if (site.custom_domain && site.domain_status === "active") return `https://${site.custom_domain}`;
  return `${mainOrigin()}/o/${site.slug}`;
}

/** URL absoluta canónica de una ruta del sitio ("/", "/contacto"). */
export function siteUrl(site: Pick<SiteRecord, "slug" | "custom_domain" | "domain_status">, path = "/"): string {
  const origin = siteCanonicalOrigin(site);
  const clean = path === "/" || !path ? "" : path.startsWith("/") ? path : `/${path}`;
  return `${origin}${clean}` || origin;
}

/**
 * Prefijo de las rutas internas del sitio según cómo llegó la petición: "" en un host de tenant
 * (dominio propio / subdominio) y "/o/<slug>" en aitickets.cl.
 */
export function siteBasePath(site: Pick<SiteRecord, "slug">, effectiveHost?: string | null): string {
  return effectiveHost && !isMainHost(effectiveHost) ? "" : `/o/${site.slug}`;
}

/**
 * URL de compra en aitickets.cl (el checkout, Turnstile y las cookies viven ahí). Abre el modal de
 * compra automáticamente con ?comprar=1.
 */
export function purchaseUrlFor(site: Pick<SiteRecord, "slug">, eventSlug: string): string {
  return `${mainOrigin()}/o/${site.slug}/eventos/${encodeURIComponent(eventSlug)}?comprar=1`;
}

// ---------------------------------------------------------------------------
// Props públicas (tema saneado, sin correos)
// ---------------------------------------------------------------------------
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
export const SITE_FONTS = ["Unbounded", "Prompt", "Inter", "Montserrat", "Playfair Display", "Space Grotesk", "Bebas Neue"];

export function isSafeHttpUrl(url: unknown): url is string {
  if (typeof url !== "string" || !url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export const TEMPLATE_DEFAULTS: Record<SiteTemplate, Required<Pick<SiteTheme, "primary" | "accent" | "background" | "text" | "font">> & { dark: boolean }> = {
  clasico: { primary: "#111827", accent: "#a3e635", background: "#ffffff", text: "#111827", font: "Unbounded", dark: false },
  nocturno: { primary: "#a78bfa", accent: "#f472b6", background: "#0b0b12", text: "#f5f5f5", font: "Space Grotesk", dark: true },
  minimal: { primary: "#111111", accent: "#111111", background: "#fafafa", text: "#171717", font: "Inter", dark: false },
  festival: { primary: "#f97316", accent: "#facc15", background: "#fff7ed", text: "#1c1917", font: "Bebas Neue", dark: false },
};

/** Tema final (valores del productor validados + defaults de la plantilla). */
export function resolveTheme(site: Pick<SiteRecord, "template" | "theme">, templateOverride?: SiteTemplate): SiteTheme & { dark: boolean } {
  const template = templateOverride || site.template;
  const defaults = TEMPLATE_DEFAULTS[template] || TEMPLATE_DEFAULTS.clasico;
  const t = site.theme || {};
  const color = (v: unknown, fallback: string) => (typeof v === "string" && HEX_RE.test(v.trim()) ? v.trim() : fallback);
  return {
    primary: color(t.primary, defaults.primary),
    accent: color(t.accent, defaults.accent),
    background: color(t.background, defaults.background),
    text: color(t.text, defaults.text),
    font: typeof t.font === "string" && SITE_FONTS.includes(t.font) ? t.font : defaults.font,
    logo_url: isSafeHttpUrl(t.logo_url) ? t.logo_url : undefined,
    hero_image_url: isSafeHttpUrl(t.hero_image_url) ? t.hero_image_url : undefined,
    dark: typeof t.dark === "boolean" ? t.dark : defaults.dark,
  };
}

function cleanSocials(site: SiteRecord): SiteSocials {
  const fromContent = (site.content?.socials || {}) as SiteSocials;
  const org = site.org;
  const pick = (v: unknown, fallback?: string | null) => (isSafeHttpUrl(v) ? (v as string) : isSafeHttpUrl(fallback) ? (fallback as string) : undefined);
  const handleUrl = (base: string, v: string | null | undefined) => {
    if (!v) return undefined;
    if (isSafeHttpUrl(v)) return v;
    const handle = String(v).replace(/^@/, "").trim();
    return /^[A-Za-z0-9._-]{1,60}$/.test(handle) ? `${base}${handle}` : undefined;
  };
  const socials: SiteSocials = {
    instagram: pick(fromContent.instagram) || handleUrl("https://www.instagram.com/", org?.instagram),
    facebook: pick(fromContent.facebook) || handleUrl("https://www.facebook.com/", org?.facebook),
    tiktok: pick(fromContent.tiktok) || handleUrl("https://www.tiktok.com/@", org?.tiktok),
    x: pick(fromContent.x),
    youtube: pick(fromContent.youtube),
    website: pick(fromContent.website, org?.website),
  };
  const wa = String(fromContent.whatsapp || "").replace(/[^\d]/g, "");
  if (wa.length >= 8 && wa.length <= 15) socials.whatsapp = `https://wa.me/${wa}`;
  return Object.fromEntries(Object.entries(socials).filter(([, v]) => !!v)) as SiteSocials;
}

/** Datos del sitio para los componentes (cliente). No incluye correos ni datos internos. */
export function publicSiteProps(site: SiteRecord, templateOverride?: SiteTemplate): PublicSiteProps {
  const template = templateOverride || site.template;
  const name = (site.content?.title && String(site.content.title).slice(0, 80)) || site.org?.public_name || site.slug;
  return {
    slug: site.slug,
    name,
    template,
    theme: resolveTheme(site, template),
    content: {
      title: name,
      tagline: site.content?.tagline ? String(site.content.tagline).slice(0, 200) : undefined,
    },
    socials: cleanSocials(site),
    contact_form_enabled: site.contact_form_enabled !== false,
    is_demo: !!site.is_demo,
  };
}

/**
 * Correo que recibe los mensajes del formulario de contacto: contact_email (solo se guarda tras abrir el
 * enlace de confirmación) o el correo que la organización verificó. Nunca organizations.email: se edita
 * desde el dashboard sin confirmación y convertiría el formulario en un relay hacia cualquier dirección.
 */
export function siteContactRecipient(site: SiteRecord): string | null {
  return site.contact_email || site.org?.verified_email || null;
}

// ---------------------------------------------------------------------------
// Creación (idempotente)
// ---------------------------------------------------------------------------
function baseSlugFor(organizationId: number, publicName: string): string {
  let base = slugify(publicName);
  if (!base) base = `org-${organizationId}`;
  else if (base.length < 3) base = `${base}-${organizationId}`;
  if (!isValidSlug(base)) base = `org-${organizationId}`;
  return base;
}

function withSuffix(base: string, n: number): string {
  if (n <= 1) return base;
  const suffix = `-${n}`;
  return `${base.slice(0, 40 - suffix.length).replace(/-+$/g, "")}${suffix}`;
}

/**
 * Crea el sitio de la organización si no existe y devuelve su slug. Idempotente y seguro ante carreras
 * (organization_id y slug son UNIQUE). Se crea con published=true, pero solo se muestra cuando la
 * organización verificó su correo (isSitePublic) y va con noindex hasta que tenga eventos publicados.
 * Lo llama el registro de productores (WP7) y el dashboard del sitio (WP4).
 */
export async function ensureOrgSite(organizationId: number, publicName: string): Promise<{ slug: string }> {
  const supabase = getSupabaseAdmin();
  const orgId = Number(organizationId);
  if (!Number.isInteger(orgId) || orgId <= 0) throw new Error("ensureOrgSite: organizationId inválido");

  const readExisting = async () => {
    const { data, error } = await supabase.from("aitickets_sites").select("slug").eq("organization_id", orgId).maybeSingle();
    if (error) throw error;
    return data?.slug as string | undefined;
  };

  const existing = await readExisting();
  if (existing) return { slug: existing };

  const base = baseSlugFor(orgId, publicName);
  for (let attempt = 1; attempt <= 25; attempt++) {
    const slug = attempt <= 20 ? withSuffix(base, attempt) : `org-${orgId}${attempt > 21 ? `-${attempt}` : ""}`;
    const { data, error } = await supabase
      .from("aitickets_sites")
      .insert({ organization_id: orgId, slug, published: true, published_at: new Date().toISOString() })
      .select("slug")
      .maybeSingle();
    if (!error && data?.slug) {
      invalidateSiteCache(data.slug);
      return { slug: data.slug };
    }
    if (error?.code === "23505") {
      // ¿Otro request creó el sitio de esta organización en paralelo?
      const raced = await readExisting();
      if (raced) return { slug: raced };
      continue; // slug ocupado: probar el siguiente sufijo
    }
    if (error?.code === "23514") continue; // CHECK (no debería pasar: el slug ya se validó)
    throw error || new Error("ensureOrgSite: no se pudo crear el sitio");
  }
  throw new Error("ensureOrgSite: no se encontró un slug disponible");
}

// ---------------------------------------------------------------------------
// Eventos del sitio (C3: publicados, públicos y próximos; C4: columnas explícitas, nunca secret_location)
// ---------------------------------------------------------------------------
export interface SiteEventCard {
  id: number;
  slug: string;
  name: string;
  image_url: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  dates: { date: string; start_time: string | null; end_time: string | null }[];
}

/** Próximos eventos publicados de la organización del sitio, ordenados por la próxima función. */
export async function getSiteEvents(site: SiteRecord, limit = 60): Promise<SiteEventCard[]> {
  const supabase = getSupabaseAdmin();
  const now = new Date();
  const todaySantiago = getZonedParts(now)?.date || now.toISOString().slice(0, 10);

  let query = supabase
    .from("events")
    .select("id, slug, name, title, image_url, location, start_date, end_date")
    .eq("status", "published")
    .not("slug", "is", null);
  if (site.is_demo) {
    query = query.eq("slug", String(site.demo_event_slug || DEMO_EVENT_SLUG));
  } else {
    query = query.eq("organization_id", site.organization_id).or("accessibility.is.null,accessibility.eq.public");
  }
  const { data: events, error } = await query.limit(200);
  if (error) {
    console.error("sites: error al obtener eventos del sitio", error);
    return [];
  }

  const eventIds = (events || []).map((e: any) => e.id);
  const { data: dates, error: datesError } = eventIds.length
    ? await supabase
        .from("event_dates")
        .select("event_id, date, start_time, end_time")
        .in("event_id", eventIds)
        .order("date", { ascending: true })
        .order("start_time", { ascending: true })
    : { data: [], error: null };
  if (datesError) console.error("sites: error al obtener fechas", datesError);

  const demoDate = site.is_demo ? getDemoEventDate(now) : null;
  const datesByEvent = new Map<number, SiteEventCard["dates"]>();
  for (const d of (dates || []) as any[]) {
    const list = datesByEvent.get(d.event_id) || [];
    list.push({ date: demoDate || String(d.date).slice(0, 10), start_time: d.start_time, end_time: d.end_time });
    datesByEvent.set(d.event_id, list);
  }

  return (events || [])
    .map((e: any) => {
      const eventDates = datesByEvent.get(e.id) || [];
      const upcomingDates = eventDates.filter((d) => d.date >= todaySantiago);
      const lastDate = eventDates.length ? eventDates[eventDates.length - 1].date : null;
      const endDate = demoDate ? null : e.end_date;
      const startDate = demoDate ? null : e.start_date;
      // Misma regla que /eventos (C3)
      const isUpcoming = !endDate || new Date(endDate) >= now || (lastDate !== null && lastDate >= todaySantiago);
      const nextStart = upcomingDates.length
        ? zonedDateTimeToDate(upcomingDates[0].date, upcomingDates[0].start_time as string)
        : startDate
          ? new Date(startDate)
          : null;
      const firstStart = eventDates.length ? zonedDateTimeToDate(eventDates[0].date, eventDates[0].start_time as string) : null;
      return {
        card: {
          id: e.id,
          slug: e.slug,
          name: e.name || e.title || "Evento",
          image_url: isSafeHttpUrl(e.image_url) ? e.image_url : null,
          location: e.location || null,
          start_date: startDate || firstStart?.toISOString() || null,
          end_date: endDate || null,
          dates: upcomingDates.length ? upcomingDates : eventDates,
        } as SiteEventCard,
        upcoming: !!isUpcoming,
        sortKey: nextStart ? nextStart.getTime() : Number.MAX_SAFE_INTEGER,
      };
    })
    .filter((e) => e.upcoming)
    .sort((a, b) => a.sortKey - b.sortKey)
    .slice(0, limit)
    .map((e) => e.card);
}
