// "Compartir" y "Añadir al calendario" de la página del evento y del estado de éxito.
import { showSuccess } from "../../lib/toastBus.js";
import { trackEvent } from "../../composables/useGoogleAnalytics.js";

const stripHtml = (html) => String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const toCalDate = (iso) => new Date(iso).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

/** URL pública del evento para compartir (nunca la de una entrada u orden). */
export function eventShareUrl(event, ref = "share") {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://aitickets.cl";
  return `${origin}/eventos/${encodeURIComponent(event?.slug || "")}?ref=${ref}`;
}

/** Abre Google Calendar con la función elegida (o la primera). */
export function addToCalendar(event, fn = null) {
  if (!event) return;
  const first = fn || (event.dates || []).find((d) => d.start_iso);
  const start = first?.start_iso || event.start_date;
  const end = first?.end_iso || event.end_date || start;
  if (!start) return;
  const url = `${window.location.origin}/eventos/${event.slug}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.name || "Evento",
    dates: `${toCalDate(start)}/${toCalDate(end)}`,
    details: `${stripHtml(event.description).slice(0, 500)}\n\n${url}`,
    location: event.location || "",
  });
  trackEvent("add_to_calendar", { event_id: event.id });
  window.open(`https://calendar.google.com/calendar/render?${params}`, "_blank", "noopener");
}

/**
 * Web Share API si existe; si no, copia el link. Devuelve 'shared' | 'copied' | 'fallback'
 * ('fallback' = no se pudo: quien llama abre el modal de compartir).
 */
export async function shareEvent(event, { ref = "share", text } = {}) {
  const url = eventShareUrl(event, ref);
  const data = { title: event?.name || "Evento", text: text || `Mira este evento: ${event?.name}`, url };
  trackEvent("share", { method: "page", content_type: "event", item_id: String(event?.id || "") });
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (err) {
      if (err?.name === "AbortError") return "shared";
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    showSuccess("Link copiado");
    return "copied";
  } catch {
    return "fallback";
  }
}
