// Entradas numeradas (mapa de asientos, src/lib/seatMap.mjs): el comprador elige función, cantidad y asientos en el
// mapa de la sala; los ocupados no se pueden elegir y una entrada de una sección solo calza con asientos de esa
// sección. Sin BD: la página real del evento con datos fijos (tests/e2e/fixtures); /api/events/seats y la compra se
// interceptan en el navegador.
import { expect, test, type Page } from "@playwright/test";
import { waitForIsland } from "./env";
import { FIXTURE_ROUTE } from "./fixtures/event-scenarios.mjs";

const FIRST_FUNCTION = 9200;

async function openCinema(page: Page) {
  const sent: any[] = [];
  await page.route(/google-analytics\.com|googletagmanager\.com/, (route) => route.abort());
  await page.route("**/api/events/visit", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/events/seats**", (route) => route.fulfill({ json: { taken: ["general:A:1", "general:A:2"] } }));
  await page.route("**/api/purchase-ticket", async (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: { turnstileSiteKey: "" } });
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: { paymentLink: "/terms#webpay-e2e" } });
  });
  const response = await page.goto(`${FIXTURE_ROUTE}/cine-numerado?checkout=1`);
  expect(response?.status(), "el servidor debe levantarse con E2E_FIXTURES=1 (playwright.config.ts)").toBe(200);
  await page.addStyleTag({ content: "astro-dev-toolbar{display:none!important}" });
  await waitForIsland(page, '[data-testid="event-action-card"]');
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("resv-step-tickets")).toBeVisible();
  return { dialog, sent };
}

const seat = (page: Page, key: string) => page.getByTestId("seat-picker").locator(`[data-seat="${key}"]`);

test("elige función, cantidad y asientos; los ocupados no se pueden elegir y los asientos viajan en la compra", async ({ page }) => {
  const { dialog, sent } = await openCinema(page);
  const fns = dialog.getByRole("radiogroup", { name: "Fecha y hora" });
  // La segunda función no tiene asientos libres
  await expect(fns.getByRole("radio").nth(1)).toHaveAttribute("aria-disabled", "true");
  await fns.getByRole("radio").first().click();

  await dialog.getByRole("button", { name: "Agregar una entrada General", exact: true }).click();
  await dialog.getByRole("button", { name: "Agregar una entrada General", exact: true }).click();
  const picker = dialog.getByTestId("seat-picker");
  await expect(picker).toBeVisible();
  await expect(picker).toContainText("0 de 2");
  // Sin asientos no se puede continuar
  await expect(dialog.getByTestId("resv-pay-button")).toBeDisabled();

  await expect(seat(page, "general:A:1")).toBeDisabled();
  await seat(page, "general:C:5").click();
  await seat(page, "general:C:6").click();
  await expect(picker).toContainText("2 de 2");
  await expect(picker.getByRole("list", { name: "Asientos elegidos" }).getByRole("listitem")).toHaveText(["General · Fila C · Asiento 5", "General · Fila C · Asiento 6"]);
  // Un tercer clic cambia el asiento más antiguo
  await seat(page, "general:C:7").click();
  await expect(seat(page, "general:C:5")).toHaveAttribute("aria-pressed", "false");
  await expect(seat(page, "general:C:7")).toHaveAttribute("aria-pressed", "true");

  await dialog.getByTestId("resv-pay-button").click();
  await expect(dialog.getByTestId("pay-summary-seats")).toContainText("General · Fila C · Asiento 6, General · Fila C · Asiento 7");
  await dialog.getByLabel("Nombre y apellido").fill("Bea Soto");
  await dialog.getByLabel("Email").fill("bea.e2e@gmail.com");
  await dialog.getByTestId("resv-terms-checkbox").check();
  await dialog.getByTestId("resv-pay-button").click();
  await page.waitForURL(/#webpay-e2e$/);
  expect(sent).toHaveLength(1);
  expect(sent[0].tickets).toEqual([{ id: 9131, quantity: 2 }]);
  expect(sent[0].seats).toEqual({ eventDateId: FIRST_FUNCTION, keys: ["general:C:6", "general:C:7"] });
});

test("una entrada Preferencial solo se puede sentar en la zona preferencial", async ({ page }) => {
  const { dialog } = await openCinema(page);
  await dialog.getByRole("radiogroup", { name: "Fecha y hora" }).getByRole("radio").first().click();
  await dialog.getByRole("button", { name: "Agregar una entrada Preferencial", exact: true }).click();
  await expect(seat(page, "general:C:5")).toBeDisabled();
  await seat(page, "preferencial:J:3").click();
  await expect(dialog.getByTestId("resv-pay-button")).toBeEnabled();
});

test("si alguien tomó el asiento al pagar, vuelve al mapa con el aviso", async ({ page }) => {
  const { dialog } = await openCinema(page);
  await page.unroute("**/api/purchase-ticket");
  await page.route("**/api/purchase-ticket", (route) =>
    route.request().method() !== "POST"
      ? route.fulfill({ json: { turnstileSiteKey: "" } })
      : route.fulfill({ status: 409, json: { code: "SEATS_TAKEN", seats: ["General · Fila C · Asiento 5"], message: "Alguien acaba de tomar General · Fila C · Asiento 5. Elige otro asiento." } }),
  );
  await dialog.getByRole("radiogroup", { name: "Fecha y hora" }).getByRole("radio").first().click();
  await dialog.getByRole("button", { name: "Agregar una entrada General", exact: true }).click();
  await seat(page, "general:C:5").click();
  await dialog.getByTestId("resv-pay-button").click();
  await dialog.getByLabel("Nombre y apellido").fill("Bea Soto");
  await dialog.getByLabel("Email").fill("bea.e2e@gmail.com");
  await dialog.getByTestId("resv-terms-checkbox").check();
  await dialog.getByTestId("resv-pay-button").click();
  const picker = dialog.getByTestId("seat-picker");
  await expect(picker).toContainText("Alguien acaba de tomar General · Fila C · Asiento 5");
  await expect(picker).toContainText("0 de 1");
});
