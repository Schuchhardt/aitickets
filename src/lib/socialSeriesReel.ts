// Reel de respaldo de la difusión automática (detrás del flag SOCIAL_SERIES_FALLBACK_REEL=true): si el reel está
// activado y el evento no tiene un video vertical de 3 a 60 s, se arma uno con sus imágenes. Aquí, los cuadros (con las
// mismas plantillas de las historias) y qué fotos usar; el video lo arma ffmpeg en la background function
// social-series-reel-background (netlify/lib/reel-video.mjs). La orquestación (cuándo y con qué slots) vive en
// socialSeries.ts (prepareFallbackReels).
//
// Cuadros (1080×1920):
//   1. Apertura: la portada (o la foto base de la serie) con la plantilla del día (cuenta regresiva, fecha, lugar).
//   2. Hasta 3 fotos de la galería, a pantalla completa y sin texto.
//   3. Cierre: la plantilla otra vez (otro estilo) sobre la última foto, con el llamado ("Comenta ENTRADAS…").
// Sin ninguna foto no hay reel de respaldo: un reel solo de texto no aporta.
import { loadSharp } from "./imageOptimize";
import { renderPiece, type BaseImageOptions, type PieceData } from "./socialSeriesRender";
import { serverEnv } from "../pages/api/_lib/server-utils";
import { FALLBACK_REEL_PREFIX, MAX_FRAMES, REEL_SIZE } from "../../netlify/lib/reel-video.mjs";

export { FALLBACK_REEL_PREFIX };
export const fallbackReelEnabled = () => serverEnv("SOCIAL_SERIES_FALLBACK_REEL") === "true";
/** Pista de música (biblioteca propia libre de derechos, en nuestro Storage). Sin ella, el reel va sin sonido. */
export const fallbackReelMusicUrl = () => serverEnv("SOCIAL_SERIES_REEL_MUSIC_URL") || null;

/** Desde cuántas horas antes de publicar se arma el reel de respaldo (el job lo programa en Zernio ~2 h antes). */
export const FALLBACK_REEL_PREP_HOURS = 24;
/** Un pedido a la background function sin resultado después de esto se repite. */
export const FALLBACK_REEL_RETRY_MS = 30 * 60_000;
export const GALLERY_PHOTOS = 3;

/** ¿Es un reel de respaldo (generado por AI Tickets) y no un video subido por el productor? */
export const isFallbackReelUrl = (url: unknown) => typeof url === "string" && url.includes(`/${FALLBACK_REEL_PREFIX}`);

export type ReelPhoto = { url: string; role: "cover" | "gallery" };

/** Fotos del reel: la base (portada o la elegida para la serie) y hasta 3 de la galería, sin repetir. */
export function reelPhotos(baseUrl: string | null, gallery: { url: string }[] = []): ReelPhoto[] {
    const out: ReelPhoto[] = [];
    if (baseUrl) out.push({ url: baseUrl, role: "cover" });
    for (const g of gallery) {
        if (out.filter((p) => p.role === "gallery").length >= GALLERY_PHOTOS) break;
        if (g?.url && !out.some((p) => p.url === g.url)) out.push({ url: g.url, role: "gallery" });
    }
    return out;
}

/** Foto a pantalla completa (recorte al centro, 1080×1920), sin texto. */
async function photoFrame(buffer: Buffer): Promise<Buffer> {
    const sharp = await loadSharp();
    if (!sharp) throw new Error("sharp no disponible: no se puede generar el reel");
    return sharp(buffer, { failOn: "none", animated: false })
        .rotate()
        .resize(REEL_SIZE.width, REEL_SIZE.height, { fit: "cover", position: "attention" })
        .flatten({ background: "#111111" })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();
}

/**
 * JPGs de los cuadros, en orden. data: la pieza del día en formato historia (con el llamado del reel). load: baja una
 * foto (null si no se pudo); las fotos que no se pueden leer se saltan. Sin ninguna foto legible → [].
 */
export async function renderReelFrames(
    data: PieceData,
    photos: ReelPhoto[],
    { load, baseOptions = {} }: { load: (url: string) => Promise<Buffer | null>; baseOptions?: BaseImageOptions },
): Promise<Buffer[]> {
    const loaded: { photo: ReelPhoto; buffer: Buffer }[] = [];
    for (const p of photos) {
        const buffer = await load(p.url).catch(() => null);
        if (buffer) loaded.push({ photo: p, buffer });
    }
    if (!loaded.length) return [];
    const piece = { ...data, kind: "story" as const, replyVerb: "Comenta" as const };
    const first = loaded[0];
    const frames: Buffer[] = [await renderPiece({ ...piece, styleIndex: 0 }, first.buffer, first.photo.role === "cover" ? baseOptions : {})];
    const gallery = loaded.filter((l) => l !== first);
    for (const g of gallery) frames.push(await photoFrame(g.buffer));
    const closing = gallery[gallery.length - 1] || first;
    frames.push(await renderPiece({ ...piece, styleIndex: 1 }, closing.buffer, closing === first && first.photo.role === "cover" ? baseOptions : {}));
    return frames.slice(0, MAX_FRAMES);
}
