// POST /api/sites/ai → edita el sitio web con IA a partir de una instrucción del productor.
// Body: { instruction, draft: { template, theme, title, tagline, about, sections }, section_id? }
// Responde { summary, changes } sin guardar nada: el editor aplica los cambios al borrador (con vista previa en vivo y
// "Deshacer") y el productor guarda. Solo admin/producer; contexto filtrado por la organización de la sesión.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSiteEvents } from "../../../lib/sites";
import {
  SECTION_INFO,
  SECTION_TYPES,
  SITE_FONTS,
  TEMPLATE_INFO,
  mergeSectionEdits,
  sanitizeSections,
  type SiteTemplate,
} from "../../../lib/siteTemplates";
import { AiRefusalError, generateSiteEdit, isTextGenerationConfigured } from "../../../lib/aiText";
import { formatEventDateRange } from "../../../utils/dateHelpers.js";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";
import { EDITOR_TEMPLATES, json, requireSiteAdmin, sanitizeTheme } from "../../dashboard/sitio/_lib/site-admin";

export const prerender = false;

const EDITS_PER_DAY = 60;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim().slice(0, max) : "");

function collectImages(draft: any, events: { image_url: string | null }[]): Set<string> {
  const urls = new Set<string>();
  const add = (u: unknown) => {
    if (typeof u === "string" && u.startsWith("https://")) urls.add(u);
  };
  add(draft?.theme?.logo_url);
  add(draft?.theme?.hero_image_url);
  for (const s of Array.isArray(draft?.sections) ? draft.sections : []) {
    add(s?.data?.image_url);
    for (const item of Array.isArray(s?.data?.items) ? s.data.items : []) add(item?.image_url);
  }
  for (const e of events) add(e.image_url);
  return urls;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const auth = await requireSiteAdmin({ cookies });
  if (!auth.ok) return auth.response;
  if (!isTextGenerationConfigured()) return json({ message: "La IA no está configurada." }, 501);

  const body = await request.json().catch(() => null);
  const instruction = str(body?.instruction, 1500);
  if (instruction.length < 3) return json({ message: "Cuéntale a la IA qué quieres cambiar." }, 400);
  const raw = body?.draft && typeof body.draft === "object" ? body.draft : {};
  const template = (EDITOR_TEMPLATES as string[]).includes(raw.template) ? (raw.template as SiteTemplate) : "clasico";
  const currentSections = sanitizeSections(raw.sections);
  const sectionId = typeof body?.section_id === "string" && currentSections.some((s) => s.id === body.section_id) ? body.section_id : null;
  const draft = {
    template,
    theme: sanitizeTheme(raw.theme),
    title: str(raw.title, 80),
    tagline: str(raw.tagline, 200),
    about: str(raw.about, 5000),
    sections: currentSections,
  };

  const supabase = getSupabaseAdmin();
  const limit = await rateLimit("dash:siteai", `org:${auth.orgId}`, { windowSeconds: 86400, max: EDITS_PER_DAY, supabase });
  if (!limit.allowed) return json({ message: "Alcanzaste el máximo de ediciones con IA por hoy. Vuelve a intentarlo mañana." }, 429);

  const [{ data: org }, events] = await Promise.all([
    supabase.from("organizations").select("public_name").eq("id", auth.orgId).maybeSingle(),
    getSiteEvents({ organization_id: auth.orgId, is_demo: false } as any, 12).catch(() => []),
  ]);
  const context = [
    `Productora: ${org?.public_name || "(sin nombre)"}`,
    events.length
      ? `Próximos eventos publicados (los muestra la sección events):\n${events
          .map((e) => `- ${e.name} · ${formatEventDateRange(e)}${e.location ? ` · ${e.location}` : ""}`)
          .join("\n")}`
      : "No hay eventos publicados por ahora.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = await generateSiteEdit({
      instruction,
      draft,
      context,
      sectionId,
      templates: EDITOR_TEMPLATES.map((key) => ({ key, name: TEMPLATE_INFO[key].name, description: TEMPLATE_INFO[key].description })),
      fonts: SITE_FONTS,
      sectionTypes: SECTION_TYPES.map((type) => ({ type, name: SECTION_INFO[type].name, description: SECTION_INFO[type].description })),
    });

    const allowedImages = collectImages(draft, events);
    const changes: Record<string, unknown> = {
      sections: sanitizeSections(mergeSectionEdits(currentSections, result.sections, result.order, sectionId), { allowedImages }),
    };
    if (!sectionId) {
      if (result.template && result.template !== template && (EDITOR_TEMPLATES as string[]).includes(result.template)) changes.template = result.template;
      if (result.theme && Object.keys(result.theme).length) {
        // Conserva logo y portada del borrador: la IA solo cambia colores y tipografía
        const theme = sanitizeTheme({ ...draft.theme, ...result.theme, logo_url: draft.theme.logo_url, hero_image_url: draft.theme.hero_image_url });
        if (JSON.stringify(theme) !== JSON.stringify(draft.theme)) changes.theme = theme;
      }
      if (result.title !== undefined && str(result.title, 80) !== draft.title) changes.title = str(result.title, 80);
      if (result.tagline !== undefined && str(result.tagline, 200) !== draft.tagline) changes.tagline = str(result.tagline, 200);
      if (result.about !== undefined && str(result.about, 5000) !== draft.about) changes.about = str(result.about, 5000);
    }
    return json({ summary: result.summary || "Listo, revisa los cambios en la vista previa.", changes });
  } catch (err: any) {
    if (err instanceof AiRefusalError) return json({ message: "La IA no pudo hacer ese cambio. Prueba con otra instrucción." }, 422);
    console.error("POST /api/sites/ai", err?.message || err);
    return json({ message: "La IA no respondió a tiempo. Intenta de nuevo con una instrucción más corta." }, 502);
  }
};
