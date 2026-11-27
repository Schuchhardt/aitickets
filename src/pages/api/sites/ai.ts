// POST /api/sites/ai → el asistente del editor visual edita el sitio a partir de una instrucción del productor.
// Body: { instruction, draft: { template, theme, title, tagline, about, sections, layout }, section_id?, history?, attachments? }
//   history: últimos intercambios del chat [{ instruction, summary }] (para seguir con "más corto", "deshaz lo del menú"...)
//   attachments: fotos y videos que el productor adjuntó en el chat, ya subidos con /api/sites/upload y /api/sites/video:
//     [{ type: "image", url } | { type: "video", url, poster_url?, width?, height?, duration? }]. Solo se aceptan los de la
//     carpeta de la organización de la sesión.
// El asistente puede hacer todo lo del editor: aplicar una plantilla completa (src/lib/sitePresets.ts), cambiar estilo,
// colores, tipografía, menú, logo e imagen de portada, agregar, quitar, ordenar, ocultar y editar secciones (textos,
// diseño, ítems, botones con ventana, menú) y poner, mover o quitar fotos y videos (solo los que ya están o se adjuntaron).
// Responde { summary, changes, warning? } sin guardar nada: el editor aplica los cambios al borrador (con vista previa en
// vivo y "Deshacer") y el productor guarda. Solo admin/producer; contexto filtrado por la organización de la sesión.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSiteEvents } from "../../../lib/sites";
import {
  MAX_SITE_IMAGES,
  MAX_SITE_VIDEOS,
  SECTION_INFO,
  SECTION_LAYOUTS,
  SECTION_TYPES,
  SITE_FONTS,
  SITE_NAV_STYLES,
  TEMPLATE_INFO,
  cleanVideo,
  countSectionMedia,
  mergeSectionEdits,
  sanitizeLayout,
  sanitizeSections,
  type SiteSection,
  type SiteTemplate,
  type SiteVideo,
} from "../../../lib/siteTemplates";
import { SITE_PRESETS, applyPreset } from "../../../lib/sitePresets";
import { AiRefusalError, generateSiteEdit, isTextGenerationConfigured } from "../../../lib/aiText";
import { publicImageBaseUrl } from "../../../lib/imageStorage";
import { ownVideoLocationAt } from "../../../lib/videoStorage";
import { formatEventDateRange } from "../../../utils/dateHelpers.js";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";
import { EDITOR_TEMPLATES, json, requireSiteAdmin, sanitizeTheme, siteVideoPrefix } from "../../dashboard/sitio/_lib/site-admin";

export const prerender = false;

const EDITS_PER_DAY = 60;
const MAX_HISTORY = 6;
const MAX_ATTACHED_IMAGES = 12;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim().slice(0, max) : "");

/** Últimos intercambios del chat, acotados. */
function parseHistory(input: unknown): { instruction: string; summary: string }[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((h: any) => ({ instruction: str(h?.instruction, 500), summary: str(h?.summary, 500) }))
    .filter((h) => h.instruction)
    .slice(-MAX_HISTORY);
}

/** Adjuntos del chat: solo fotos y videos subidos a la carpeta de esta organización. */
function parseAttachments(input: unknown, orgId: number): { images: string[]; videos: SiteVideo[] } {
  const images: string[] = [];
  const videos: SiteVideo[] = [];
  if (!Array.isArray(input)) return { images, videos };
  const imagePrefix = `${publicImageBaseUrl()}sites/${orgId}/`;
  const videoPrefix = siteVideoPrefix(orgId);
  for (const a of input.slice(0, MAX_ATTACHED_IMAGES + MAX_SITE_VIDEOS)) {
    if (!a || typeof a !== "object") continue;
    const url = typeof (a as any).url === "string" ? (a as any).url : "";
    if ((a as any).type === "image" && url.startsWith(imagePrefix) && !url.includes("..") && images.length < MAX_ATTACHED_IMAGES) {
      images.push(url);
    } else if ((a as any).type === "video" && ownVideoLocationAt(url, videoPrefix) && videos.length < MAX_SITE_VIDEOS) {
      const video = cleanVideo(a);
      if (video) {
        if (video.poster_url && !video.poster_url.startsWith(imagePrefix)) delete video.poster_url;
        videos.push(video);
      }
    }
  }
  return { images, videos };
}

/** Borrador para la IA: los videos van como su URL (la IA los referencia por URL para dejarlos, moverlos o quitarlos). */
function aiDraftSections(sections: SiteSection[]) {
  return sections.map((s) => (s.data.video ? { ...s, data: { ...s.data, video: s.data.video.url } } : s));
}

/**
 * Videos que propone la IA (data.video como texto): "" deja el que tenía la sección, "none" lo quita y una URL conocida
 * (del borrador o adjunta) lo pone. Cualquier otra cosa (URL desconocida, objeto) deja el que tenía.
 */
function resolveVideos(current: SiteSection[], merged: unknown[], known: Map<string, SiteVideo>): unknown[] {
  const byId = new Map(current.filter((s) => s.data.video).map((s) => [s.id, s.data.video]));
  return merged.map((raw) => {
    const s = raw as Record<string, any>;
    if (!s || typeof s !== "object") return raw;
    const { video: proposed, ...data } = s.data && typeof s.data === "object" ? s.data : ({} as Record<string, unknown>);
    let video: SiteVideo | undefined = byId.get(s.id);
    if (proposed === "none") video = undefined;
    else if (typeof proposed === "string" && known.has(proposed)) video = known.get(proposed);
    return { ...s, data: video ? { ...data, video } : data };
  });
}

/** logo_url / hero_image_url propuestos: "" o ausente deja el actual, "none" lo quita, una URL permitida lo cambia. */
function resolveThemeImage(current: unknown, proposed: unknown, allowed: Set<string>): string | undefined {
  if (proposed === "none") return undefined;
  if (typeof proposed === "string" && allowed.has(proposed)) return proposed;
  return typeof current === "string" ? current : undefined;
}

function collectImages(draft: any, events: { image_url: string | null }[], attached: string[]): Set<string> {
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
  for (const u of attached) add(u);
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

  const history = parseHistory(body?.history);
  const attachments = parseAttachments(body?.attachments, auth.orgId);

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
      draft: { ...draft, sections: aiDraftSections(currentSections) },
      context,
      sectionId,
      history,
      attachments: [
        ...attachments.images.map((url) => ({ type: "image" as const, url })),
        ...attachments.videos.map((v) => ({
          type: "video" as const,
          url: v.url,
          description: [v.width && v.height ? (v.height > v.width ? "vertical" : "horizontal") : "", v.duration ? `${v.duration} s` : ""].filter(Boolean).join(", "),
        })),
      ],
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

    const allowedImages = collectImages(draft, events, [...attachments.images, ...attachments.videos.map((v) => v.poster_url || "")]);
    const knownVideos = new Map<string, SiteVideo>([
      ...currentSections.filter((s) => s.data.video).map((s) => [s.data.video!.url, s.data.video!] as [string, SiteVideo]),
      ...attachments.videos.map((v) => [v.url, v] as [string, SiteVideo]),
    ]);
    const merged = resolveVideos(currentSections, mergeSectionEdits(currentSections, result.sections, result.order, sectionId), knownVideos);
    const sections = sanitizeSections(merged, { allowedImages, allowedVideos: new Set(knownVideos.keys()), keepEmpty: true });
    const changes: Record<string, unknown> = { sections };
    const media = countSectionMedia(sections);
    const warning =
      media.images > MAX_SITE_IMAGES || media.videos > MAX_SITE_VIDEOS
        ? `Ojo: el sitio quedó con ${media.images} fotos y ${media.videos} videos. El máximo es ${MAX_SITE_IMAGES} fotos y ${MAX_SITE_VIDEOS} videos: quita algunos antes de guardar.`
        : undefined;
    if (!sectionId) {
      if (result.layout) {
        const layout = sanitizeLayout({ ...draft.layout, ...result.layout });
        if (JSON.stringify(layout) !== JSON.stringify(draft.layout)) changes.layout = layout;
      }
      if (result.template && result.template !== template && (EDITOR_TEMPLATES as string[]).includes(result.template)) changes.template = result.template;
      if (result.theme && Object.keys(result.theme).length) {
        // Logo e imagen de portada: solo imágenes permitidas (o "none" para quitarlas)
        const theme = sanitizeTheme({
          ...draft.theme,
          ...result.theme,
          logo_url: resolveThemeImage(draft.theme.logo_url, result.theme.logo_url, allowedImages),
          hero_image_url: resolveThemeImage(draft.theme.hero_image_url, result.theme.hero_image_url, allowedImages),
        });
        if (JSON.stringify(theme) !== JSON.stringify(draft.theme)) changes.theme = theme;
      }
      if (result.title !== undefined && str(result.title, 80) !== draft.title) changes.title = str(result.title, 80);
      if (result.tagline !== undefined && str(result.tagline, 200) !== draft.tagline) changes.tagline = str(result.tagline, 200);
      if (result.about !== undefined && str(result.about, 5000) !== draft.about) changes.about = str(result.about, 5000);
    }
    return json({ summary: result.summary || "Listo, revisa los cambios en la vista previa.", changes, ...(warning ? { warning } : {}) });
  } catch (err: any) {
    if (err instanceof AiRefusalError) return json({ message: "La IA no pudo hacer ese cambio. Prueba con otra instrucción." }, 422);
    console.error("POST /api/sites/ai", err?.message || err);
    return json({ message: "La IA no respondió a tiempo. Intenta de nuevo con una instrucción más corta." }, 502);
  }
};
