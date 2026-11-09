// Reglas para guardar una publicación en redes, comunes a create_social_post (API de productores) y al panel
// (/api/promote/posts/create): imágenes alojadas en AI Tickets (Storage de Supabase) y fecha de programación válida y al
// menos 5 minutos en el futuro. Antes el panel aceptaba cualquier URL de imagen y cualquier texto como fecha.
import { serverEnv } from "../pages/api/_lib/server-utils";

export const MIN_SCHEDULE_LEAD_MS = 5 * 60 * 1000;

export type SocialPostInputCheck = { ok: true; scheduledFor: string | null } | { ok: false; field: "image_urls" | "scheduled_for"; message: string };

export function checkSocialPostInput(
    { imageUrls, scheduledFor }: { imageUrls: unknown; scheduledFor: unknown },
    now = Date.now(),
): SocialPostInputCheck {
    const images = Array.isArray(imageUrls) ? imageUrls : [];
    if (images.some((u) => typeof u !== "string" || !/^https:\/\//.test(u))) {
        return { ok: false, field: "image_urls", message: "Las imágenes deben ser URLs https." };
    }
    const storageBase = serverEnv("SUPABASE_URL")?.replace(/\/+$/, "");
    if (storageBase && images.some((u: string) => !u.startsWith(`${storageBase}/storage/v1/object/public/`))) {
        return { ok: false, field: "image_urls", message: "Las imágenes deben estar alojadas en AI Tickets: súbelas o genéralas antes." };
    }
    if (scheduledFor == null || scheduledFor === "") return { ok: true, scheduledFor: null };
    const when = new Date(String(scheduledFor));
    if (Number.isNaN(when.getTime())) return { ok: false, field: "scheduled_for", message: "La fecha de programación no es válida." };
    if (when.getTime() < now + MIN_SCHEDULE_LEAD_MS) {
        return { ok: false, field: "scheduled_for", message: "La fecha de programación debe ser al menos 5 minutos en el futuro." };
    }
    return { ok: true, scheduledFor: when.toISOString() };
}
