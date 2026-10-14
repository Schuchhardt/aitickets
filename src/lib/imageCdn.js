// Imágenes de Supabase Storage servidas por Netlify Image CDN (/.netlify/images): redimensionadas al ancho
// que pide el navegador (srcset) y en AVIF/WebP según el Accept. La imagen guardada no cambia.
// Solo para URLs públicas de nuestro bucket (netlify.toml [images] remote_images) y solo en el build de
// producción: en `astro dev` no existe /.netlify/images y se usa la URL original.
// Debe dar el mismo resultado en el servidor y en el cliente (hidratación).

const STORAGE_PUBLIC_PREFIX = "https://bgsmqjrdryafvlyxywud.supabase.co/storage/v1/object/public/";

// Anchos del srcset: móviles (1x–3x) hasta pantallas grandes en 2x
const WIDTHS = [480, 750, 1080, 1440, 1920];
const QUALITY = 80;

const enabled = import.meta.env.PROD;

const canTransform = (url) => enabled && typeof url === "string" && url.startsWith(STORAGE_PUBLIC_PREFIX);

/** URL de la imagen con ancho `w` (o la original si no se puede transformar). */
export function cdnImage(url, w) {
  if (!canTransform(url)) return url;
  return `/.netlify/images?url=${encodeURIComponent(url)}&w=${w}&q=${QUALITY}`;
}

/** srcset para `url`, o undefined si no se puede transformar (el <img> usa solo src). */
export function cdnSrcset(url, widths = WIDTHS) {
  if (!canTransform(url)) return undefined;
  return widths.map((w) => `${cdnImage(url, w)} ${w}w`).join(", ");
}

/**
 * `sizes` de la portada en la página del evento: todo el ancho en móvil y como máximo el contenedor
 * (1080 px) en desktop. Es el mismo en todos los diseños (banner, póster, compacto) para que la precarga
 * de EventMetaTags.astro coincida con el <img> y no se descargue dos veces.
 */
export const EVENT_COVER_SIZES = "(min-width: 1080px) 1080px, 100vw";
