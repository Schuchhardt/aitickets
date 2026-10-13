// Optimización de imágenes subidas (portadas, galería, imágenes de marketing y de sitios) y render de la
// imagen para compartir (Open Graph: WhatsApp, Facebook, X, LinkedIn).
//
// Usa sharp (binario nativo). Si no carga o falla con un archivo, se guarda/sirve el original: optimizar
// nunca debe impedir subir una imagen.
//
// - optimizeImage: corrige la orientación EXIF, quita metadatos (GPS incluido), limita el lado mayor y
//   recomprime. JPEG (mozjpeg) si la imagen es opaca, PNG si tiene transparencia real (logos). Los GIF
//   animados se dejan tal cual. Si el resultado pesa más que el original sin haber cambiado el tamaño, se
//   conserva el original.
// - renderOgImage: 1200×630 JPEG < 300 KB. WhatsApp no muestra la vista previa (o la muestra mínima) con
//   imágenes pesadas, y los flyers (verticales) recortados a 1.91:1 pierden el texto: si la proporción no
//   se parece a la de OG, la imagen completa va centrada sobre un fondo difuminado de sí misma.
// - makeThumbnail: miniatura WebP para grillas (galería).

type SharpFn = typeof import("sharp");

let sharpPromise: Promise<SharpFn | null> | null = null;

/** sharp, o null si el binario no está disponible en este entorno. */
export function loadSharp(): Promise<SharpFn | null> {
  if (!sharpPromise) {
    sharpPromise = import("sharp")
      .then((m: any) => (m.default || m) as SharpFn)
      .catch((err) => {
        console.error("sharp no disponible (se guardan las imágenes sin optimizar):", err?.message || err);
        return null;
      });
  }
  return sharpPromise;
}

export const IMAGE_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

export interface OptimizedImage {
  buffer: Buffer;
  contentType: string;
  ext: string;
  width: number | null;
  height: number | null;
  /** false si se devolvió el original (sharp no disponible, GIF animado, error o no hubo ganancia). */
  optimized: boolean;
}

export interface OptimizeOptions {
  /** Lado mayor máximo en px (no agranda). */
  maxSize?: number;
  /** Calidad JPEG/WebP (1-100). */
  quality?: number;
}

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
/** WhatsApp recomienda < 300 KB para la imagen de la vista previa. */
export const OG_MAX_BYTES = 290 * 1024;

const original = (buffer: Buffer, contentType: string, width: number | null = null, height: number | null = null): OptimizedImage => ({
  buffer,
  contentType,
  ext: IMAGE_EXT[contentType] || "bin",
  width,
  height,
  optimized: false,
});

export async function optimizeImage(input: Buffer, contentType: string, opts: OptimizeOptions = {}): Promise<OptimizedImage> {
  const maxSize = opts.maxSize ?? 2000;
  const quality = opts.quality ?? 82;
  const sharp = await loadSharp();
  if (!sharp) return original(input, contentType);
  try {
    const meta = await sharp(input, { animated: true }).metadata();
    // GIF animado (o WebP animado): sharp lo recomprime mal; se conserva
    if ((meta.pages || 1) > 1) return original(input, contentType, meta.width ?? null, meta.pageHeight ?? meta.height ?? null);

    const pipeline = sharp(input, { failOn: "none" })
      .rotate()
      .resize({ width: maxSize, height: maxSize, fit: "inside", withoutEnlargement: true });

    // Transparencia real (no solo canal alfa opaco): PNG para no perderla
    let transparent = false;
    if (meta.hasAlpha) {
      const stats = await sharp(input, { failOn: "none" }).stats();
      transparent = !stats.isOpaque;
    }

    const { data, info } = transparent
      ? await pipeline.png({ compressionLevel: 9, effort: 8 }).toBuffer({ resolveWithObject: true })
      : await pipeline.flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    const outType = transparent ? "image/png" : "image/jpeg";

    // Sin redimensionar, mismo formato y más pesado: no vale la pena
    const resized = info.width !== meta.width || info.height !== meta.height;
    if (!resized && outType === contentType && data.length >= input.length) {
      return original(input, contentType, meta.width ?? null, meta.height ?? null);
    }
    return { buffer: data, contentType: outType, ext: IMAGE_EXT[outType], width: info.width, height: info.height, optimized: true };
  } catch (err: any) {
    console.error("optimizeImage: se guarda el original:", err?.message || err);
    return original(input, contentType);
  }
}

/** Miniatura WebP (ancho máx. `width`), o null si no se pudo generar. */
export async function makeThumbnail(input: Buffer, width = 640, quality = 72): Promise<{ buffer: Buffer; width: number; height: number } | null> {
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    const { data, info } = await sharp(input, { failOn: "none" })
      .rotate()
      .resize({ width, height: width * 2, fit: "inside", withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height };
  } catch (err: any) {
    console.error("makeThumbnail:", err?.message || err);
    return null;
  }
}

/** Proporciones (ancho/alto) que se recortan a 1200×630 sin perder lo importante. */
const OG_COVER_RATIO = { min: 1.5, max: 2.4 };

/**
 * Imagen para compartir: 1200×630 JPEG, bajo OG_MAX_BYTES. Devuelve null si sharp no está disponible o
 * la imagen no se pudo procesar (quien llama sirve el original).
 */
export async function renderOgImage(input: Buffer): Promise<Buffer | null> {
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    // Base normalizada: orientación EXIF aplicada, primer cuadro (GIF), sin alfa, tamaño acotado
    const { data: base, info } = await sharp(input, { failOn: "none", animated: false })
      .rotate()
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#111111" })
      .toBuffer({ resolveWithObject: true });
    const ratio = info.width / info.height;

    let composed: Buffer;
    if (ratio >= OG_COVER_RATIO.min && ratio <= OG_COVER_RATIO.max) {
      composed = await sharp(base).resize(OG_WIDTH, OG_HEIGHT, { fit: "cover", position: "attention" }).toBuffer();
    } else {
      const background = await sharp(base)
        .resize(OG_WIDTH, OG_HEIGHT, { fit: "cover" })
        .blur(30)
        .modulate({ brightness: 0.55 })
        .toBuffer();
      const foreground = await sharp(base)
        .resize(OG_WIDTH, OG_HEIGHT, { fit: "inside", withoutEnlargement: false })
        .toBuffer();
      composed = await sharp(background).composite([{ input: foreground, gravity: "center" }]).toBuffer();
    }

    let out: Buffer | null = null;
    for (const quality of [82, 74, 66, 58, 50]) {
      out = await sharp(composed).jpeg({ quality, mozjpeg: true }).toBuffer();
      if (out.length <= OG_MAX_BYTES) break;
    }
    return out;
  } catch (err: any) {
    console.error("renderOgImage:", err?.message || err);
    return null;
  }
}

/** Detecta el tipo real de la imagen por sus bytes iniciales (no se confía en lo que declara el cliente). */
export function sniffImageType(buf: Uint8Array): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "image/gif";
  if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
    && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return "image/webp";
  return null;
}
