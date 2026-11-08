// Utilidades de los e2e con base real local (playwright.stack.config.ts): sembrar organizaciones y miembros por rol en
// el stack (Auth real + public.users vía el trigger handle_new_user), iniciar sesión y leer el buzón de correos.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import pg from "pg";

export type Role = "producer" | "admin" | "finance" | "editor" | "validator" | "viewer";
export const ROLES: Role[] = ["producer", "admin", "finance", "editor", "validator", "viewer"];
/** Contraseña de las cuentas sembradas, generada en cada corrida (nada con forma de credencial queda en el repo). */
export const PASSWORD = newPassword();

export function newPassword() {
  return `e2e-${randomBytes(12).toString("base64url")}`;
}

const SUPABASE_URL = () => process.env.E2E_STACK_SUPABASE_URL as string;
const SERVICE_KEY = () => process.env.E2E_STACK_SERVICE_ROLE_KEY as string;

/** Correo único por test (el stack se reutiliza entre corridas). */
export const uniqueEmail = (prefix: string) => `${prefix}-${Date.now().toString(36)}${randomBytes(3).toString("hex")}@e2e.test`;

/** Consulta la base del stack (solo local: lo verifica playwright.stack.config.ts). */
export async function sql<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: process.env.E2E_STACK_DB_URL });
  await client.connect();
  try {
    return (await client.query(text, params)).rows as T[];
  } finally {
    await client.end();
  }
}

async function authAdmin(path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`${SUPABASE_URL()}/auth/v1${path}`, {
    method: init.method || "GET",
    headers: { apikey: SERVICE_KEY(), Authorization: `Bearer ${SERVICE_KEY()}`, "Content-Type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Auth ${path} ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

/** Cuenta de Auth (como la crea AI Tickets). El trigger handle_new_user crea su fila en public.users sin organización. */
export async function createAuthUser(email: string, { name = "Persona E2E", password = PASSWORD, confirmed = true, aitickets = true } = {}) {
  const user = await authAdmin("/admin/users", {
    method: "POST",
    body: { email, password, email_confirm: confirmed, user_metadata: { full_name: name }, app_metadata: aitickets ? { app: "aitickets" } : {} },
  });
  return user as { id: string; email: string };
}

/** Organización verificada (sin onboarding pendiente) con su dueño (producer) ya listo para iniciar sesión. */
export async function createOrganization(name = "Productora E2E") {
  const ownerEmail = uniqueEmail("owner");
  const [org] = await sql<{ id: number }>(
    `INSERT INTO public.organizations (public_name, email, email_verified_at, email_verified_for, terms_version, terms_accepted_at, onboarding_pending)
     VALUES ($1, $2, now(), $2, 'e2e', now(), false) RETURNING id`,
    [name, ownerEmail],
  );
  const owner = await addMember(org.id, "producer", { email: ownerEmail, name: "Dueña E2E" });
  return { orgId: Number(org.id), owner };
}

/** Miembro activo de la organización con el rol pedido (cuenta de Auth + fila completada como lo hace la app). */
export async function addMember(orgId: number, role: Role, { email = uniqueEmail(role), name = `Miembro ${role}` } = {}) {
  const auth = await createAuthUser(email, { name });
  const [row] = await sql<{ id: number }>(
    `UPDATE public.users SET organization_id = $1, role = $2, name = $3, active = true WHERE auth_user_id = $4 RETURNING id`,
    [orgId, role, name, auth.id],
  );
  expect(row, "el trigger handle_new_user debió crear la fila").toBeTruthy();
  return { id: Number(row.id), email, password: PASSWORD, role, authUserId: auth.id };
}

export async function createEvent(orgId: number, name = "Evento E2E") {
  const slug = `evento-e2e-${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  const [ev] = await sql<{ id: number }>(
    `INSERT INTO public.events (name, title, slug, organization_id, status) VALUES ($1, $1, $2, $3, 'draft') RETURNING id`,
    [name, slug, orgId],
  );
  return { id: Number(ev.id), slug };
}

/** Inicia sesión por la API real (/api/auth/login): las cookies quedan en el contexto del navegador. */
export async function login(target: Page | APIRequestContext, email: string, password = PASSWORD) {
  const request = "request" in target ? target.request : target;
  const res = await request.post("/api/auth/login", { data: { email, password } });
  expect(res.status(), `login de ${email}: ${await res.text()}`).toBe(200);
}

export type OutboxMail = { id: string; to: string[]; subject: string; html?: string; text?: string; sent_at: string };

/** Correos enviados a `to` (más nuevo primero), leídos del buzón local (MAIL_OUTBOX_DIR). */
export function outbox(to: string): OutboxMail[] {
  const dir = process.env.E2E_STACK_OUTBOX as string;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as OutboxMail)
    .filter((m) => (Array.isArray(m.to) ? m.to : [m.to]).some((r) => String(r).toLowerCase().includes(to.toLowerCase())))
    .sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1));
}

/** Espera un correo para `to` cuyo asunto calce y devuelve el primer link que calce con `linkPattern`. */
export async function waitForMailLink(to: string, subject: RegExp, linkPattern: RegExp) {
  let mail: OutboxMail | undefined;
  await expect.poll(() => (mail = outbox(to).find((m) => subject.test(m.subject))), { message: `correo "${subject}" para ${to}`, timeout: 20_000 }).toBeTruthy();
  const body = `${mail!.text || ""}\n${mail!.html || ""}`;
  const match = body.match(linkPattern);
  expect(match, `link ${linkPattern} en el correo "${mail!.subject}"`).toBeTruthy();
  return { mail: mail!, link: match![0].replace(/&amp;/g, "&") };
}

/** Ruta relativa de un link absoluto del correo (el servidor de e2e está en baseURL). */
export const pathOf = (link: string) => {
  const u = new URL(link);
  return u.pathname + u.search;
};
