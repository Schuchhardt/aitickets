// Datos extra al comprar (events.checkout_fields, CheckoutExtras.vue): nombre y correo de cada asistente, preguntas al
// inscribirse y RUT y razón social de la empresa (con su aclaración de que el comprobante no es boleta ni factura); y
// una mesa para 4 (people_per_ticket) que pide un asistente por QR.
// Sin BD: la página real del evento con datos fijos (tests/e2e/fixtures). La compra se intercepta en el navegador y se
// revisa lo que se enviaría a /api/purchase-ticket.
import { expect, test, type Page } from "@playwright/test";
import { waitForIsland } from "./env";
import { FIXTURE_ROUTE, TICKETS } from "./fixtures/event-scenarios.mjs";

async function openCheckout(page: Page, scenario: string) {
  await page.route(/google-analytics\.com|googletagmanager\.com/, (route) => route.abort());
  await page.route("**/api/events/visit", (route) => route.fulfill({ status: 204 }));
  const response = await page.goto(`${FIXTURE_ROUTE}/${scenario}?checkout=1`);
  expect(response?.status(), "el servidor debe levantarse con E2E_FIXTURES=1 (playwright.config.ts)").toBe(200);
  await page.addStyleTag({ content: "astro-dev-toolbar{display:none!important}" });
  await waitForIsland(page, '[data-testid="event-action-card"]');
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("resv-step-buyer")).toBeVisible();
  return dialog;
}

async function interceptPurchase(page: Page) {
  const sent: any[] = [];
  await page.route("**/api/purchase-ticket", async (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: { turnstileSiteKey: "" } });
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: { paymentLink: "/terms#webpay-e2e" } });
  });
  return sent;
}

test("pide el asistente de cada entrada, las preguntas y los datos de empresa, y los manda al comprar", async ({ page }) => {
  const sent = await interceptPurchase(page);
  const dialog = await openCheckout(page, "datos-al-comprar");
  const qty = dialog.getByTestId("pay-qty");
  await qty.getByRole("button", { name: `Agregar una entrada ${TICKETS.general.ticket_name}`, exact: true }).click();

  await dialog.getByLabel("Nombre y apellido").fill("Bea Soto");
  await dialog.getByLabel("Email").fill("bea.e2e@gmail.com");
  await dialog.getByTestId("resv-terms-checkbox").check();

  const holders = dialog.getByTestId("checkout-holders");
  await expect(holders.getByTestId("holder-name")).toHaveCount(2);
  // Nombre obligatorio de la segunda entrada
  await dialog.getByTestId("resv-pay-button").click();
  await expect(holders.getByRole("alert")).toContainText("entrada 2");
  await holders.getByTestId("holder-name").nth(1).fill("Ana Pérez");
  await holders.getByTestId("holder-email").nth(1).fill("ana.e2e@gmail.com");

  // Pregunta obligatoria
  await dialog.getByTestId("resv-pay-button").click();
  const questions = dialog.getByTestId("checkout-questions");
  await expect(questions.getByRole("alert")).toContainText("Nivel");
  await questions.getByLabel("Nivel").selectOption("Avanzado");
  await questions.getByRole("radio", { name: "Sí" }).click();

  // Empresa: RUT con dígito verificador malo
  const company = dialog.getByTestId("checkout-company");
  await company.getByRole("button", { name: "¿Compras para una empresa?" }).click();
  await expect(company.getByTestId("company-note")).toContainText("no es boleta ni factura");
  await company.getByTestId("company-rut").fill("77.893.286-4");
  await company.getByTestId("company-name").fill("Acme SpA");
  await dialog.getByTestId("resv-pay-button").click();
  await expect(company.getByRole("alert")).toContainText("dígito verificador");
  await company.getByTestId("company-rut").fill("778932865");

  await dialog.getByTestId("resv-pay-button").click();
  await page.waitForURL(/#webpay-e2e$/);
  expect(sent).toHaveLength(1);
  expect(sent[0].holders).toEqual([
    { ticket_id: TICKETS.general.id, name: "", email: "" },
    { ticket_id: TICKETS.general.id, name: "Ana Pérez", email: "ana.e2e@gmail.com" },
  ]);
  expect(sent[0].answers).toEqual({ nivel: "Avanzado", auto: "Sí" });
  // El RUT se formatea al salir del campo
  expect(sent[0].company).toEqual({ rut: "77.893.286-5", name: "Acme SpA" });
});

test("una mesa para 4 pide un asistente por invitado", async ({ page }) => {
  const sent = await interceptPurchase(page);
  const dialog = await openCheckout(page, "mesa-para-cuatro");
  const holders = dialog.getByTestId("checkout-holders");
  await expect(holders.getByTestId("holder-name")).toHaveCount(4);
  await expect(holders).toContainText("Mesa VIP · invitado 2 de 4");

  await dialog.getByLabel("Nombre y apellido").fill("Bea Soto");
  await dialog.getByLabel("Email").fill("bea.e2e@gmail.com");
  await holders.getByTestId("holder-name").nth(3).fill("Caro");
  await dialog.getByTestId("resv-terms-checkbox").check();
  await dialog.getByTestId("resv-pay-button").click();
  await page.waitForURL(/#webpay-e2e$/);
  expect(sent[0].tickets).toEqual([{ id: TICKETS.table.id, quantity: 1 }]);
  expect(sent[0].holders).toHaveLength(4);
  expect(sent[0].holders[3]).toMatchObject({ ticket_id: TICKETS.table.id, name: "Caro" });
  // Sin datos de empresa ni preguntas configuradas
  expect(sent[0].company).toBeUndefined();
  expect(sent[0].answers).toBeUndefined();
});

test("preguntas por persona: con una entrada las responde quien compra; con dos, una por cada asistente", async ({ page }) => {
  const sent = await interceptPurchase(page);
  const dialog = await openCheckout(page, "preguntas-por-persona");
  await dialog.getByLabel("Nombre y apellido").fill("Bea Soto");
  await dialog.getByLabel("Email").fill("bea.e2e@gmail.com");
  await dialog.getByTestId("resv-terms-checkbox").check();

  // Una entrada: sin bloque de asistentes; la talla va junto a la pregunta por compra
  const questions = dialog.getByTestId("checkout-questions");
  await expect(dialog.getByTestId("checkout-holders")).toHaveCount(0);
  await expect(questions.getByLabel("Talla de polera")).toBeVisible();
  await expect(questions.getByLabel("¿Cómo supiste del taller? (opcional)")).toBeVisible();

  // Dos entradas: la talla se pide por cada persona
  await dialog.getByTestId("pay-qty").getByRole("button", { name: `Agregar una entrada ${TICKETS.general.ticket_name}`, exact: true }).click();
  const holders = dialog.getByTestId("checkout-holders");
  await expect(holders.getByTestId("holder-questions")).toHaveCount(2);
  await expect(questions.getByLabel("Talla de polera")).toHaveCount(0);
  await holders.getByTestId("holder-questions").nth(0).getByLabel("Talla de polera").selectOption("M");
  await holders.getByTestId("holder-name").nth(1).fill("Ana Pérez");
  await dialog.getByTestId("resv-pay-button").click();
  await expect(holders.getByRole("alert")).toHaveText('Responde "Talla de polera" (entrada 2).');
  await holders.getByTestId("holder-questions").nth(1).getByLabel("Talla de polera").selectOption("S");
  await questions.getByLabel("¿Cómo supiste del taller? (opcional)").fill("Instagram");

  await dialog.getByTestId("resv-pay-button").click();
  await page.waitForURL(/#webpay-e2e$/);
  expect(sent[0].holders).toEqual([
    { ticket_id: TICKETS.general.id, name: "", email: "", answers: { talla: "M" } },
    { ticket_id: TICKETS.general.id, name: "Ana Pérez", email: "", answers: { talla: "S" } },
  ]);
  expect(sent[0].answers).toEqual({ como: "Instagram" });
});

test("invitar por correo: del invitado solo se pide el correo; quien compra completa lo suyo", async ({ page }) => {
  const sent = await interceptPurchase(page);
  const dialog = await openCheckout(page, "invitar-por-correo");
  await dialog.getByTestId("pay-qty").getByRole("button", { name: `Agregar una entrada ${TICKETS.general.ticket_name}`, exact: true }).click();
  await dialog.getByLabel("Nombre y apellido").fill("Bea Soto");
  await dialog.getByLabel("Email").fill("bea.e2e@gmail.com");
  await dialog.getByTestId("resv-terms-checkbox").check();

  const holders = dialog.getByTestId("checkout-holders");
  await expect(holders.getByTestId("holders-help")).toContainText("Escribe el correo de cada invitado");
  // Las preguntas por persona solo para quien compra; el invitado las completa desde su correo
  await expect(holders.getByTestId("holder-questions")).toHaveCount(1);
  await expect(holders.getByTestId("holder-invite-note")).toHaveText("Completa sus datos desde el correo.");
  await expect(holders.getByTestId("holder-name").nth(1)).toHaveAttribute("placeholder", "Nombre (opcional)");

  await holders.getByTestId("holder-questions").getByLabel("Talla de polera").selectOption("L");
  await dialog.getByTestId("resv-pay-button").click();
  await expect(holders.getByRole("alert")).toContainText("correo de la entrada 2");
  await holders.getByTestId("holder-email").nth(1).fill("ana.e2e@gmail.com");

  await dialog.getByTestId("resv-pay-button").click();
  await page.waitForURL(/#webpay-e2e$/);
  expect(sent[0].holders).toEqual([
    { ticket_id: TICKETS.general.id, name: "", email: "", answers: { talla: "L" } },
    { ticket_id: TICKETS.general.id, name: "", email: "ana.e2e@gmail.com" },
  ]);
});
