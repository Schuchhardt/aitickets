// "Comprar" desde un sitio de productor con dominio propio lleva a aitickets.cl/o/<slug>/eventos/<slug>#comprar
// (purchaseUrlFor en src/lib/sites.ts). Va en el fragmento para no crear otra URL del evento que Google rastree
// ("Página alternativa con etiqueta canónica"); ?comprar=1 sigue funcionando para los enlaces antiguos.
// Sin BD: la página real del evento con datos fijos (tests/e2e/fixtures).
import { expect, test } from "@playwright/test";
import { waitForIsland } from "./env";
import { FIXTURE_ROUTE } from "./fixtures/event-scenarios.mjs";

for (const suffix of ["#comprar", "?comprar=1"]) {
  test(`${suffix} abre el checkout y se quita de la URL`, async ({ page }) => {
    await page.route(/google-analytics\.com|googletagmanager\.com/, (route) => route.abort());
    await page.route("**/api/events/visit", (route) => route.fulfill({ status: 204 }));
    const response = await page.goto(`${FIXTURE_ROUTE}/poster-una-entrada${suffix}`);
    expect(response?.status(), "el servidor debe levantarse con E2E_FIXTURES=1 (playwright.config.ts)").toBe(200);
    await waitForIsland(page, '[data-testid="event-action-card"]');
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).not.toHaveURL(/comprar/);
  });
}
