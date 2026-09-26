// GET /api/sites/slug-check?slug=  → { available, slug, reason? }
// reason: invalid | reserved | taken. El slug actual del propio sitio cuenta como disponible.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { RESERVED_SLUGS, isValidSlug } from "../../../lib/sites";
import { isMissingTable, json, requireSiteAdmin } from "../../dashboard/sitio/_lib/site-admin";

export const prerender = false;

export const GET: APIRoute = async ({ url, cookies }) => {
  const auth = await requireSiteAdmin({ cookies });
  if (!auth.ok) return auth.response;

  const slug = String(url.searchParams.get("slug") || "").trim().toLowerCase();
  if (RESERVED_SLUGS.includes(slug)) return json({ available: false, slug, reason: "reserved" });
  if (!isValidSlug(slug)) return json({ available: false, slug, reason: "invalid" });

  const { data, error } = await getSupabaseAdmin()
    .from("aitickets_sites")
    .select("organization_id")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return json({ message: "El sitio web estará disponible muy pronto." }, 503);
    console.error("slug-check", error.message);
    return json({ message: "No pudimos revisar la dirección." }, 500);
  }
  if (data && Number(data.organization_id) !== auth.orgId) return json({ available: false, slug, reason: "taken" });
  return json({ available: true, slug, current: !!data });
};
