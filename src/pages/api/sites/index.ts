// GET /api/sites  → { site, banners, urls, domain, org }
// PUT /api/sites  → actualiza slug, plantilla, tema, contenido, SEO, contacto y publicación.
//
// Solo admin/producer de la organización; todo se filtra por el organization_id de la sesión.
import type { APIRoute } from "astro";
import { z } from "zod";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { isValidSlug, RESERVED_SLUGS, SLUG_RE } from "../../../lib/sites";
import { isValidEmail } from "../../../../netlify/lib/mailer.mjs";
import { sendContactEmailConfirmation } from "../../../lib/site-contact-email";
import {
  EDITOR_TEMPLATES,
  SITE_EDITOR_COLUMNS,
  SitesUnavailableError,
  editorView,
  invalidateSite,
  json,
  loadBanners,
  loadOrgSite,
  orgStatus,
  requireSiteAdmin,
  sanitizeContent,
  sanitizeSeo,
  sanitizeTheme,
} from "../../dashboard/sitio/_lib/site-admin";

export const prerender = false;

const UNAVAILABLE = { message: "El sitio web estará disponible muy pronto. Intenta más tarde." };

export const GET: APIRoute = async ({ cookies }) => {
  const auth = await requireSiteAdmin({ cookies });
  if (!auth.ok) return auth.response;
  try {
    const site = await loadOrgSite(auth.orgId);
    const [banners, org] = await Promise.all([loadBanners(site.id), orgStatus(auth.orgId)]);
    return json({ ...editorView(site, banners), org, templates: EDITOR_TEMPLATES });
  } catch (err) {
    if (err instanceof SitesUnavailableError) return json(UNAVAILABLE, 503);
    console.error("GET /api/sites", err);
    return json({ message: "No pudimos cargar tu sitio." }, 500);
  }
};

const PutSchema = z
  .object({
    slug: z.string().trim().toLowerCase().max(60).optional(),
    template: z.string().optional(),
    theme: z.record(z.any()).optional(),
    content: z.record(z.any()).optional(),
    seo: z.record(z.any()).optional(),
    contact_email: z.string().trim().toLowerCase().max(254).nullable().optional(),
    contact_form_enabled: z.boolean().optional(),
    published: z.boolean().optional(),
  })
  .strict();

export const PUT: APIRoute = async ({ request, cookies }) => {
  const auth = await requireSiteAdmin({ cookies });
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ message: "Solicitud inválida" }, 400);
  }
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) return json({ message: "Datos inválidos", issues: parsed.error.issues.slice(0, 5) }, 400);
  const input = parsed.data;

  let site: any;
  try {
    site = await loadOrgSite(auth.orgId);
  } catch (err) {
    if (err instanceof SitesUnavailableError) return json(UNAVAILABLE, 503);
    console.error("PUT /api/sites", err);
    return json({ message: "No pudimos cargar tu sitio." }, 500);
  }

  const patch: Record<string, unknown> = {};
  const previousSlug = site.slug;

  if (input.slug !== undefined && input.slug !== site.slug) {
    if (RESERVED_SLUGS.includes(input.slug)) return json({ message: "Esa dirección está reservada. Elige otra.", field: "slug" }, 400);
    if (!SLUG_RE.test(input.slug) || !isValidSlug(input.slug)) {
      return json({ message: "La dirección debe tener entre 3 y 40 caracteres: letras minúsculas, números y guiones.", field: "slug" }, 400);
    }
    patch.slug = input.slug;
  }
  if (input.template !== undefined && input.template !== site.template) {
    if (!EDITOR_TEMPLATES.includes(input.template as any)) return json({ message: "Plantilla no disponible", field: "template" }, 400);
    patch.template = input.template;
  }
  if (input.theme !== undefined) patch.theme = sanitizeTheme(input.theme);
  if (input.content !== undefined) patch.content = sanitizeContent(input.content, site.content);
  if (input.seo !== undefined) patch.seo = sanitizeSeo(input.seo);
  // contact_email: vacío o igual al correo VERIFICADO de la productora (email_verified_for, no
  // organizations.email, que se edita sin confirmar) se guarda directo; cualquier otro correo
  // se guarda recién cuando su dueño abre el enlace de confirmación (anti-spam por el formulario).
  let pendingContactEmail: string | null = null;
  if (input.contact_email !== undefined) {
    const email = input.contact_email || null;
    if (email && !isValidEmail(email)) return json({ message: "El correo de contacto no es válido.", field: "contact_email" }, 400);
    const currentEmail = String(site.contact_email || "").toLowerCase();
    if (!email) {
      if (currentEmail) patch.contact_email = null;
    } else if (email !== currentEmail) {
      const org = await orgStatus(auth.orgId);
      if (org.orgEmail && email === String(org.orgEmail).trim().toLowerCase()) {
        patch.contact_email = email;
      } else if (!org.emailVerified) {
        return json({ message: "Confirma primero el correo de tu cuenta para usar otro correo de contacto.", field: "contact_email" }, 403);
      } else {
        try {
          const sent = await sendContactEmailConfirmation({
            siteId: site.id,
            orgId: auth.orgId,
            email,
            orgName: org.publicName || site.slug,
          });
          if (!sent.ok) {
            return json({ message: "Ya te enviamos un correo de confirmación. Espera un minuto antes de pedir otro.", field: "contact_email" }, 429);
          }
          pendingContactEmail = email;
        } catch (err: any) {
          console.error("PUT /api/sites: no se pudo enviar la confirmación del correo de contacto", err?.message || err);
          return json({ message: "No pudimos enviar el correo de confirmación. Intenta de nuevo.", field: "contact_email" }, 502);
        }
      }
    }
  }
  if (input.contact_form_enabled !== undefined) patch.contact_form_enabled = input.contact_form_enabled;
  if (input.published !== undefined && input.published !== site.published) {
    patch.published = input.published;
    if (input.published) patch.published_at = new Date().toISOString();
  }

  const pendingMessage = pendingContactEmail
    ? `Te enviamos un correo a ${pendingContactEmail}. Abre el enlace para empezar a recibir ahí los mensajes.`
    : null;
  if (!Object.keys(patch).length) {
    const banners = await loadBanners(site.id);
    return json({ ...editorView(site, banners), pendingContactEmail, message: pendingMessage || "Sin cambios" });
  }
  patch.updated_at = new Date().toISOString();

  const { data: updated, error } = await getSupabaseAdmin()
    .from("aitickets_sites")
    .update(patch)
    .eq("id", site.id)
    .eq("organization_id", auth.orgId)
    .select(SITE_EDITOR_COLUMNS)
    .maybeSingle();

  if (error) {
    if (error.code === "23505") return json({ message: "Esa dirección ya está en uso. Elige otra.", field: "slug" }, 409);
    if (error.code === "23514") return json({ message: "Algún dato no es válido (dirección o plantilla).", field: "slug" }, 400);
    console.error("PUT /api/sites: error al guardar", error.message);
    return json({ message: "No pudimos guardar los cambios." }, 500);
  }
  if (!updated) return json({ message: "Sitio no encontrado" }, 404);

  invalidateSite(updated, previousSlug);
  const banners = await loadBanners(updated.id);
  return json({ ...editorView(updated, banners), pendingContactEmail, message: pendingMessage ? `Cambios guardados. ${pendingMessage}` : "Cambios guardados" });
};
