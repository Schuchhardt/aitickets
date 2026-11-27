// POST /api/sites/ai → edita el sitio web con IA a partir de una instrucción del productor.
// Body: { instruction, draft: { template, theme, title, tagline, about, sections, layout }, section_id? }
// La IA también puede elegir una plantilla completa (src/lib/sitePresets.ts) o cambiar el tipo de menú.
// Responde { summary, changes } sin guardar nada: el editor aplica los cambios al borrador (con vista previa en vivo y
// "Deshacer") y el productor guarda. Solo admin/producer; contexto filtrado por la organización de la sesión.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSiteEvents } from "../../../lib/sites";
import {
  SECTION_INFO,
  SECTION_LAYOUTS,
  SECTION_TYPES,
  SITE_FONTS,
  SITE_NAV_STYLES,
  TEMPLATE_INFO,
  mergeSectionEdits,
  sanitizeLayout,
  sanitizeSections,
  sectionVideoUrls,
  type SiteSection,
  type SiteTemplate,
} from "../../../lib/siteTemplates";
import { SITE_PRESETS, applyPreset } from "../../../lib/sitePresets";
import { AiRefusalError, generateSiteEdit, isTextGenerationConfigured } from "../../../lib/aiText";
import { formatEventDateRange } from "../../../utils/dateHelpers.js";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";
import { EDITOR_TEMPLATES, json, requireSiteAdmin, sanitizeTheme } from "../../dashboard/sitio/_lib/site-admin";

export const prerender = false;

const EDITS_PER_DAY = 60;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim().slice(0, max) : "");

/** La IA no maneja videos: cada sección conserva el que ya tenía (y nunca recibe uno de la IA). */
function keepVideos(current: SiteSection[], merged: unknown[]): unknown[] {
  const videos = new Map(current.filter((s) => s.data.video).map((s) => [s.id, s.data.video]));
  return merged.map((raw) => {
    const s = raw as Record<string, any>;
    if (!s || typeof s !== "object") return raw;
    const { video: _fromAi, ...data } = s.data && typeof s.data === "object" ? s.data : ({} as Record<string, unknown>);
    return { ...s, data: videos.has(s.id) ? { ...data, video: videos.get(s.id) } : data };
  });
}

function collectImages(draft: any, events: { image_url: string | null }[]): Set<string> {
  const urls = new Set<string>();
  const add = (u: unknown) => {
    if (typeof u === "string" && u.startsWith("https://")) urls.add(u);
  };
  add(draft?.theme?.logo_url);
  add(draft?.theme?.hero_image_url);
  for (const s of Array.isArray(draft?.sections) ? draft.sections : []) {
    add(s?.data?.image_url);
    add(s?.data?.video?.poster_url);
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
  const currentSections = sanitizeSections(raw.sections, { keepEmpty: true });
  const sectionId = typeof body?.section_id === "string" && currentSections.some((s) => s.id === body.section_id) ? body.section_id : null;
  const draft = {
    template,
    theme: sanitizeTheme(raw.theme),
    title: str(raw.title, 80),
    tagline: str(raw.tagline, 200),
    about: str(raw.about, 5000),
    sections: currentSections,
    layout: sanitizeLayout(raw.layout),
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
      layouts: Object.fromEntries(Object.entries(SECTION_LAYOUTS).map(([type, list]) => [type, list!.map((l) => l.value)])),
      presets: SITE_PRESETS.filter((p) => (EDITOR_TEMPLATES as string[]).includes(p.template)).map((p) => ({ key: p.key, template: p.template, name: p.name, description: p.description })),
      navStyles: SITE_NAV_STYLES.map((n) => ({ value: n.value, label: n.label })),
    });

    // Plantilla completa: sus secciones, estilo y menú reemplazan los del borrador (logo, portada y "Sobre nosotros" se mantienen)
    const applied = !sectionId && result.preset ? applyPreset(result.preset, draft.theme) : null;
    if (applied && (EDITOR_TEMPLATES as string[]).includes(applied.template)) {
      const changes: Record<string, unknown> = {
        template: applied.template,
        theme: sanitizeTheme(applied.theme),
        layout: applied.layout,
        sections: applied.sections,
        preset: applied.preset,
      };
      if (result.title !== undefined && str(result.title, 80) !== draft.title) changes.title = str(result.title, 80);
      if (result.tagline !== undefined && str(result.tagline, 200) !== draft.tagline) changes.tagline = str(result.tagline, 200);
      if (result.about !== undefined && str(result.about, 5000) !== draft.about) changes.about = str(result.about, 5000);
      return json({ summary: result.summary || "Apliqué la plantilla. Revisa los cambios en la vista previa.", changes });
    }

    const allowedImages = collectImages(draft, events);
    const allowedVideos = new Set(sectionVideoUrls(currentSections));
    const merged = keepVideos(currentSections, mergeSectionEdits(currentSections, result.sections, result.order, sectionId));
    const changes: Record<string, unknown> = {
      sections: sanitizeSections(merged, { allowedImages, allowedVideos, keepEmpty: true }),
    };
    if (!sectionId) {
      if (result.layout) {
        const layout = sanitizeLayout({ ...draft.layout, ...result.layout });
        if (JSON.stringify(layout) !== JSON.stringify(draft.layout)) changes.layout = layout;
      }
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
