// Compra simulada en el evento demo: todo el flujo de reserva, sin llamar a la API de compra.
// Necesita la fila del evento demo en la BD (ver tests/e2e/env.ts).
import { expect, test } from "@playwright/test";
import { DEMO_EVENT_SLUG, HAS_DB, NO_DB_REASON, waitForIsland } from "./env";

test.skip(!HAS_DB, NO_DB_REASON);

test("reserva, datos del comprador, términos y confirmación simulada", async ({ page }) => {
  const purchaseCalls: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && /\/api\/purchase-ticket/.test(req.url())) purchaseCalls.push(req.url());
    if (/flow\.cl/.test(req.url())) purchaseCalls.push(req.url());
  });

  const response = await page.goto(`/eventos/${DEMO_EVENT_SLUG}`);
  expect(response?.status(), "el evento demo debe existir y estar publicado").toBe(200);
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);

  await waitForIsland(page, 'button[aria-label="Comprar entrada"]');
  await page.getByRole("button", { name: "Comprar entrada" }).filter({ visible: true }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Modo demostración");

  // Paso 1: entradas
  await expect(dialog.getByTestId("resv-step-tickets")).toBeVisible();
  await dialog.getByRole("button", { name: "Añadir entrada" }).first().click();
  // La demo no valida códigos de descuento (no hay compra real)
  await expect(dialog.getByTestId("resv-discount-input")).toHaveCount(0);
  await dialog.getByRole("button", { name: "continuar" }).click();

  // Paso 2: comprador + términos (sin términos no se puede continuar)
  await expect(dialog.getByTestId("resv-step-buyer")).toBeVisible();
  await dialog.getByPlaceholder("Nombre*").fill("Ana");
  await dialog.getByPlaceholder("Apellidos*").fill("Pérez");
  await dialog.getByPlaceholder("Correo electrónico*").fill("ana.e2e@example.com");
  await dialog.getByPlaceholder("Confirmar correo electrónico*").fill("ana.e2e@example.com");
  const next = dialog.getByRole("button", { name: "continuar" });
  await expect(next).toBeDisabled();
  await dialog.getByTestId("resv-terms-checkbox").check();
  await expect(next).toBeEnabled();
  await next.click();

  // Paso 3: pago simulado
  await expect(dialog.getByTestId("resv-step-payment")).toBeVisible();
  const pay = dialog.getByTestId("resv-pay-button");
  await expect(pay).toContainText("Simular pago");
  await pay.click();

  await expect(dialog.getByTestId("resv-demo-result")).toBeVisible();
  await expect(dialog.getByTestId("resv-demo-result")).toContainText("no se creó ninguna orden");
  expect(purchaseCalls).toEqual([]);
});

test("?comprar=1 abre el modal de compra automáticamente", async ({ page }) => {
  await page.goto(`/eventos/${DEMO_EVENT_SLUG}?comprar=1`);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).not.toHaveURL(/comprar=1/);
});
