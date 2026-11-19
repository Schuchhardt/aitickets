// Logo de la organización (public.organizations.logo_url, migración 202611180100). Solo servidor.
// Se muestra junto al nombre público en la página del evento ("Organiza Dance Studio"). Se guarda una copia propia en
// el bucket "Events" (org-logos/<organization_id>-…), optimizada a 512 px. Mismo patrón que src/lib/userAvatar.ts.
import { getSupabaseAdmin } from "./auth-helpers";
import { purgeEventPages } from "./cdnCache";
import { IMAGE_EXT, sniffImageType } from "./imageOptimize";
import { IMAGE_BUCKET, storeOptimizedImage } from "./imageStorage";

export const LOGO_MAX_BYTES = 5 * 1024 * 1024;
const LOGO_SIZE = 512;
const LOGO_FOLDER = "org-logos";

export type LogoResult = { ok: true; url: string | null } | { ok: false; status: number; message: string };

/** Valida, optimiza y guarda la imagen como logo de la organización. */
export async function saveOrgLogo(orgId: number, buffer: Buffer): Promise<LogoResult> {
    if (buffer.length > LOGO_MAX_BYTES) return { ok: false, status: 400, message: "La imagen no debe superar los 5MB" };
    const contentType = sniffImageType(buffer);
    if (!contentType || !IMAGE_EXT[contentType]) {
        return { ok: false, status: 400, message: "Solo se permiten imágenes JPG, PNG, WEBP o GIF" };
    }
    const stored = await storeOptimizedImage(buffer, contentType, { pathPrefix: `${LOGO_FOLDER}/${orgId}`, maxSize: LOGO_SIZE });
    const update = await setLogoUrl(orgId, stored.url);
    if (!update.ok) {
        await removeStoredLogo(orgId, stored.url);
        return update;
    }
    return { ok: true, url: stored.url };
}

/** Quita el logo (la página del evento vuelve a las iniciales). */
export function clearOrgLogo(orgId: number): Promise<LogoResult> {
    return setLogoUrl(orgId, null);
}

/** Actualiza logo_url, borra del bucket el logo anterior (si era nuestro) y vacía la caché de las páginas de eventos. */
async function setLogoUrl(orgId: number, url: string | null): Promise<LogoResult> {
    const supabase = getSupabaseAdmin();
    const { data: prev, error: readError } = await supabase.from("organizations").select("logo_url").eq("id", orgId).maybeSingle();
    if (readError) {
        console.error("setLogoUrl (lectura):", readError.message);
        return { ok: false, status: 500, message: "No pudimos guardar el logo. Intenta de nuevo." };
    }
    const { error } = await supabase.from("organizations").update({ logo_url: url }).eq("id", orgId);
    if (error) {
        console.error("setLogoUrl:", error.message);
        return { ok: false, status: 500, message: "No pudimos guardar el logo. Intenta de nuevo." };
    }
    const previous = (prev as { logo_url?: string | null } | null)?.logo_url;
    if (previous && previous !== url) await removeStoredLogo(orgId, previous);
    await purgeEventPages();
    return { ok: true, url };
}

/** Borra un archivo de logo del bucket, solo si es de la carpeta de ESTA organización. Nunca falla. */
async function removeStoredLogo(orgId: number, publicUrl: string) {
    const marker = `/object/public/${IMAGE_BUCKET}/`;
    const at = publicUrl.indexOf(marker);
    if (at < 0) return;
    const path = decodeURIComponent(publicUrl.slice(at + marker.length).split("?")[0]);
    if (!path.startsWith(`${LOGO_FOLDER}/${orgId}-`)) return;
    const { error } = await getSupabaseAdmin().storage.from(IMAGE_BUCKET).remove([path]);
    if (error) console.warn("removeStoredLogo:", error.message);
}
