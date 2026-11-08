// Registro de un organizador de punta a punta con la base real local: formulario → correo de verificación → confirmar →
// nombre de la productora (onboarding) → panel. Valida en la base lo que causó el bug de las organizaciones sin dueño:
// quien crea la organización queda como 'producer' (la fila la crea el trigger handle_new_user y la app la completa).
import { expect, test } from "@playwright/test";
import { waitForIsland } from "../env";
import { PASSWORD, pathOf, sql, uniqueEmail, waitForMailLink } from "./helpers";

test("registro con correo: verificación, onboarding y dueño de la organización", async ({ page }) => {
  const email = uniqueEmail("registro");

  await page.goto("/organizadores/registro");
  await waitForIsland(page, '[data-testid="register-email"]');
  await page.getByTestId("register-email").fill(email);
  await page.getByTestId("register-password").fill(PASSWORD);
  await page.getByTestId("register-terms-checkbox").check();
  // Turnstile con la clave de prueba de Cloudflare: aprueba solo y deja el token en el formulario
  await page.waitForFunction(() => (document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement | null)?.value, null, { timeout: 30_000 });
  await page.getByTestId("register-submit").click();
  await expect(page.getByTestId("register-check-email")).toBeVisible();

  const [created] = await sql(
    `SELECT u.role, u.active, o.onboarding_pending, o.email_verified_at, o.public_name
     FROM public.users u JOIN public.organizations o ON o.id = u.organization_id WHERE u.email = $1`,
    [email],
  );
  expect(created, "el registro debe dejar al usuario con su organización").toMatchObject({ role: "producer", onboarding_pending: true, email_verified_at: null });
  const [auth] = await sql(`SELECT email_confirmed_at, raw_app_meta_data->>'app' AS app FROM auth.users WHERE email = $1`, [email]);
  expect(auth).toMatchObject({ email_confirmed_at: null, app: "aitickets" });

  // Sin verificar no entra
  const blocked = await page.request.post("/api/auth/login", { data: { email, password: PASSWORD } });
  expect(blocked.status()).toBe(403);
  expect((await blocked.json()).code).toBe("email_not_verified");

  const { link } = await waitForMailLink(email, /./, /https?:\/\/[^\s"'<>]+\/organizadores\/verificar\?t=[^\s"'<>]+/);
  await page.goto(pathOf(link));
  await page.getByTestId("verify-email-confirm-form").locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/organizadores\/bienvenida/);

  await page.getByTestId("onboarding-org-name").fill("Productora Registro E2E");
  await page.getByTestId("onboarding-submit").click();
  await expect(page).toHaveURL(/\/dashboard/);

  const [done] = await sql(
    `SELECT u.role, o.onboarding_pending, o.email_verified_at, o.public_name
     FROM public.users u JOIN public.organizations o ON o.id = u.organization_id WHERE u.email = $1`,
    [email],
  );
  expect(done).toMatchObject({ role: "producer", onboarding_pending: false, public_name: "Productora Registro E2E" });
  expect(done.email_verified_at).toBeTruthy();
  const [confirmed] = await sql(`SELECT email_confirmed_at FROM auth.users WHERE email = $1`, [email]);
  expect(confirmed.email_confirmed_at).toBeTruthy();

  // Sin huérfanos: ninguna otra fila sin organización con este correo
  expect(await sql(`SELECT id FROM public.users WHERE lower(email) = lower($1) AND organization_id IS NULL`, [email])).toEqual([]);
});
