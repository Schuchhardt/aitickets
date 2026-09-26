// Checkout real de Stripe en MODO PRUEBA. Se omite salvo que:
//   - STRIPE_SECRET_KEY sea una clave sk_test_ (y el servidor tenga PAYMENT_PROVIDERS=flow,stripe),
//   - E2E_REAL_EVENT_SLUG apunte a un evento con entradas pagadas a la venta,
//   - haya BD (E2E_DB=1 o E2E_BASE_URL).
// Crea una orden 'pending' en la BD del servidor bajo prueba (expira sola). Nunca uses claves live.
import { expect, test } from "@playwright/test";
import { HAS_DB } from "./env";

const key = process.env.STRIPE_SECRET_KEY || "";
const slug = process.env.E2E_REAL_EVENT_SLUG || "";

test.skip(!key.startsWith("sk_test_") || !slug || !HAS_DB, "Requiere STRIPE_SECRET_KEY=sk_test_..., E2E_REAL_EVENT_SLUG y BD.");

test("llega a checkout.stripe.com con el medio de pago Stripe", async ({ page }) => {
  await page.goto(`/eventos/${slug}?comprar=1`);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("resv-step-tickets")).toBeVisible();
  await dialog.getByRole("button", { name: "Añadir entrada" }).first().click();
  await dialog.getByRole("button", { name: "continuar" }).click();

  await dialog.getByPlaceholder("Nombre*").fill("Prueba");
  await dialog.getByPlaceholder("Apellidos*").fill("E2E");
  await dialog.getByPlaceholder("Correo electrónico*").fill("e2e-stripe@example.com");
  await dialog.getByPlaceholder("Confirmar correo electrónico*").fill("e2e-stripe@example.com");
  await dialog.getByTestId("resv-terms-checkbox").check();
  await dialog.getByRole("button", { name: "continuar" }).click();

  await expect(dialog.getByTestId("resv-step-payment")).toBeVisible();
  await dialog.getByTestId("resv-provider-stripe").click();
  await dialog.getByTestId("resv-pay-button").click();
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
});
