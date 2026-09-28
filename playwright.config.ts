// E2E con Playwright. SOLO contra un servidor local: nunca producción ni deploy previews
// (comparten la base de datos de producción). La CI no corre e2e.
//
// Modos:
//   npm run test:e2e
//     Levanta `npm run dev` en 127.0.0.1:E2E_PORT (4329 por defecto) con una base de datos FALSA
//     (SUPABASE_URL apunta a un puerto cerrado) y todas las integraciones apagadas. Las páginas que no
//     necesitan BD (legales, /precios, /o/demo, baja) se prueban; las que sí la necesitan se omiten.
//   E2E_DB=1 npm run test:e2e
//     Usa las credenciales del .env local (evento demo real). OJO: el .env del dueño apunta a la BD de
//     producción; la página del evento lee datos y registra una visita. Úsalo a conciencia.
//   E2E_BASE_URL=http://localhost:8888 npm run test:e2e
//     Contra un `netlify dev` (o `npm run dev`) que ya levantaste tú. Debe ser localhost.
import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// Secretos efímeros por corrida (solo para netlify dev local; nunca valores fijos en el repo)
const e2eSecret = () => randomBytes(24).toString("hex");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);
const externalBaseUrl = process.env.E2E_BASE_URL?.trim() || "";
if (externalBaseUrl) {
  const host = new URL(externalBaseUrl).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `E2E_BASE_URL=${externalBaseUrl} no es local. Los e2e solo corren contra netlify dev / npm run dev ` +
        "(producción y los deploy previews comparten la base de datos de producción)."
    );
  }
}

const port = Number(process.env.E2E_PORT || 4329);
const baseURL = externalBaseUrl || `http://127.0.0.1:${port}`;
const useEnvDb = process.env.E2E_DB === "1";

// Entorno del servidor de desarrollo en modo sin BD. Un valor definido en process.env tiene prioridad
// sobre el .env (Astro lee process.env primero), así que el .env local nunca se usa para estas claves.
const offlineEnv: Record<string, string> = {
  SUPABASE_URL: "http://127.0.0.1:9",
  SUPABASE_SERVICE_ROLE_KEY: "e2e-dummy-service-role",
  SUPABASE_ANON_KEY: "",
  SITE_URL: baseURL,
  INTERNAL_API_SECRET: "e2e-internal-secret",
  MAILGUN_API_KEY: "",
  MAILGUN_DOMAIN: "",
  TURNSTILE_SITE_KEY: "",
  TURNSTILE_SECRET_KEY: "",
  PUBLIC_TURNSTILE_SITE_KEY: "",
  FLOW_API_KEY: "",
  FLOW_SECRET_KEY: "",
  FLOW_BASE_URL: "",
  ANTHROPIC_API_KEY: "",
  OPENAI_API_KEY: "",
  SLACK_WEBHOOK_URL: "",
  SLACK_OUTREACH_WEBHOOK_URL: "",
  OUTREACH_ENABLED: "false",
  OUTREACH_DRY_RUN: "true",
  OUTREACH_UNSUB_SECRET: e2eSecret(),
  LEAD_TOKEN_SECRET: e2eSecret(),
  EMAIL_VERIFY_SECRET: e2eSecret(),
  INSTANTLY_API_KEY: "",
  NETLIFY_AUTH_TOKEN: "",
  DOMAIN_CHECKS_DISABLED: "true",
  PUBLIC_SENTRY_DSN: "",
  SENTRY_DSN: "",
  SENTRY_AUTH_TOKEN: "",
};

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    locale: "es-CL",
    timezoneId: "America/Santiago",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: `npm run dev -- --port ${port} --host 127.0.0.1`,
        url: `${baseURL}/terms`,
        // Nunca reutilizar un servidor ajeno: podría estar usando el .env con la BD de producción.
        reuseExistingServer: false,
        timeout: 180_000,
        stdout: "ignore",
        // Con BD falsa el servidor registra muchos "fetch failed" esperados; E2E_DEBUG=1 los muestra.
        stderr: process.env.E2E_DEBUG === "1" ? "pipe" : "ignore",
        env: useEnvDb ? { SITE_URL: baseURL } : offlineEnv,
      },
});
