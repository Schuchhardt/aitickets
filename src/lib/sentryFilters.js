// Filtros del SDK de Sentry en el navegador (sentry.client.config.js).
//
// Chunk viejo después de un deploy: una pestaña abierta (o una página restaurada con "atrás") pide un módulo con un
// hash que ya no existe. src/components/ChunkReload.astro recarga la página UNA vez y marca
// window.__aitChunkReloading; el handler global de Sentry igual captura la promesa rechazada antes de que la recarga
// lo arregle. Ese evento no es un bug que vea el usuario: se descarta. Si el error vuelve después de la recarga (la
// marca ya no está), sí se reporta.

/** Mensajes de "no se pudo cargar un módulo", por navegador (los mismos que ChunkReload.astro). */
export const STALE_CHUNK_RE = /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i;

function errorMessage(event, hint) {
  const original = hint && hint.originalException;
  if (original && typeof original === "object" && original.message) return String(original.message);
  if (typeof original === "string") return original;
  const values = (event && event.exception && event.exception.values) || [];
  return values.map((v) => v && v.value).filter(Boolean).join(" ") || (event && event.message) || "";
}

/** beforeSend: null descarta el evento. `win` es inyectable para los tests. */
export function dropRecoveredStaleChunk(event, hint, win = typeof window !== "undefined" ? window : undefined) {
  if (win && win.__aitChunkReloading && STALE_CHUNK_RE.test(errorMessage(event, hint))) return null;
  return event;
}
