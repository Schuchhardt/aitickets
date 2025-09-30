import * as Sentry from "@sentry/astro";

Sentry.init({
  dsn: "https://130bc6424ac41369ead9aca4a51363b4@o86040.ingest.us.sentry.io/4510110385897472",
  // Adds request headers and IP for users, for more info visit:
  // https://docs.sentry.io/platforms/javascript/guides/astro/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
});