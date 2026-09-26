// Banners del sitio del productor (solo ubicación "hero"; máx. 10 por sitio).
//   POST   { image_url, link_url?, alt?, starts_at?, ends_at?, active? }        → crea
//   PUT    { id, image_url?, link_url?, alt?, starts_at?, ends_at?, active? }   → actualiza
//   DELETE ?id= (o { id })                                                     → elimina
//   PATCH  { order: [id, ...] }                                                → reordena
// Todas responden { banners } con la lista actualizada. Cada banner se valida contra el sitio de la
// organización de la sesión (site_id del servidor, nunca del cliente).
import type { APIRoute } from "astro";
import { z } from "zod";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import {
  BANNER_COLUMNS,
  MAX_BANNERS,
  SitesUnavailableError,
  bannerView,
  invalidateSite,
  isoOrNull,
  json,
  loadBanners,
  loadOrgSite,
  requireSiteAdmin,
  safeUrl,
} from "../../dashboard/sitio/_lib/site-admin";

export const prerender = false;

const BannerFields = z.object({
  image_url: z.string().trim().max(1000),
  link_url: z.string().trim().max(1000).nullable().optional(),
  alt: z.string().trim().max(150).nullable().optional(),
  starts_at: z.string().max(40).nullable().optional(),
  ends_at: z.string().max(40).nullable().optional(),
  active: z.boolean().optional(),
});

async function context(cookies: any): Promise<{ ok: true; site: any; orgId: number } | { ok: false; response: Response }> {
  const auth = await requireSiteAdmin({ cookies });
  if (!auth.ok) return auth;
  try {
    const site = await loadOrgSite(auth.orgId);
    return { ok: true, site, orgId: auth.orgId };
  } catch (err) {
    if (err instanceof SitesUnavailableError) return { ok: false, response: json({ message: "El sitio web estará disponible muy pronto." }, 503) };
    console.error("banners: loadOrgSite", err);
    return { ok: false, response: json({ message: "No pudimos cargar tu sitio." }, 500) };
  }
}

/** Valida y normaliza los campos. Devuelve el patch o un mensaje de error. */
function buildFields(input: Partial<z.infer<typeof BannerFields>>, requireImage: boolean): { patch: Record<string, unknown> } | { error: string } {
  const patch: Record<string, unknown> = {};
  if (input.image_url !== undefined || requireImage) {
    const image = safeUrl(input.image_url, { httpsOnly: true });
    if (!image) return { error: "Sube una imagen para el banner." };
    patch.image_url = image;
  }
  if (input.link_url !== undefined) {
    if (!input.link_url) patch.link_url = null;
    else {
      const withScheme = /^https?:\/\//i.test(input.link_url) ? input.link_url : `https://${input.link_url}`;
      const link = safeUrl(withScheme);
      if (!link) return { error: "El enlace del banner no es válido." };
      patch.link_url = link;
    }
  }
  if (input.alt !== undefined) patch.alt = input.alt ? input.alt.replace(/[\u0000-\u001f\u007f]+/g, " ") : null;
  if (input.starts_at !== undefined) patch.starts_at = isoOrNull(input.starts_at);
  if (input.ends_at !== undefined) patch.ends_at = isoOrNull(input.ends_at);
  if (patch.starts_at && patch.ends_at && String(patch.ends_at) <= String(patch.starts_at)) {
    return { error: "La fecha de término debe ser posterior a la de inicio." };
  }
  if (input.active !== undefined) patch.active = input.active;
  return { patch };
}

async function respondWithList(site: any, status = 200, message?: string) {
  invalidateSite(site);
  const banners = await loadBanners(site.id);
  return json({ banners: banners.map(bannerView), message }, status);
}

async function readJson(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const ctx = await context(cookies);
  if (!ctx.ok) return ctx.response;
  const parsed = BannerFields.safeParse(await readJson(request));
  if (!parsed.success) return json({ message: "Datos inválidos" }, 400);
  const fields = buildFields(parsed.data, true);
  if ("error" in fields) return json({ message: fields.error }, 400);

  const supabase = getSupabaseAdmin();
  const existing = await loadBanners(ctx.site.id);
  if (existing.length >= MAX_BANNERS) return json({ message: `Puedes tener hasta ${MAX_BANNERS} banners.` }, 400);
  const maxOrder = existing.reduce((m, b) => Math.max(m, Number(b.sort_order) || 0), 0);

  const { error } = await supabase.from("aitickets_site_banners").insert({
    ...fields.patch,
    site_id: ctx.site.id,
    placement: "hero",
    sort_order: existing.length ? maxOrder + 1 : 0,
    active: fields.patch.active ?? true,
  });
  if (error) {
    console.error("banners POST", error.message);
    return json({ message: "No pudimos guardar el banner." }, 500);
  }
  return respondWithList(ctx.site, 201, "Banner agregado");
};

export const PUT: APIRoute = async ({ request, cookies }) => {
  const ctx = await context(cookies);
  if (!ctx.ok) return ctx.response;
  const body = await readJson(request);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return json({ message: "Banner inválido" }, 400);
  const parsed = BannerFields.partial().safeParse({ ...body, id: undefined });
  if (!parsed.success) return json({ message: "Datos inválidos" }, 400);
  const fields = buildFields(parsed.data, false);
  if ("error" in fields) return json({ message: fields.error }, 400);
  if (!Object.keys(fields.patch).length) return respondWithList(ctx.site);

  const { data, error } = await getSupabaseAdmin()
    .from("aitickets_site_banners")
    .update(fields.patch)
    .eq("id", id)
    .eq("site_id", ctx.site.id)
    .select(BANNER_COLUMNS)
    .maybeSingle();
  if (error) {
    console.error("banners PUT", error.message);
    return json({ message: "No pudimos guardar el banner." }, 500);
  }
  if (!data) return json({ message: "Banner no encontrado" }, 404);
  return respondWithList(ctx.site, 200, "Banner actualizado");
};

export const DELETE: APIRoute = async ({ request, url, cookies }) => {
  const ctx = await context(cookies);
  if (!ctx.ok) return ctx.response;
  let id = Number(url.searchParams.get("id"));
  if (!id) id = Number((await readJson(request))?.id);
  if (!Number.isInteger(id) || id <= 0) return json({ message: "Banner inválido" }, 400);

  const { data, error } = await getSupabaseAdmin()
    .from("aitickets_site_banners")
    .delete()
    .eq("id", id)
    .eq("site_id", ctx.site.id)
    .select("id");
  if (error) {
    console.error("banners DELETE", error.message);
    return json({ message: "No pudimos eliminar el banner." }, 500);
  }
  if (!data?.length) return json({ message: "Banner no encontrado" }, 404);
  return respondWithList(ctx.site, 200, "Banner eliminado");
};

export const PATCH: APIRoute = async ({ request, cookies }) => {
  const ctx = await context(cookies);
  if (!ctx.ok) return ctx.response;
  const body = await readJson(request);
  const order = Array.isArray(body?.order) ? body.order.map(Number) : null;
  if (!order || !order.length || order.length > MAX_BANNERS || order.some((n: number) => !Number.isInteger(n) || n <= 0)) {
    return json({ message: "Orden inválido" }, 400);
  }
  const existing = await loadBanners(ctx.site.id);
  const ownIds = new Set(existing.map((b) => Number(b.id)));
  if (new Set(order).size !== order.length || order.some((id: number) => !ownIds.has(id))) {
    return json({ message: "Orden inválido" }, 400);
  }
  // Los que no vinieron en la lista quedan al final, en su orden actual
  const rest = existing.map((b) => Number(b.id)).filter((id) => !order.includes(id));
  const finalOrder = [...order, ...rest];
  const supabase = getSupabaseAdmin();
  for (let i = 0; i < finalOrder.length; i++) {
    const { error } = await supabase
      .from("aitickets_site_banners")
      .update({ sort_order: i })
      .eq("id", finalOrder[i])
      .eq("site_id", ctx.site.id);
    if (error) {
      console.error("banners PATCH", error.message);
      return json({ message: "No pudimos reordenar los banners." }, 500);
    }
  }
  return respondWithList(ctx.site, 200, "Orden guardado");
};
