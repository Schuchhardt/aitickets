// Sitio de productor de demostración (/o/demo): se sirve sin BD. Grilla de eventos, formulario de
// contacto (validación y envío simulado) y la simulación de host de tenant en dev (?__site=demo).
import { expect, test } from "@playwright/test";
import { waitForIsland } from "./env";

test("/o/demo muestra el sitio con la grilla de eventos", async ({ page }) => {
  const response = await page.goto("/o/demo");
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId("site-event-grid")).toBeVisible();
  await expect(page.locator("body")).toContainText("Productora Demo");
  // El sitio demo nunca se indexa
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
});

test("el formulario de contacto valida y simula el envío en el sitio demo", async ({ page }) => {
  const response = await page.goto("/o/demo/contacto");
  expect(response?.status()).toBe(200);
  const form = page.getByTestId("site-contact-form");
  await expect(form).toBeVisible();
  await waitForIsland(page, '[data-testid="site-contact-form"]');
  const submit = page.getByTestId("site-contact-submit");

  await submit.click();
  await expect(form.getByRole("alert")).toHaveText("Escribe tu nombre.");

  await form.locator('input[name="name"]').fill("Ana Pérez");
  await form.locator('input[name="email"]').fill("ana@ejemplo");
  await submit.click();
  await expect(form.getByRole("alert")).toHaveText("Escribe un correo válido.");

  await form.locator('input[name="email"]').fill("ana@ejemplo.cl");
  await form.locator('textarea[name="message"]').fill("Hola");
  await submit.click();
  await expect(form.getByRole("alert")).toHaveText("El mensaje debe tener al menos 10 caracteres.");

  await form.locator('textarea[name="message"]').fill("Hola, quisiera cotizar una función privada para nuestro colegio.");
  // El servidor exige al menos 3 s desde que se abrió el formulario (antispam)
  await page.waitForTimeout(3200);
  await submit.click();
  await expect(page.getByRole("status")).toContainText("sitio de demostración");
});

test("la API de contacto rechaza envíos sin datos válidos", async ({ request }) => {
  const res = await request.post("/api/sites/contact", { data: { siteSlug: "demo", name: "", email: "x", message: "", hp: "", startedAt: 0 } });
  expect(res.status()).toBe(400);
});

test("simulación de host de tenant en dev: ?__site=demo", async ({ page, request }) => {
  const response = await page.goto("/o/_host/?__site=demo");
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId("site-event-grid")).toBeVisible();

  // Rutas de la app principal redirigen a aitickets.cl (SITE_URL)
  const dash = await request.get("/o/_host/dashboard?__site=demo", { maxRedirects: 0 });
  expect(dash.status()).toBe(302);
  expect(dash.headers()["location"]).toMatch(/\/dashboard$/);

  // Rutas desconocidas en un host de tenant: 404
  const unknown = await request.get("/o/_host/no-existe?__site=demo", { maxRedirects: 0 });
  expect(unknown.status()).toBe(404);
});

test("un sitio inexistente responde 404", async ({ request }) => {
  const res = await request.get("/o/esta-productora-no-existe-e2e");
  expect(res.status()).toBe(404);
});
