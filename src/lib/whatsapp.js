// Links a WhatsApp de AI Tickets (wa.me con texto prellenado).
// PUBLIC_WHATSAPP_NUMBER es el número del bot de Kapso (solo dígitos con código de país, p. ej. 56912345678).
// Sin él, los botones del bot no se muestran y el contacto comercial usa el número de ventas de siempre.

export const BOT_WHATSAPP_NUMBER = String(import.meta.env.PUBLIC_WHATSAPP_NUMBER || "").replace(/\D/g, "");
export const SALES_WHATSAPP_NUMBER = BOT_WHATSAPP_NUMBER || "56982347140";

export function whatsappUrl(number, text = "") {
  const digits = String(number || "").replace(/\D/g, "");
  if (!digits) return "";
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** Mensaje inicial para consultar por un evento: incluye el link, que el bot usa para identificarlo. */
export function eventWhatsappText(event) {
  const url = event?.slug ? `https://aitickets.cl/eventos/${encodeURIComponent(event.slug)}` : "";
  return `Hola, tengo una consulta sobre el evento ${event?.name || ""}${url ? `: ${url}` : ""}`.trim();
}
