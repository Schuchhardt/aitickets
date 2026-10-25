// Comprar más de una entrada: si el productor no configuró un máximo por compra, siempre se pueden comprar varias
// (hasta 10), en desktop y en mobile (proyectos "chromium" y "mobile" de playwright.config.ts), en todos los
// diseños de la página. Regresión: en mobile, con un solo tipo de entrada, el checkout abría en "Pagar" con 1
// entrada fija y sin forma de cambiarla (la card con el stepper no se muestra en mobile).
// Sin BD: la página real del evento (src/components/EventPage.astro) con datos fijos (tests/e2e/fixtures). La
// compra se intercepta en el navegador y se revisa lo que se enviaría a /api/purchase-ticket.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { waitForIsland } from "./env";
import { FIXTURE_ROUTE, TICKETS } from "./fixtures/event-scenarios.mjs";

type SentTickets = Array<{ id: number; quantity: number }>;

async function openScenario(page: Page, scenario: string, search = "") {
  // Sin terceros ni registro de visitas
  await page.route(/google-analytics\.com|googletagmanager\.com/, (route) => route.abort());
  await page.route("**/api/events/visit", (route) => route.fulfill({ status: 204 }));
  const response = await page.goto(`${FIXTURE_ROUTE}/${scenario}${search}`);
  expect(response?.status(), "el servidor debe levantarse con E2E_FIXTURES=1 (playwright.config.ts)").toBe(200);
  // La barra de herramientas de `astro dev` tapa el pie del bottom sheet en mobile
  await page.addStyleTag({ content: "astro-dev-toolbar{display:none!important}" });
  await waitForIsland(page, '[data-testid="event-action-card"]');
}

/** Intercepta la compra: guarda las entradas que se enviarían y simula la redirección a Webpay. */
async function interceptPurchase(page: Page) {
  const sent: SentTickets[] = [];
  await page.route("**/api/purchase-ticket", async (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: { turnstileSiteKey: "" } });
    sent.push(route.request().postDataJSON().tickets);
    await route.fulfill({ json: { paymentLink: "/terms#webpay-e2e" } });
  });
  return sent;
}

/** Mobile: la card de compra no se muestra; la barra inferior (aparece al pasar el lugar) abre el checkout. */
async function openFromMobileBar(page: Page) {
  await expect(page.getByTestId("event-action-card")).toBeHidden();
  await page.evaluate(() => window.scrollBy(0, 900));
  const bar = page.getByTestId("mobile-sticky-bar");
  await expect(bar).toBeVisible();
  await bar.getByRole("button").click();
}

const addButton = (scope: Locator, ticketName: string) => scope.getByRole("button", { name: `Agregar una entrada ${ticketName}`, exact: true });

async function pay(page: Page, dialog: Locator) {
  await dialog.getByLabel("Nombre y apellido").fill("Ana Pérez");
  await dialog.getByLabel("Email").fill("ana.e2e@gmail.com");
  await dialog.getByTestId("resv-terms-checkbox").check();
  await dialog.getByTestId("resv-pay-button").click();
  await page.waitForURL(/#webpay-e2e$/);
}

const ONE_TICKET = [
  { scenario: "poster-una-entrada", layout: "póster" },
  { scenario: "banner-una-entrada", layout: "portada ancha" },
  { scenario: "compacto-una-entrada", layout: "compacto" },
];

for (const { scenario, layout } of ONE_TICKET) {
  test(`un solo tipo de entrada sin máximo configurado (${layout}): se compran 3`, async ({ page, isMobile }) => {
    const sent = await interceptPurchase(page);
    await openScenario(page, scenario);
    const ticket = TICKETS.general;

    const dialog = page.getByRole("dialog");
    if (isMobile) {
      await openFromMobileBar(page);
    } else {
      // Desktop: el stepper de la card elige la cantidad antes de abrir el checkout
      const card = page.getByTestId("event-action-card");
      await addButton(card, ticket.ticket_name).click();
      await expect(page.getByTestId("buy-button")).toContainText("Comprar 2 entradas");
      await page.getByTestId("buy-button").click();
    }

    // El checkout abre en "Pagar" (no hay paso de elegir entradas) y ahí también se ajusta la cantidad
    await expect(dialog.getByTestId("resv-step-buyer")).toBeVisible();
    const qty = dialog.getByTestId("pay-qty");
    await expect(qty).toBeVisible();
    await expect(qty.getByRole("group")).toHaveText(isMobile ? "1" : "2");
    await addButton(qty, ticket.ticket_name).click();
    if (isMobile) await addButton(qty, ticket.ticket_name).click();

    await expect(qty.getByRole("group")).toHaveText("3");
    await expect(dialog.getByTestId("pay-summary-total")).toContainText("3 entradas");
    await expect(page).toHaveURL(new RegExp(`entradas=${ticket.id}(%3A|:)3`));

    await pay(page, dialog);
    expect(sent).toEqual([[{ id: ticket.id, quantity: 3 }]]);
  });
}

test("sin máximo configurado se pueden comprar hasta 10 (link directo al checkout)", async ({ page }) => {
  const sent = await interceptPurchase(page);
  // Link compartido: ?checkout=1 abre el checkout al cargar, en desktop y en mobile
  await openScenario(page, "poster-una-entrada", "?checkout=1");
  const ticket = TICKETS.general;

  const dialog = page.getByRole("dialog");
  const qty = dialog.getByTestId("pay-qty");
  await expect(qty).toBeVisible();
  const add = addButton(qty, ticket.ticket_name);
  for (let i = 1; i < 10; i++) await add.click();
  await expect(qty.getByRole("group")).toHaveText("10");

  // En el tope el botón queda marcado y avisa el máximo
  await expect(add).toHaveAttribute("aria-disabled", "true");
  await add.click({ force: true });
  await expect(qty.getByRole("status")).toHaveText("Máximo 10 por compra");
  await expect(qty.getByRole("group")).toContainText("10");
  await expect(dialog.getByTestId("pay-summary-total")).toContainText("10 entradas");

  await pay(page, dialog);
  expect(sent).toEqual([[{ id: ticket.id, quantity: 10 }]]);
});

test("varios tipos de entrada sin máximo configurado: se compran 2 General y 3 VIP", async ({ page, isMobile }) => {
  const sent = await interceptPurchase(page);
  await openScenario(page, "varias-entradas");

  if (isMobile) await openFromMobileBar(page);
  else await page.getByTestId("buy-button").click();

  const dialog = page.getByRole("dialog");
  const step1 = dialog.getByTestId("resv-step-tickets");
  await expect(step1).toBeVisible();
  for (let i = 0; i < 2; i++) await addButton(step1, TICKETS.general.ticket_name).click();
  for (let i = 0; i < 3; i++) await addButton(step1, TICKETS.vip.ticket_name).click();
  await dialog.getByTestId("resv-pay-button").click();

  await expect(dialog.getByTestId("resv-step-buyer")).toBeVisible();
  await expect(dialog.getByTestId("pay-summary-total")).toContainText("5 entradas");
  // Con varios tipos la cantidad se elige en el paso 1: en "Pagar" no hay stepper
  await expect(dialog.getByTestId("pay-qty")).toHaveCount(0);

  await pay(page, dialog);
  expect(sent).toHaveLength(1);
  expect([...sent[0]].sort((a, b) => a.id - b.id)).toEqual([
    { id: TICKETS.general.id, quantity: 2 },
    { id: TICKETS.vip.id, quantity: 3 },
  ]);
});

test("con un máximo configurado (3) se respeta ese máximo", async ({ page, isMobile }) => {
  const sent = await interceptPurchase(page);
  await openScenario(page, "maximo-configurado");
  const ticket = TICKETS.generalMax3;

  if (isMobile) {
    await openFromMobileBar(page);
  } else {
    const card = page.getByTestId("event-action-card");
    const cardAdd = addButton(card, ticket.ticket_name);
    await cardAdd.click();
    await cardAdd.click();
    await expect(card.getByRole("group")).toHaveText("3");
    await expect(cardAdd).toHaveAttribute("aria-disabled", "true");
    await page.getByTestId("buy-button").click();
  }

  const dialog = page.getByRole("dialog");
  const qty = dialog.getByTestId("pay-qty");
  const add = addButton(qty, ticket.ticket_name);
  if (isMobile) {
    await expect(qty.getByRole("group")).toHaveText("1");
    await add.click();
    await add.click();
  }
  await expect(qty.getByRole("group")).toHaveText("3");
  await expect(add).toHaveAttribute("aria-disabled", "true");
  // En desktop el checkout entra deslizándose desde la derecha y aquí no hubo clicks normales (que esperan a que
  // quede quieto): el click forzado no espera, así que antes hay que esperar el fin de la animación de entrada
  await expect(dialog).toHaveCSS("transform", "none");
  await add.click({ force: true });
  await expect(qty.getByRole("status")).toHaveText("Máximo 3 por compra");

  await pay(page, dialog);
  expect(sent).toEqual([[{ id: ticket.id, quantity: 3 }]]);
});
