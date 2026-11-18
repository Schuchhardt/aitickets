import * as Sentry from "@sentry/astro";

const CHUNK_ERROR_RE =
  /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i;

Sentry.init({
  dsn: "https://130bc6424ac41369ead9aca4a51363b4@o86040.ingest.us.sentry.io/4510110385897472",
  // No enviar headers, cookies ni IP de usuarios (datos personales) a Sentry.
  // https://docs.sentry.io/platforms/javascript/guides/astro/configuration/options/#sendDefaultPii
  sendDefaultPii: false,
  // Solo en el build de producción: en `astro dev` / `netlify dev` los errores locales (p. ej. el servidor
  // de Edge Functions de Netlify que no levanta) no deben llegar a Sentry.
  enabled: import.meta.env.PROD,
  // Chunks de un deploy anterior que ya no existen: ChunkReload (src/components/ChunkReload.astro) recarga la
  // página una vez y marca window.__chunkReloading. Ese error (y los demás chunks que fallen en esa misma
  // carga) ya está resuelto con la recarga: no se reporta. Si después de recargar sigue fallando, sí llega.
  beforeSend(event) {
    if (typeof window !== "undefined" && window.__chunkReloading) {
      const message = event.exception?.values?.[0]?.value || "";
      if (CHUNK_ERROR_RE.test(message)) return null;
    }
    return event;
  },
});