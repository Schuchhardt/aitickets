// Videos del evento (migración 202610240100), uno por "slot":
//   cover    events.cover_video    reemplaza la imagen de portada arriba de la página pública
//   gallery  events.gallery_video  opcional, arriba de las fotos de la galería
// Los sube el panel directo a Storage (src/lib/videoStorage.ts, /api/events/video, EventVideoUploader.vue) y los
// muestra src/components/event/AutoplayVideo.vue: se reproduce solo y sin sonido mientras está en pantalla, con un
// botón de parlante para el sonido. La imagen (image_url) se sigue usando en la cartelera, al compartir y en correos.

export const EVENT_VIDEO_SLOTS = { cover: "cover_video", gallery: "gallery_video" } as const;
export type EventVideoSlot = keyof typeof EVENT_VIDEO_SLOTS;
export const isEventVideoSlot = (v: unknown): v is EventVideoSlot => typeof v === "string" && Object.prototype.hasOwnProperty.call(EVENT_VIDEO_SLOTS, v);

/** Tipos aceptados → extensión del archivo. */
export const EVENT_VIDEO_TYPES: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };
export const EVENT_VIDEO_MAX_BYTES = 50 * 1024 * 1024;

export interface EventVideo {
  url: string;
  poster_url: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  mime: string | null;
}

const httpsUrl = (v: unknown) => (typeof v === "string" && /^https:\/\//.test(v) && v.length <= 1000 ? v : null);
const positiveInt = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 20000 ? n : null;
};

/** Video tal como lo guarda la BD → forma pública (null si no hay o está mal formado). */
export function normalizeEventVideo(raw: any): EventVideo | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const url = httpsUrl(raw.url);
  if (!url) return null;
  const duration = Number(raw.duration);
  return {
    url,
    poster_url: httpsUrl(raw.poster_url),
    width: positiveInt(raw.width),
    height: positiveInt(raw.height),
    duration: Number.isFinite(duration) && duration > 0 && duration < 24 * 3600 ? Math.round(duration) : null,
    mime: typeof raw.mime === "string" && EVENT_VIDEO_TYPES[raw.mime] ? raw.mime : null,
  };
}
