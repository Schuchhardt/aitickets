// Atribución de la difusión automática (historias con DM): la persona toca el botón del DM (?ref=ig-story-dm), mira la
// página y compra más tarde en otra pestaña, sin el ref en la URL. La compra debe llevar ref=ig-story-dm para que la
// venta cuente en la serie (event_orders.ref → attributedSales). Modelo: último toque por evento, 7 días
// (src/lib/attribution.js). Sin BD: página del evento con datos fijos y la compra interceptada en el navegador.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { waitForIsland } from "./env";
import { FIXTURE_ROUTE, TICKETS } from "./fixtures/event-scenarios.mjs";

const SCENARIO = "poster-una-entrada";

async function prepare(context: BrowserContext) {
  const sent: any[] = [];
  await context.route(/google-analytics\.com|googletagmanager\.com/, (route) => route.abort());
  await context.route("**/api/events/visit", (route) => route.fulfill({ status: 204 }));
  await context.route("**/api/purchase-ticket", async (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: { turnstileSiteKey: "" } });
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: { paymentLink: "/terms#webpay-e2e" } });
  });
  return sent;
}

async function open(page: Page, search: string) {
  const response = await page.goto(`${FIXTURE_ROUTE}/${SCENARIO}${search}`);
  expect(response?.status(), "el servidor debe levantarse con E2E_FIXTURES=1 (playwright.config.ts)").toBe(200);
  await page.addStyleTag({ content: "astro-dev-toolbar{display:none!important}" });
  await waitForIsland(page, '[data-testid="event-action-card"]');
}

async function buy(page: Page) {
  await open(page, "?checkout=1");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("resv-step-buyer")).toBeVisible();
  await dialog.getByTestId("pay-qty").getByRole("button", { name: `Agregar una entrada ${TICKETS.general.ticket_name}`, exact: true }).click();
  await dialog.getByLabel("Nombre y apellido").fill("Bea Soto");
  await dialog.getByLabel("Email").fill("bea.e2e@gmail.com");
  await dialog.getByTestId("resv-terms-checkbox").check();
  await dialog.getByTestId("resv-pay-button").click();
}

test("llega por el DM de la historia y compra después en otra pestaña: la compra lleva ref=ig-story-dm", async ({ context }) => {
  const sent = await prepare(context);
  const fromDm = await context.newPage();
  await open(fromDm, "?ref=ig-story-dm");
  await fromDm.close();

  const later = await context.newPage();
  await buy(later);
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].ref).toBe("ig-story-dm");
});

test("un link posterior de otro canal (último toque) se lleva la compra", async ({ context }) => {
  const sent = await prepare(context);
  const fromDm = await context.newPage();
  await open(fromDm, "?ref=ig-story-dm");
  const fromWhatsapp = await context.newPage();
  await open(fromWhatsapp, "?utm_source=whatsapp&utm_medium=social");

  const later = await context.newPage();
  await buy(later);
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].ref).toBeUndefined();
  expect(sent[0].utm).toMatchObject({ source: "whatsapp", medium: "social" });
});

test("sin toque guardado la compra no lleva ref", async ({ context }) => {
  const sent = await prepare(context);
  const page = await context.newPage();
  await buy(page);
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].ref).toBeUndefined();
});
