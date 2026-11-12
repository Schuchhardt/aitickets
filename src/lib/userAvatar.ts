// Foto de perfil de los usuarios del panel (public.users.avatar_url). Solo servidor.
// Se guarda siempre una copia propia en el bucket "Events" (user-avatars/<user_id>-…), optimizada a 512 px:
// - subida desde /dashboard/profile (POST /api/users/avatar con el archivo), o
// - copiada desde la foto de su cuenta de Google (al registrarse con Google, o con "Usar mi foto de Google").
//   No se enlaza la URL de googleusercontent.com: caduca y Google limita las descargas (429).
import type { User } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "./auth-helpers";
import { IMAGE_EXT, sniffImageType } from "./imageOptimize";
import { IMAGE_BUCKET, storeOptimizedImage } from "./imageStorage";

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_SIZE = 512;
const AVATAR_FOLDER = "user-avatars";
const GOOGLE_FETCH_TIMEOUT_MS = 8000;

/**
 * URL de la foto de Google del usuario (solo si entró con Google y la URL es de googleusercontent.com, para no
 * descargar URLs arbitrarias desde el servidor), pedida en 512 px. null si no tiene.
 */
export function googlePhotoUrl(user: Pick<User, "user_metadata" | "app_metadata" | "identities"> | null | undefined): string | null {
    if (!user) return null;
    const providers = new Set<string>([
        ...(((user.app_metadata as any)?.providers as string[] | undefined) || []),
        ...((user.identities || []).map((i) => i.provider)),
    ]);
    if (!providers.has("google")) return null;
    const meta = (user.user_metadata || {}) as Record<string, unknown>;
    const raw = [meta.avatar_url, meta.picture].find((v) => typeof v === "string" && v) as string | undefined;
    if (!raw) return null;
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    if (url.protocol !== "https:" || !/(^|\.)googleusercontent\.com$/i.test(url.hostname)) return null;
    // .../photo.jpg=s96-c → =s512-c (si no trae tamaño, se deja tal cual)
    url.pathname = url.pathname.replace(/=s\d+(-c)?$/, `=s${AVATAR_SIZE}-c`);
    return url.toString();
}

export type AvatarResult = { ok: true; url: string } | { ok: false; status: number; message: string };

/** Valida, optimiza y guarda la imagen como foto de perfil del usuario. */
export async function saveAvatarImage(userId: number, buffer: Buffer): Promise<AvatarResult> {
    if (buffer.length > AVATAR_MAX_BYTES) return { ok: false, status: 400, message: "La imagen no debe superar los 5MB" };
    const contentType = sniffImageType(buffer);
    if (!contentType || !IMAGE_EXT[contentType]) {
        return { ok: false, status: 400, message: "Solo se permiten imágenes JPG, PNG, WEBP o GIF" };
    }
    const stored = await storeOptimizedImage(buffer, contentType, { pathPrefix: `${AVATAR_FOLDER}/${userId}`, maxSize: AVATAR_SIZE });
    const update = await setAvatarUrl(userId, stored.url);
    if (!update.ok) {
        await removeStoredAvatar(userId, stored.url);
        return update;
    }
    return { ok: true, url: stored.url };
}

/** Descarga la foto de Google del usuario y la guarda como su foto de perfil. */
export async function importGoogleAvatar(userId: number, authUser: Parameters<typeof googlePhotoUrl>[0]): Promise<AvatarResult> {
    const source = googlePhotoUrl(authUser);
    if (!source) return { ok: false, status: 400, message: "Tu cuenta no tiene una foto de Google" };
    let buffer: Buffer;
    try {
        const res = await fetch(source, { signal: AbortSignal.timeout(GOOGLE_FETCH_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (Number(res.headers.get("content-length") || 0) > AVATAR_MAX_BYTES) throw new Error("demasiado grande");
        buffer = Buffer.from(await res.arrayBuffer());
    } catch (err: any) {
        console.error("importGoogleAvatar:", err?.message || err);
        return { ok: false, status: 502, message: "No pudimos traer tu foto de Google. Intenta de nuevo." };
    }
    return saveAvatarImage(userId, buffer);
}

/** Quita la foto de perfil (vuelve a la inicial). */
export async function clearAvatar(userId: number): Promise<AvatarResult | { ok: true; url: null }> {
    const update = await setAvatarUrl(userId, null);
    return update.ok ? { ok: true, url: null } : update;
}

/** Actualiza avatar_url y borra del bucket la foto anterior (si era nuestra). */
async function setAvatarUrl(userId: number, url: string | null): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
    const supabase = getSupabaseAdmin();
    const { data: prev, error: readError } = await supabase.from("users").select("avatar_url").eq("id", userId).maybeSingle();
    if (readError) {
        console.error("setAvatarUrl (lectura):", readError.message);
        return { ok: false, status: 500, message: "No pudimos guardar tu foto. Intenta de nuevo." };
    }
    const { error } = await supabase.from("users").update({ avatar_url: url, updated_at: new Date().toISOString() }).eq("id", userId);
    if (error) {
        console.error("setAvatarUrl:", error.message);
        return { ok: false, status: 500, message: "No pudimos guardar tu foto. Intenta de nuevo." };
    }
    const previous = (prev as { avatar_url?: string | null } | null)?.avatar_url;
    if (previous && previous !== url) await removeStoredAvatar(userId, previous);
    return { ok: true };
}

/** Borra un archivo de foto del bucket, solo si es de la carpeta de ESTE usuario. Nunca falla. */
async function removeStoredAvatar(userId: number, publicUrl: string) {
    const marker = `/object/public/${IMAGE_BUCKET}/`;
    const at = publicUrl.indexOf(marker);
    if (at < 0) return;
    const path = decodeURIComponent(publicUrl.slice(at + marker.length).split("?")[0]);
    if (!path.startsWith(`${AVATAR_FOLDER}/${userId}-`)) return;
    const { error } = await getSupabaseAdmin().storage.from(IMAGE_BUCKET).remove([path]);
    if (error) console.warn("removeStoredAvatar:", error.message);
}
