// Portada para celular del diseño "Portada ancha" (events.cover_mobile_url, migración 202611180200). Solo servidor.
// Opcional: en pantallas chicas reemplaza a image_url arriba de la página del evento (EventDetail.vue). NULL = se usa
// image_url en todos los tamaños. La cartelera, al compartir y los correos siguen usando image_url.

export const COVER_MOBILE_MAX_LENGTH = 1000;

/** URL https válida o null ("" / null = sin portada para celular). Lanza con un mensaje para el productor si es inválida. */
export function normalizeCoverMobileUrl(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const url = String(value).trim();
    if (!url) return null;
    if (url.length > COVER_MOBILE_MAX_LENGTH || !/^https:\/\/\S+$/i.test(url)) {
        throw new CoverMobileError("La imagen para celular debe ser un link https válido.");
    }
    return url;
}

export class CoverMobileError extends Error {}

const isMissingColumn = (error: any) => ["42703", "PGRST204"].includes(String(error?.code || ""));

/** Lee la portada para celular de un evento de la organización (null sin la migración). */
export async function loadCoverMobileUrl(supabase: any, eventId: number, orgId?: number | string | null): Promise<string | null> {
    let query = supabase.from("events").select("cover_mobile_url").eq("id", eventId);
    if (orgId !== undefined && orgId !== null) query = query.eq("organization_id", orgId);
    const { data, error } = await query.maybeSingle();
    if (error) {
        if (isMissingColumn(error)) return null;
        throw error;
    }
    return (data as any)?.cover_mobile_url || null;
}

/**
 * Guarda la portada para celular. Devuelve false si la columna aún no existe (deploy preview sin migrar) y el valor
 * no era vacío; sin la columna y sin imagen no hay nada que guardar.
 */
export async function saveCoverMobileUrl(supabase: any, eventId: number, orgId: number | string, url: string | null): Promise<boolean> {
    const { error } = await supabase.from("events").update({ cover_mobile_url: url }).eq("id", eventId).eq("organization_id", orgId);
    if (error) {
        if (isMissingColumn(error)) return url === null;
        throw error;
    }
    return true;
}
