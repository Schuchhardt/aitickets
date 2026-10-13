// Metadatos de la imagen del evento (events.cover_meta): proporción real del póster y color dominante para
// el tinte de la página (rediseño §4.3). Se calculan en el servidor la primera vez que alguien abre la
// página con esa imagen y se guardan; mientras image_url no cambie se reutilizan. Nunca bloquea el render:
// la primera visita usa el fondo neutro y la proporción de respaldo (4:5).
import { getSupabaseAdmin } from "./auth-helpers";
import { fetchPublic } from "./safe-fetch";
import { loadSharp } from "./imageOptimize";
import { dominantColor, pastelTint } from "./eventTint.js";

export interface CoverMeta {
  src: string;
  width: number | null;
  height: number | null;
  color: string | null;
  luminance: number | null;
}

const MAX_BYTES = 12 * 1024 * 1024;
// Cálculos en curso / recientes por imagen (por instancia): evita repetir la descarga en visitas simultáneas
const inflight = new Map<string, Promise<CoverMeta | null>>();
// Resultados ya calculados (por si la columna aún no existe o el guardado falló)
const memo = new Map<string, CoverMeta>();

/** cover_meta guardado, válido solo si corresponde a la imagen actual. */
export function currentCoverMeta(raw: any, imageUrl: string | null | undefined): CoverMeta | null {
  if (!raw || typeof raw !== "object" || !imageUrl || raw.src !== imageUrl) return null;
  const num = (v: any) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  return {
    src: imageUrl,
    width: num(raw.width),
    height: num(raw.height),
    color: typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : null,
    luminance: Number.isFinite(Number(raw.luminance)) ? Number(raw.luminance) : null,
  };
}

/** Descarga la imagen y calcula sus metadatos (o null si no se puede). */
export async function computeCoverMeta(imageUrl: string): Promise<CoverMeta | null> {
  const sharp = await loadSharp();
  if (!sharp) return null;
  const { buffer } = await fetchPublic(imageUrl, { maxBytes: MAX_BYTES, accept: "image/*", timeoutMs: 8000 });
  const image = sharp(buffer, { failOn: "none" }).rotate();
  const meta = await image.metadata();
  // Tras rotate() la orientación EXIF 5–8 intercambia ancho y alto
  const swap = (meta.orientation || 1) >= 5;
  const width = (swap ? meta.height : meta.width) || null;
  const height = (swap ? meta.width : meta.height) || null;
  const { data, info } = await image.clone().resize(32, 32, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { color, luminance } = dominantColor(data, info.channels);
  return { src: imageUrl, width, height, color, luminance };
}

/**
 * Metadatos vigentes de la imagen del evento. Si faltan (o son de otra imagen) se calculan y se guardan,
 * esperando como máximo `waitMs` (en serverless el trabajo pendiente puede congelarse tras responder, así que
 * se espera un poco; si no alcanza, la página usa el fondo neutro y la próxima visita ya los tendrá).
 * `waitUntil` (Netlify) mantiene viva la función hasta terminar de guardar.
 */
export async function resolveCoverMeta(
  event: { id: number; image_url?: string | null; cover_meta?: any },
  { waitMs = 1500, waitUntil }: { waitMs?: number; waitUntil?: (p: Promise<unknown>) => void } = {},
): Promise<CoverMeta | null> {
  const imageUrl = event?.image_url || null;
  if (!imageUrl) return null;
  const stored = currentCoverMeta(event.cover_meta, imageUrl);
  if (stored) return stored;
  if (memo.has(imageUrl)) return memo.get(imageUrl)!;
  if (!inflight.has(imageUrl)) {
    if (inflight.size > 200) inflight.clear();
    const job = computeCoverMeta(imageUrl)
      .then(async (meta) => {
        if (!meta) return null;
        if (memo.size > 200) memo.clear();
        memo.set(imageUrl, meta);
        const { error } = await getSupabaseAdmin().from("events").update({ cover_meta: meta }).eq("id", event.id).eq("image_url", imageUrl);
        // Base sin la columna (deploy preview sin migrar): se queda en la caché de la instancia
        if (error && error.code !== "42703") console.error("No se pudo guardar cover_meta:", error.message);
        return meta;
      })
      .catch((err) => {
        console.error("No se pudo calcular cover_meta:", err?.message || err);
        return null;
      });
    inflight.set(imageUrl, job);
    try {
      waitUntil?.(job);
    } catch {
      /* sin waitUntil */
    }
  }
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs));
  return Promise.race([inflight.get(imageUrl)!, timeout]);
}

/** Tema de la página a partir de los metadatos: tinte pastel y proporción del póster. */
export function eventThemeFrom(meta: CoverMeta | null) {
  return {
    tint: meta?.color ? pastelTint(meta.color) : null,
    poster_width: meta?.width || null,
    poster_height: meta?.height || null,
  };
}
