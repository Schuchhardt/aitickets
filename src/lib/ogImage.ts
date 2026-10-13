// URL de la imagen para compartir un evento (Open Graph / Twitter): /og/eventos/<id>.jpg?v=<versión>.
// La versión depende de la imagen de portada (y del formato del render): al cambiar la portada cambia la
// URL, así WhatsApp/Facebook no siguen mostrando la anterior y la respuesta se puede cachear para siempre.
// La sirve src/pages/og/eventos/[id].jpg.ts.
import { createHash } from "node:crypto";

/** Subir al cambiar el render (src/lib/imageOptimize.ts renderOgImage) para invalidar las cachés. */
const OG_RENDER_VERSION = "r1";

export function ogImageVersion(imageUrl: string): string {
  return createHash("sha256").update(`${OG_RENDER_VERSION}:${imageUrl}`).digest("hex").slice(0, 16);
}

/** Ruta relativa de la imagen para compartir, o null si el evento no tiene portada. */
export function eventOgImagePath(eventId: number | string, imageUrl: string | null | undefined): string | null {
  if (!imageUrl || !/^https:\/\//i.test(imageUrl)) return null;
  const id = Number(eventId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return `/og/eventos/${id}.jpg?v=${ogImageVersion(imageUrl)}`;
}
