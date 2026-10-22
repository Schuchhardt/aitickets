// Compra simulada en el evento demo con el checkout rediseñado (sheet de 2 pasos: Elegir → Pagar), sin llamar
// a la API de compra. Necesita la fila del evento demo en la BD (ver tests/e2e/env.ts).
import { expect, test } from "@playwright/test";
import { DEMO_EVENT_SLUG, HAS_DB, NO_DB_REASON, waitForIsland } from "./env";

test.skip(!HAS_DB, NO_DB_REASON);

/** Abre el checkout: con la card en desktop; en mobile con la barra inferior (aparece al pasar el lugar). */
async function openCheckout(page: import("@playwright/test").Page) {
  // La barra de herramientas de `astro dev` tapa el pie del bottom sheet en mobile
  await page.addStyleTag({ content: "astro-dev-toolbar{display:none!important}" });
  await waitForIsland(page, '[data-testid="buy-button"]');
  const card = page.getByTestId("buy-button").filter({ visible: true });
  if (await card.count()) {
    await card.first().click();
    return;
  }
  await page.mouse.wheel(0, 900);
  await page.getByTestId("mobile-sticky-bar").getByRole("button").click();
}

test("elegir entradas, datos, no retracto y pago simulado", async ({ page }) => {
  const purchaseCalls: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && /\/api\/purchase-ticket/.test(req.url())) purchaseCalls.push(req.url());
    if (/flow\.cl/.test(req.url())) purchaseCalls.push(req.url());
  });

  const response = await page.goto(`/eventos/${DEMO_EVENT_SLUG}`);
  expect(response?.status(), "el evento demo debe existir y estar publicado").toBe(200);
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);

  await openCheckout(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Demostración");
  await expect(page).toHaveURL(/checkout=1/);

  // Paso 1: entradas (si el evento tiene un solo tipo, el sheet abre directo en "Pagar" y la cantidad se elige ahí:
  // en mobile no hay otro lugar donde elegirla)
  const step1 = dialog.getByTestId("resv-step-tickets");
  if (await step1.isVisible()) {
    await dialog.getByRole("button", { name: /^Agregar una entrada/ }).first().click();
    await dialog.getByTestId("resv-pay-button").click();
  } else {
    await dialog.getByTestId("pay-qty").getByRole("button", { name: /^Agregar una entrada/ }).click();
    await expect(page).toHaveURL(/entradas=\d+(%3A|:)2/);
  }

  // Paso 2: datos + casilla de no retracto (sin ella no se puede pagar)
  await expect(dialog.getByTestId("resv-step-buyer")).toBeVisible();
  await expect(page).toHaveURL(/paso=2/);
  // La demo no valida códigos de descuento (no hay compra real)
  await expect(dialog.getByText("¿Tienes un código de descuento?")).toHaveCount(0);
  await dialog.getByLabel("Nombre y apellido").fill("Ana Pérez");
  await dialog.getByLabel("Email").fill("ana.e2e@gmial.com");
  await dialog.getByRole("button", { name: "ana.e2e@gmail.com" }).click();
  await expect(dialog.getByLabel("Email")).toHaveValue("ana.e2e@gmail.com");

  const pay = dialog.getByTestId("resv-pay-button");
  await expect(pay).toContainText("Simular pago");
  await pay.click();
  await expect(dialog.locator(".ev-error", { hasText: "Marca esta casilla para continuar." })).toBeVisible();
  await dialog.getByTestId("resv-terms-checkbox").check();
  await pay.click();

  await expect(dialog.getByTestId("resv-demo-result")).toBeVisible();
  await expect(dialog.getByTestId("resv-demo-result")).toContainText("no se creó ninguna orden");
  expect(purchaseCalls).toEqual([]);

  // Esc cierra el sheet y limpia la URL
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).not.toHaveURL(/checkout=1/);
});

test("?comprar=1 abre el checkout automáticamente", async ({ page }) => {
  await page.goto(`/eventos/${DEMO_EVENT_SLUG}?comprar=1`);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).not.toHaveURL(/comprar=1/);
});

test("el botón atrás del navegador vuelve del paso 2 al 1 y luego cierra", async ({ page }) => {
  await page.goto(`/eventos/${DEMO_EVENT_SLUG}`);
  await openCheckout(page);
  const dialog = page.getByRole("dialog");
  const step1 = dialog.getByTestId("resv-step-tickets");
  test.skip(!(await step1.isVisible()), "el evento demo tiene un solo tipo de entrada");
  await dialog.getByRole("button", { name: /^Agregar una entrada/ }).first().click();
  await dialog.getByTestId("resv-pay-button").click();
  await expect(dialog.getByTestId("resv-step-buyer")).toBeVisible();
  await page.goBack();
  await expect(dialog.getByTestId("resv-step-tickets")).toBeVisible();
  await page.goBack();
  await expect(dialog).toHaveCount(0);
});
