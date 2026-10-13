// POST /api/sites/upload (multipart: file, kind?) → { url }
// Imágenes del sitio (logo, portada, banners, imagen para redes). Mismo bucket y reglas que
// /api/events/upload-image: JPG/PNG/WEBP/GIF (sin SVG), máx. 5 MB, ruta sites/<orgId>/, optimizada.
import type { APIRoute } from "astro";
import { storeOptimizedImage } from "../../../lib/imageStorage";
import { json, requireSiteAdmin } from "../../dashboard/sitio/_lib/site-admin";

export const prerender = false;

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const KINDS = new Set(["logo", "hero", "banner", "og"]);

// Firma de bytes: el Content-Type lo decide el cliente, así que se verifica el contenido real
function sniffType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  return null;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const auth = await requireSiteAdmin({ cookies });
  if (!auth.ok) return auth.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ message: "Solicitud inválida" }, 400);
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return json({ message: "No se proporcionó ningún archivo" }, 400);
  if (file.size > MAX_BYTES) return json({ message: "La imagen no debe superar los 5MB" }, 400);
  if (!ALLOWED_TYPES[file.type]) return json({ message: "Solo se permiten imágenes JPG, PNG, WEBP o GIF" }, 400);

  const kindRaw = String(form.get("kind") || "banner");
  const kind = KINDS.has(kindRaw) ? kindRaw : "banner";

  const buffer = Buffer.from(await file.arrayBuffer());
  const realType = sniffType(buffer);
  if (!realType || !ALLOWED_TYPES[realType]) return json({ message: "El archivo no es una imagen válida" }, 400);

  let publicUrl: string;
  try {
    // Logos y banners: lado mayor acotado; los PNG con transparencia se mantienen PNG (src/lib/imageOptimize.ts)
    ({ url: publicUrl } = await storeOptimizedImage(buffer, realType, {
      pathPrefix: `sites/${auth.orgId}/${kind}`,
      // og: imagen para compartir el sitio; 1200 px la deja liviana para WhatsApp
      maxSize: kind === "logo" ? 800 : kind === "og" ? 1200 : 2000,
    }));
  } catch (err: any) {
    console.error("sites/upload:", err?.message || err);
    return json({ message: "Error al subir la imagen" }, 500);
  }
  return json({ url: publicUrl, message: "Imagen subida correctamente" });
};
