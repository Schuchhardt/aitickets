// Guardar y quitar el video de un evento (events.cover_video / events.gallery_video, src/lib/eventVideo.ts).
// Lo usan el panel (/api/events/video, después de que el navegador sube el archivo a Storage) y la API de
// productores (set_event_video, que descarga el video desde una URL). Al reemplazar o quitar un video se borra el
// archivo anterior (solo se usa aquí y pesa mucho). Con slot "cover", si el evento no tiene imagen, el póster del
// video pasa a ser su imagen (cartelera, al compartir, correos).
import type { SupabaseClient } from "@supabase/supabase-js";
import { EVENT_VIDEO_SLOTS, normalizeEventVideo, type EventVideo, type EventVideoSlot } from "./eventVideo";
import { removeStoredVideo } from "./videoStorage";

export const EVENT_VIDEO_UNAVAILABLE = "Los videos del evento aún no están disponibles. Intenta en unos minutos.";

/** La migración de videos aún no está aplicada (deploy previews comparten la BD de producción). */
export class EventVideoUnavailableError extends Error {
    constructor() {
        super(EVENT_VIDEO_UNAVAILABLE);
    }
}

const isMissingColumn = (error: any) => error?.code === "42703" || error?.code === "PGRST204";

/** Lo que se guarda en la columna (la forma pública la arma normalizeEventVideo). */
export interface StoredEventVideo {
    url: string;
    poster_url: string | null;
    width: number | null;
    height: number | null;
    duration: number | null;
    mime: string;
    bytes: number | null;
}

/** Video actual del slot y la imagen del evento. available=false si la columna aún no existe. */
export async function loadEventVideoState(supabase: SupabaseClient, eventId: number, slot: EventVideoSlot) {
    const column = EVENT_VIDEO_SLOTS[slot];
    const { data, error } = await supabase.from("events").select(`image_url, ${column}`).eq("id", eventId).maybeSingle();
    if (error) {
        if (!isMissingColumn(error)) throw error;
        return { available: false, video: null as EventVideo | null, raw: null, imageUrl: null as string | null };
    }
    const raw = (data as any)?.[column] ?? null;
    return { available: true, video: normalizeEventVideo(raw), raw, imageUrl: ((data as any)?.image_url as string | null) || null };
}

/** Guarda el video del slot (reemplaza y borra el anterior). Devuelve la forma pública y la imagen del evento. */
export async function saveEventVideo(
    supabase: SupabaseClient,
    { eventId, organizationId, slot, video }: { eventId: number; organizationId: number; slot: EventVideoSlot; video: StoredEventVideo },
): Promise<{ video: EventVideo | null; image_url: string | null; image_from_poster: boolean }> {
    const current = await loadEventVideoState(supabase, eventId, slot);
    if (!current.available) throw new EventVideoUnavailableError();
    const value = { ...video, updated_at: new Date().toISOString() };
    const setsImage = slot === "cover" && !current.imageUrl && Boolean(video.poster_url);
    const patch: Record<string, unknown> = { [EVENT_VIDEO_SLOTS[slot]]: value, ...(setsImage ? { image_url: video.poster_url } : {}) };
    const { error } = await supabase.from("events").update(patch).eq("id", eventId).eq("organization_id", organizationId);
    if (error) {
        if (isMissingColumn(error)) throw new EventVideoUnavailableError();
        throw error;
    }
    if (current.video && current.video.url !== video.url) await removeStoredVideo(current.video.url, organizationId, eventId);
    return { video: normalizeEventVideo(value), image_url: setsImage ? video.poster_url : current.imageUrl, image_from_poster: setsImage };
}

/** Quita el video del slot y borra su archivo. removed=false si no había. */
export async function clearEventVideo(
    supabase: SupabaseClient,
    { eventId, organizationId, slot }: { eventId: number; organizationId: number; slot: EventVideoSlot },
): Promise<{ removed: boolean }> {
    const current = await loadEventVideoState(supabase, eventId, slot);
    if (!current.available) throw new EventVideoUnavailableError();
    if (!current.raw) return { removed: false };
    const { error } = await supabase.from("events").update({ [EVENT_VIDEO_SLOTS[slot]]: null }).eq("id", eventId).eq("organization_id", organizationId);
    if (error) throw error;
    if (current.video) await removeStoredVideo(current.video.url, organizationId, eventId);
    return { removed: true };
}
