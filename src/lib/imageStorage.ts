// Subida de imágenes al bucket público "Events" de Supabase, siempre optimizadas (src/lib/imageOptimize.ts).
// La usan /api/events/upload-image (portadas y galería), /api/promote/upload-image, /api/sites/upload y
// storeImage (imágenes de marketing, generadas con IA y de la API de productores).
import { getSupabaseAdmin } from "./auth-helpers";
import { makeThumbnail, optimizeImage, type OptimizeOptions } from "./imageOptimize";

export const IMAGE_BUCKET = "Events";
/** Nombres únicos por subida: se pueden cachear para siempre. */
const CACHE_SECONDS = "31536000";

export interface StoredImage {
  url: string;
  /** Miniatura WebP (solo con thumbnail: true y si se pudo generar). */
  thumb_url: string | null;
  width: number | null;
  height: number | null;
  contentType: string;
  bytes: number;
}

export interface StoreImageOptions extends OptimizeOptions {
  /** Carpeta y prefijo del nombre, p. ej. "event-covers/12-cover" (sin extensión). */
  pathPrefix: string;
  thumbnail?: boolean;
}

const randomSuffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

/** Optimiza y sube la imagen (y su miniatura si se pide). `contentType` debe venir de sniffImageType. */
export async function storeOptimizedImage(buffer: Buffer, contentType: string, opts: StoreImageOptions): Promise<StoredImage> {
  const supabase = getSupabaseAdmin();
  const optimized = await optimizeImage(buffer, contentType, opts);
  const base = `${opts.pathPrefix}-${randomSuffix()}`;
  const path = `${base}.${optimized.ext}`;

  const { error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, optimized.buffer, { contentType: optimized.contentType, cacheControl: CACHE_SECONDS, upsert: false });
  if (error) throw new Error(`Error guardando imagen: ${error.message}`);
  const url = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;

  let thumbUrl: string | null = null;
  if (opts.thumbnail) {
    const thumb = await makeThumbnail(optimized.buffer);
    if (thumb) {
      const thumbPath = `${base}-thumb.webp`;
      const { error: thumbError } = await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(thumbPath, thumb.buffer, { contentType: "image/webp", cacheControl: CACHE_SECONDS, upsert: false });
      if (thumbError) console.error("storeOptimizedImage (miniatura):", thumbError.message);
      else thumbUrl = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(thumbPath).data.publicUrl;
    }
  }

  return {
    url,
    thumb_url: thumbUrl,
    width: optimized.width,
    height: optimized.height,
    contentType: optimized.contentType,
    bytes: optimized.buffer.length,
  };
}

/** Prefijo público de las imágenes del bucket (para validar que una URL es nuestra). */
export function publicImageBaseUrl(): string {
  return getSupabaseAdmin().storage.from(IMAGE_BUCKET).getPublicUrl("").data.publicUrl.replace(/\/?$/, "/");
}
