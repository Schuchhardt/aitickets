// /precios: la calculadora usa la misma regla que el checkout (cargo por servicio 8% + IVA 19% del cargo, redondeados).
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

  // Valor inicial: ejemplo de la página ($10.000 → cargo $800 + IVA $152 = $10.952)
  await expect(result).toHaveAttribute("data-buyer-total", "10952");

  // Comparado con Passline: $10.000 < $15.000 → 13% = $11.300; ahorro $348 por entrada, $34.800 cada 100
  const compare = page.getByTestId("fee-calc-compare");
  await expect(compare).toHaveAttribute("data-passline-total", "11300");
  await expect(compare).toHaveAttribute("data-savings", "348");
  await expect(compare).toHaveAttribute("data-savings-100", "34800");
  await expect(compare).toContainText("Passline (13%)");

  await price.fill("20000");
  await expect(result).toHaveAttribute("data-price", "20000");
  await expect(result).toHaveAttribute("data-fee", "1600");
  await expect(result).toHaveAttribute("data-fee-iva", "304");
  await expect(result).toHaveAttribute("data-buyer-total", "21904");
  await expect(result).toContainText("$21.904");

  // $20.000 ≥ $15.000 → Passline 15% = $23.000; ahorro $1.096
  await expect(compare).toHaveAttribute("data-passline-total", "23000");
  await expect(compare).toHaveAttribute("data-savings", "1096");
  await expect(compare).toContainText("Passline (15%)");

  await qty.fill("50");
  await expect(result).toHaveAttribute("data-producer-total", "1000000");

  // Redondeo a pesos
  await price.fill("9994");
  await expect(result).toHaveAttribute("data-fee", "800");
  await expect(result).toHaveAttribute("data-fee-iva", "152");
  await expect(result).toHaveAttribute("data-buyer-total", "10946");

  // Evento gratis: sin cargo
  await price.fill("0");
  await expect(result).toHaveAttribute("data-fee", "0");
  await expect(result).toHaveAttribute("data-fee-iva", "0");
  await expect(result).toContainText("Evento gratuito");
  await expect(compare).toHaveCount(0);
});

test("acepta precios escritos con puntos y signo peso", async ({ page }) => {
  await page.goto("/precios");
  const result = page.getByTestId("fee-calc-result");
  // La calculadora hidrata con client:visible: primero hay que verla
  await page.getByTestId("fee-calc-input").scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="fee-calc-input"]');
  await page.getByTestId("fee-calc-input").fill("$15.000");
  await expect(result).toHaveAttribute("data-price", "15000");
  await expect(result).toHaveAttribute("data-buyer-total", "16428");
});
