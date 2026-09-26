// Baja del outreach: la página renderiza, un GET nunca da de baja y un token inválido da error.
// Nunca se usa un token válido (escribiría una supresión en la BD).
import { expect, test } from "@playwright/test";

test("GET /outreach/baja renderiza sin token", async ({ page }) => {
  const response = await page.goto("/outreach/baja");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Darse de baja");
  await expect(page.locator("body")).toContainText("Chanium LLC");
  await expect(page.getByTestId("baja-confirm")).toHaveCount(0);
});

test("con token muestra la confirmación; un token inválido termina en error", async ({ page }) => {
  await page.goto("/outreach/baja?t=token-invalido");
  const confirm = page.getByTestId("baja-confirm");
  await expect(confirm).toBeVisible();
  await confirm.click();
  await expect(page).toHaveURL(/\/outreach\/baja\?error=1$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("No pudimos procesar la baja");
});

test("one-click (RFC 8058) con token inválido responde 400", async ({ request }) => {
  const res = await request.post("/api/outreach/unsubscribe?t=token-invalido", {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    data: "List-Unsubscribe=One-Click",
  });
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain("inválido");
});

test("GET al endpoint de baja no actúa: redirige a la página de confirmación", async ({ request }) => {
  const res = await request.get("/api/outreach/unsubscribe?t=abc", { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers()["location"]).toBe("/outreach/baja?t=abc");
});
