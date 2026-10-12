import * as Sentry from "@sentry/astro";

Sentry.init({
  dsn: "https://130bc6424ac41369ead9aca4a51363b4@o86040.ingest.us.sentry.io/4510110385897472",
  // No enviar headers, cookies ni IP de usuarios (datos personales) a Sentry.
  // https://docs.sentry.io/platforms/javascript/guides/astro/configuration/options/#sendDefaultPii
  sendDefaultPii: false,
  // Solo en el build de producción: en `astro dev` / `netlify dev` los errores locales (p. ej. el servidor
  // de Edge Functions de Netlify que no levanta) no deben llegar a Sentry.
  enabled: import.meta.env.PROD,
});