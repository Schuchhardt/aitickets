// Bitácora de uso del panel de productores: constantes y saneamiento de textos compartidos entre el rastreador del
// navegador (src/lib/producerActivityClient.js) y el servidor que lo recibe (src/lib/producerActivity.ts).
// El servidor vuelve a sanear todo: nunca confía en lo que manda el navegador.

/** Endpoint que recibe los lotes del navegador (src/pages/api/dashboard/journal.ts). */
export const ACTIVITY_ENDPOINT = "/api/dashboard/journal";

/** Tipos que puede mandar el navegador. page_view lo registra el servidor al renderizar el layout del panel. */
export const CLIENT_ACTIVITY_TYPES = [
  "page_time",
  "click",
  "rage_click",
  "dead_click",
  "form_start",
  "form_submit",
  "navigation",
  "api_call",
  "api_error",
  "js_error",
  "ui_message",
  "custom",
];

/** Máximo de hechos por lote (el navegador corta la cola en lotes de este tamaño). */
export const MAX_BATCH_EVENTS = 50;

const EMAIL_RE = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/gi;
const URL_RE = /\bhttps?:\/\/([^/\s?#"'<>]+)[^\s"'<>]*/gi;
// RUT con o sin puntos (12.345.678-9, 12345678-K)
const RUT_RE = /\b\d{1,2}(?:\.\d{3}){2}-[\dkK]\b|\b\d{7,8}-[\dkK]\b/g;
// Teléfonos chilenos (+56 9 1234 5678, 912345678) y cualquier número internacional con +
const PHONE_RE = /(?:\+56\s?)?\b9\s?\d{4}\s?\d{4}\b|\+\d[\d\s-]{7,14}\d/g;
// Tokens, llaves (aitk_…), uuids e ids largos
const TOKEN_RE = /\b[A-Za-z0-9_-]*(?:\d[A-Za-z_-]|[A-Za-z_-]\d)[A-Za-z0-9_-]{18,}\b/g;
// Números de cuenta o tarjeta (9 o más dígitos seguidos); los montos con puntos ($1.250.000) se conservan
const LONG_NUMBER_RE = /\b\d{9,}\b/g;

/**
 * Texto apto para la bitácora: sin correos, RUT, teléfonos, tokens ni números largos; URLs reducidas a su host;
 * espacios colapsados y cortado a `max` caracteres. Devuelve "" si no queda nada.
 */
export function redactText(value, max = 160) {
  if (value == null) return "";
  let text = String(value)
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  text = text
    .replace(URL_RE, (_m, host) => `${host}/…`)
    .replace(EMAIL_RE, "[correo]")
    .replace(RUT_RE, "[rut]")
    .replace(PHONE_RE, "[teléfono]")
    .replace(TOKEN_RE, "[id]")
    .replace(LONG_NUMBER_RE, "[número]");
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…` : text;
}
