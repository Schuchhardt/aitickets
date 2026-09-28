// /precios: la calculadora usa la misma regla que el checkout (cargo por servicio 10% + IVA 19% del cargo, redondeados).
import { expect, test } from "@playwright/test";
import { waitForIsland } from "./env";

test("la calculadora actualiza los totales", async ({ page }) => {
  const response = await page.goto("/precios");
  expect(response?.status()).toBe(200);

  const price = page.getByTestId("fee-calc-input");
  const qty = page.getByTestId("fee-calc-qty");
  const result = page.getByTestId("fee-calc-result");
  await expect(price).toBeVisible();

  // La calculadora hidrata con client:visible: primero hay que verla
  await page.getByTestId("fee-calc-input").scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="fee-calc-input"]');

  // Valor inicial: ejemplo de la página ($8.000 → cargo $800 + IVA $152 = $8.952)
  await expect(result).toHaveAttribute("data-buyer-total", "8952");

  await price.fill("20000");
  await expect(result).toHaveAttribute("data-price", "20000");
  await expect(result).toHaveAttribute("data-fee", "2000");
  await expect(result).toHaveAttribute("data-fee-iva", "380");
  await expect(result).toHaveAttribute("data-buyer-total", "22380");
  await expect(result).toContainText("$22.380");

  await qty.fill("50");
  await expect(result).toHaveAttribute("data-producer-total", "1000000");

  // Redondeo a pesos
  await price.fill("9995");
  await expect(result).toHaveAttribute("data-fee", "1000");
  await expect(result).toHaveAttribute("data-fee-iva", "190");
  await expect(result).toHaveAttribute("data-buyer-total", "11185");

  // Evento gratis: sin cargo
  await price.fill("0");
  await expect(result).toHaveAttribute("data-fee", "0");
  await expect(result).toHaveAttribute("data-fee-iva", "0");
  await expect(result).toContainText("Evento gratuito");
});

test("acepta precios escritos con puntos y signo peso", async ({ page }) => {
  await page.goto("/precios");
  const result = page.getByTestId("fee-calc-result");
  // La calculadora hidrata con client:visible: primero hay que verla
  await page.getByTestId("fee-calc-input").scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="fee-calc-input"]');
  await page.getByTestId("fee-calc-input").fill("$15.000");
  await expect(result).toHaveAttribute("data-price", "15000");
  await expect(result).toHaveAttribute("data-buyer-total", "16785");
});
