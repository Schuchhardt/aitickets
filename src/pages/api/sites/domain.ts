// Dominio propio del sitio del productor.
//   POST   { domain }  → normaliza, valida y solicita la conexión (verifica DNS antes de agregarlo)
//   GET               → refresca el estado con el proveedor (máx. 1 consulta cada 8 s)
//   DELETE            → desconecta el dominio
// Responden { domain: { domain, status, records, error, url, ... }, provider }.
// Solo admin/producer; el sitio se obtiene por el organization_id de la sesión.
import type { APIRoute } from "astro";
import { z } from "zod";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import {
  domainView,
  getDomainProvider,
  refreshSiteDomain,
  removeSiteDomain,
  requestSiteDomain,
} from "../../../../netlify/lib/domains/index.mjs";
import { SitesUnavailableError, invalidateSite, json, loadOrgSite, requireSiteAdmin } from "../../dashboard/sitio/_lib/site-admin";

export const prerender = false;

const GET_MIN_INTERVAL_MS = 8000;

async function context(cookies: any): Promise<{ ok: true; site: any } | { ok: false; response: Response }> {
  const auth = await requireSiteAdmin({ cookies });
  if (!auth.ok) return auth;
  try {
    return { ok: true, site: await loadOrgSite(auth.orgId) };
  } catch (err) {
    if (err instanceof SitesUnavailableError) return { ok: false, response: json({ message: "El sitio web estará disponible muy pronto." }, 503) };
    console.error("domain: loadOrgSite", err);
    return { ok: false, response: json({ message: "No pudimos cargar tu sitio." }, 500) };
  }
}

const respond = (site: any, status = 200, message?: string) =>
  json({ domain: domainView(site), provider: getDomainProvider().name, message }, status);

export const GET: APIRoute = async ({ cookies }) => {
  const ctx = await context(cookies);
  if (!ctx.ok) return ctx.response;
  try {
    const res = await refreshSiteDomain(getSupabaseAdmin(), ctx.site, { minIntervalMs: GET_MIN_INTERVAL_MS });
    if (res.changed) invalidateSite(res.site);
    return respond(res.site);
  } catch (err) {
    console.error("GET /api/sites/domain", err);
    return respond(ctx.site);
  }
};

const PostSchema = z.object({ domain: z.string().max(300) });

export const POST: APIRoute = async ({ request, cookies }) => {
  const ctx = await context(cookies);
  if (!ctx.ok) return ctx.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ message: "Solicitud inválida" }, 400);
  }
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) return json({ message: "Escribe tu dominio." }, 400);

  try {
    const res = await requestSiteDomain(getSupabaseAdmin(), ctx.site, parsed.data.domain);
    if (!res.ok) return json({ message: res.error, domain: domainView(ctx.site) }, res.httpStatus);
    invalidateSite(res.site);
    return respond(res.site, 200, "Dominio guardado. Ahora configura el DNS.");
  } catch (err) {
    console.error("POST /api/sites/domain", err);
    return json({ message: "No pudimos conectar el dominio. Intenta de nuevo." }, 500);
  }
};

export const DELETE: APIRoute = async ({ cookies }) => {
  const ctx = await context(cookies);
  if (!ctx.ok) return ctx.response;
  const previous = ctx.site.custom_domain;
  try {
    const res = await removeSiteDomain(getSupabaseAdmin(), ctx.site);
    if (previous) invalidateSite({ ...ctx.site, custom_domain: previous });
    if (!res.ok) {
      // En 'removing' el dominio ya no se sirve; el cron termina de quitarlo en el proveedor
      const pendingRemoval = res.site?.domain_status === "removing";
      return json({ message: res.error, domain: domainView(res.site || ctx.site) }, pendingRemoval ? 202 : 502);
    }
    return respond(res.site || { ...ctx.site, custom_domain: null, domain_status: "none" }, 200, "Dominio desconectado");
  } catch (err) {
    console.error("DELETE /api/sites/domain", err);
    return json({ message: "No pudimos desconectar el dominio. Intenta de nuevo." }, 500);
  }
};
