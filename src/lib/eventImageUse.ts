// Qué se hace con una imagen ya alojada: dejarla como portada del evento (events.image_url) o como foto para celular
// de la portada ancha (events.cover_mobile_url). Solo servidor. Lo usan upload_image / generate_image del MCP
// (set_as_cover, set_as_mobile_cover) y el link de subida sin sesión (/api/images/upload-link).
import { saveCoverMobileUrl } from "./eventCoverMobile";
import { normalizePageSettings } from "./eventPageSettings";

export type EventImageUse = "cover" | "mobile_cover";

export class EventImageUseError extends Error {
    kind: "invalid" | "unavailable" | "not_found";
    constructor(kind: "invalid" | "unavailable" | "not_found", message: string) {
        super(message);
        this.kind = kind;
    }
}

export const MOBILE_COVER_NEEDS_COVER = "La foto para celular acompaña a la imagen principal: primero sube la portada del evento.";

type EventRow = { id: number; image_url: string | null; page_settings?: unknown };

/** Evento de la organización con lo que hace falta para decidir (page_settings puede no existir sin su migración). */
async function loadEvent(supabase: any, orgId: number | string, eventId: number): Promise<EventRow | null> {
    const read = (columns: string) => supabase.from("events").select(columns).eq("id", eventId).eq("organization_id", orgId).maybeSingle();
    let { data, error } = await read("id, image_url, page_settings");
    if (error?.code === "42703") ({ data, error } = await read("id, image_url"));
    if (error) throw error;
    return (data as EventRow) || null;
}

/**
 * ¿Se puede aplicar una imagen con ese destino? Se llama ANTES de alojar o generar nada. Lanza EventImageUseError si
 * el evento no es de la organización o, para la foto para celular, si no tiene imagen principal.
 */
export async function assertCanUseEventImage(supabase: any, orgId: number | string, eventId: number, use: EventImageUse): Promise<void> {
    const event = await loadEvent(supabase, orgId, eventId);
    if (!event) throw new EventImageUseError("not_found", "Evento no encontrado.");
    if (use === "mobile_cover" && !event.image_url) throw new EventImageUseError("invalid", MOBILE_COVER_NEEDS_COVER);
}

/**
 * Aplica la imagen al evento. Devuelve avisos para quien la subió (p. ej. el diseño no es Portada ancha, así que la
 * foto para celular todavía no se ve). Lanza EventImageUseError si no se puede.
 */
export async function applyEventImage(supabase: any, orgId: number | string, eventId: number, use: EventImageUse, url: string): Promise<{ warnings: string[] }> {
    const event = await loadEvent(supabase, orgId, eventId);
    if (!event) throw new EventImageUseError("not_found", "Evento no encontrado.");
    if (use === "cover") {
        const { error } = await supabase.from("events").update({ image_url: url }).eq("id", eventId).eq("organization_id", orgId);
        if (error) throw error;
        return { warnings: [] };
    }
    if (!event.image_url) throw new EventImageUseError("invalid", MOBILE_COVER_NEEDS_COVER);
    const saved = await saveCoverMobileUrl(supabase, eventId, orgId, url);
    if (!saved) throw new EventImageUseError("unavailable", "La foto para celular estará disponible después del próximo deploy.");
    const layout = normalizePageSettings(event.page_settings).layout;
    return {
        warnings:
            layout === "banner"
                ? []
                : [`La foto para celular solo se usa con el diseño Portada ancha (page_layout = banner); el diseño actual es ${layout}.`],
    };
}
