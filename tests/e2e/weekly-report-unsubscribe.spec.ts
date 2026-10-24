// Baja del reporte semanal a productores: la página renderiza, un GET nunca da de baja y un token inválido da error.
// Nunca se usa un token válido (escribiría una baja en la BD).
import { expect, test } from "@playwright/test";

test("GET /reporte-semanal/baja sin token pide usar el enlace del correo", async ({ page }) => {
  const response = await page.goto("/reporte-semanal/baja");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Enlace incompleto");
  await expect(page.getByTestId("reporte-semanal-baja")).toHaveCount(0);
});

test("un token inválido muestra el error sin botón", async ({ page }) => {
  await page.goto("/reporte-semanal/baja?t=token-invalido");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("No pudimos procesar tu solicitud");
  await expect(page.getByTestId("reporte-semanal-baja")).toHaveCount(0);
});

test("one-click (RFC 8058) con token inválido responde 400", async ({ request }) => {
  const res = await request.post("/api/reporte-semanal/baja?t=token-invalido", {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    data: "List-Unsubscribe=One-Click",
  });
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain("inválido");
});

test("GET al endpoint de baja no actúa: redirige a la página de confirmación", async ({ request }) => {
  const res = await request.get("/api/reporte-semanal/baja?t=abc", { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers()["location"]).toBe("/reporte-semanal/baja?t=abc");
});
