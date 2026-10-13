// Galería de fotos del evento (public.aitickets_event_gallery_images). La gestionan el panel
// (/api/events/gallery, EventGalleryManager.vue) y se muestra al final de la página pública (EventGallery.vue,
// cargada en src/lib/eventPage.ts).
import { getSupabaseAdmin } from "./auth-helpers";

export const GALLERY_TABLE = "aitickets_event_gallery_images";
export const GALLERY_MAX_IMAGES = 40;
export const GALLERY_CAPTION_MAX = 200;
export const GALLERY_COLUMNS = "id, url, thumb_url, width, height, caption, position";

export interface GalleryImage {
  id: string;
  url: string;
  thumb_url: string | null;
  width: number | null;
  height: number | null;
  caption: string | null;
  position: number;
}

const positiveInt = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 20000 ? n : null;
};

/** Texto de la leyenda: sin saltos de línea, recortado; vacío => null. */
export function normalizeCaption(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim().slice(0, GALLERY_CAPTION_MAX);
  return s || null;
}

/**
 * Valida una imagen enviada por el panel. Solo se aceptan URLs del bucket propio (`baseUrl`, el prefijo
 * público de Supabase Storage): la galería no enlaza imágenes de terceros.
 */
export function normalizeGalleryInput(
  raw: any,
  baseUrl: string
): { url: string; thumb_url: string | null; width: number | null; height: number | null; caption: string | null } | null {
  const own = (v: unknown) => typeof v === "string" && v.length <= 1000 && v.startsWith(baseUrl) && !v.includes("..");
  if (!raw || !own(raw.url)) return null;
  return {
    url: raw.url,
    thumb_url: own(raw.thumb_url) ? raw.thumb_url : null,
    width: positiveInt(raw.width),
    height: positiveInt(raw.height),
    caption: normalizeCaption(raw.caption),
  };
}

/** Tabla aún no creada (deploy previews comparten la BD de producción y no migran). */
export const isMissingTable = (error: any) => error?.code === "42P01" || error?.code === "PGRST205";

/** Imágenes de la galería en orden. Si la tabla no existe todavía, lista vacía. */
export async function loadEventGallery(eventId: number): Promise<GalleryImage[]> {
  const { data, error } = await getSupabaseAdmin()
    .from(GALLERY_TABLE)
    .select(GALLERY_COLUMNS)
    .eq("event_id", eventId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(GALLERY_MAX_IMAGES);
  if (error) {
    if (!isMissingTable(error)) console.error("Error al cargar la galería:", error.message);
    return [];
  }
  return (data || []) as GalleryImage[];
}
