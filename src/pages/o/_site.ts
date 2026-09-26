// Helper compartido por las páginas /o/[site]/* (el "_" lo excluye del enrutado de Astro).
import type { AstroGlobal } from "astro";
import { getSessionContext } from "../../lib/supabaseServer";
import {
  SITE_TEMPLATES,
  getSiteBySlug,
  isMainHost,
  isSitePublic,
  siteBasePath,
  type SiteRecord,
  type SiteTemplate,
} from "../../lib/sites";

export interface LoadedSite {
  site: SiteRecord;
  /** Vista previa del dueño (sitio no publicado o plantilla forzada): noindex + cinta "Vista previa". */
  preview: boolean;
  /** Prefijo de las rutas internas: "" en dominio propio, "/o/<slug>" en aitickets.cl. */
  base: string;
  /** true si la petición llegó por un host de tenant (dominio propio / subdominio). */
  onTenantHost: boolean;
  /** Plantilla a renderizar (la del sitio o ?plantilla= para demo / dueño). */
  template: SiteTemplate;
}

async function isOwner(Astro: AstroGlobal, site: SiteRecord): Promise<boolean> {
  try {
    const session = await getSessionContext(Astro);
    return !!session && Number(session.dbUser.organization_id) === Number(site.organization_id);
  } catch {
    return false;
  }
}

/**
 * Carga el sitio de la ruta /o/[site]. Devuelve null (=> 404) si no existe o no es público y quien lo
 * ve no es el dueño. En un host de tenant usa el sitio ya resuelto por el middleware.
 */
export async function loadSiteForPage(Astro: AstroGlobal): Promise<LoadedSite | null> {
  const slug = String(Astro.params.site || "").toLowerCase();
  const effectiveHost = Astro.locals.effectiveHost || Astro.url.host;
  const localSite = Astro.locals.site as SiteRecord | null | undefined;
  const onTenantHost = !!localSite && (!isMainHost(effectiveHost) || !!Astro.url.searchParams.get("__site"));

  let site: SiteRecord | null;
  if (localSite) {
    if (localSite.slug !== slug) return null;
    site = localSite;
  } else {
    site = await getSiteBySlug(slug, { includeUnpublished: true });
  }
  if (!site) return null;

  let preview = false;
  let ownerChecked: boolean | null = null;
  // El dueño (p. ej. el iframe de vista previa del editor) ve sus cambios al instante: la caché de
  // sitios es por instancia y la invalidación del editor solo alcanza a la instancia que lo atendió.
  if (!localSite && !site.is_demo) {
    ownerChecked = await isOwner(Astro, site);
    if (ownerChecked) {
      site = (await getSiteBySlug(slug, { includeUnpublished: true, fresh: true })) || site;
    }
  }
  if (!isSitePublic(site)) {
    // Los sitios no publicados solo se ven en aitickets.cl y solo por su dueño
    if (onTenantHost && !import.meta.env.DEV) return null;
    if (ownerChecked === null) ownerChecked = await isOwner(Astro, site);
    if (!ownerChecked) return null;
    preview = true;
  }

  let template = site.template;
  const requested = Astro.url.searchParams.get("plantilla") as SiteTemplate | null;
  if (requested && SITE_TEMPLATES.includes(requested) && requested !== site.template) {
    if (site.is_demo) {
      template = requested;
    } else {
      if (ownerChecked === null) ownerChecked = await isOwner(Astro, site);
      if (ownerChecked) {
        template = requested;
        preview = true;
      }
    }
  }

  return {
    site,
    preview,
    // En la simulación de desarrollo (?__site) los enlaces siguen usando /o/<slug>
    base: siteBasePath(site, onTenantHost ? effectiveHost : null),
    onTenantHost,
    template,
  };
}
