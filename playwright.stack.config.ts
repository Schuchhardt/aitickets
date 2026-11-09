// E2E con base de datos REAL pero local (tests/e2e/stack): el panel del organizador y de su equipo de punta a punta
// (registro, verificación, onboarding, invitaciones, roles), contra el stack de Supabase de tests/e2e/stack
// (Postgres 15.8 + Auth + PostgREST en Docker, con db/schema.sql + TODAS las migraciones). Nunca producción.
//
//   node tests/e2e/stack/setup.mjs                 levanta el stack y escribe tests/e2e/stack/.stack.env
//   npx playwright test -c playwright.stack.config.ts
//   node tests/e2e/stack/setup.mjs --down          lo baja y borra sus datos
//
// Los correos no salen: el mailer los escribe en MAIL_OUTBOX_DIR (netlify/lib/mailer.mjs) y los tests leen de ahí el
// link de verificación o de la invitación. Turnstile usa las claves de prueba de Cloudflare (siempre aprueban).
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { offlineEnv } from "./playwright.config";

const STACK_ENV_FILE = resolve("tests/e2e/stack/.stack.env");
if (!existsSync(STACK_ENV_FILE)) {
  throw new Error("Falta tests/e2e/stack/.stack.env: corre primero `node tests/e2e/stack/setup.mjs` (requiere Docker).");
}
const stackEnv = Object.fromEntries(
  readFileSync(STACK_ENV_FILE, "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
for (const key of ["SUPABASE_URL", "E2E_STACK_DB_URL"]) {
  const host = new URL(stackEnv[key]).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`${key}=${stackEnv[key]} no es local: el stack de e2e nunca apunta a una base remota.`);
  }
}

const port = Number(process.env.E2E_STACK_PORT || 4330);
const baseURL = `http://127.0.0.1:${port}`;
export const MAIL_OUTBOX_DIR = resolve("test-results/stack-outbox");
// Variables para los tests (helpers.ts) en el proceso de Playwright
process.env.E2E_STACK_DB_URL = stackEnv.E2E_STACK_DB_URL;
process.env.E2E_STACK_SUPABASE_URL = stackEnv.SUPABASE_URL;
process.env.E2E_STACK_SERVICE_ROLE_KEY = stackEnv.SUPABASE_SERVICE_ROLE_KEY;
process.env.E2E_STACK_OUTBOX = MAIL_OUTBOX_DIR;
if (!process.env.E2E_STACK_KEEP_OUTBOX) rmSync(MAIL_OUTBOX_DIR, { recursive: true, force: true });
mkdirSync(MAIL_OUTBOX_DIR, { recursive: true });

const secret = () => randomBytes(24).toString("hex");

export default defineConfig({
  testDir: "tests/e2e/stack",
  globalSetup: "./tests/e2e/stack/global-setup.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report-stack" }]] : "list",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    locale: "es-CL",
    timezoneId: "America/Santiago",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${port} --host 127.0.0.1`,
    url: `${baseURL}/terms`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: process.env.E2E_DEBUG === "1" ? "pipe" : "ignore",
    env: {
      ...offlineEnv,
      SITE_URL: baseURL,
      SUPABASE_URL: stackEnv.SUPABASE_URL,
      SUPABASE_ANON_KEY: stackEnv.SUPABASE_ANON_KEY,
      PUBLIC_SUPABASE_ANON_KEY: stackEnv.PUBLIC_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: stackEnv.SUPABASE_SERVICE_ROLE_KEY,
      // Claves de prueba de Cloudflare Turnstile: el widget y el servidor aprueban siempre
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      MAIL_OUTBOX_DIR,
      RESEND_API_KEY: secret(), // no se usa: con MAIL_OUTBOX_DIR los correos van al buzón
      EMAIL_VERIFY_SECRET: secret(),
      REVIEW_TOKEN_SECRET: secret(),
      INTERNAL_API_SECRET: secret(),
      E2E_FIXTURES: "",
    },
  },
});
