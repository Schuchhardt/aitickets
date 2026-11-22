// Vista previa privada de un evento y eventos demo (tests/e2e/fixtures, sin BD): el aviso flotante de la vista previa
// (corto, se va solo a los 5 s, se cierra con la X y se pausa con el mouse encima) y la compra simulada, que recorre el
// flujo del asistente hasta la entrada con un QR de MUESTRA sin llamar a la API de compra. La vista previa tampoco
// manda eventos a GA; el demo suma el registro de productores ("Quiero vender entradas así").
import { expect, test, type Page } from "@playwright/test";
import { captureAnalytics, waitForIsland } from "./env";
import { FIXTURE_ROUTE } from "./fixtures/event-scenarios.mjs";

/** Abre un escenario y registra cualquier compra real (POST a la API) que intente la página. */
async function openPreview(page: Page, scenario: string) {
  const purchases: string[] = [];
  await page.route(/google-analytics\.com|googletagmanager\.com/, (route) => route.abort());
  await page.route("**/api/events/visit", (route) => route.fulfill({ status: 204 }));
  await page.route(/\/api\/(purchase-ticket|discount-code|events\/waitlist|rsvp\/resend)/, (route) => {
    if (route.request().method() === "POST") purchases.push(route.request().url());
    return route.fulfill({ status: 500, json: { message: "no debería llamarse en la vista previa" } });
  });
  const response = await page.goto(`${FIXTURE_ROUTE}/${scenario}`);
  expect(response?.status(), "el servidor debe levantarse con E2E_FIXTURES=1 (playwright.config.ts)").toBe(200);
  await page.addStyleTag({ content: "astro-dev-toolbar{display:none!important}" });
  await waitForIsland(page, '[data-testid="event-action-card"]');
  return purchases;
}

/** Abre el checkout: con la card en desktop; en mobile con la barra inferior (aparece al pasar el lugar). */
async function openCheckout(page: Page) {
  const button = page.getByTestId("buy-button").filter({ visible: true });
  if (await button.count()) {
    await button.first().click();
    return;
  }
  await page.mouse.wheel(0, 900);
  await page.getByTestId("mobile-sticky-bar").getByRole("button").click();
}

const notice = (page: Page) => page.getByTestId("event-preview-banner");

test.describe("aviso de vista previa", () => {
  test("borrador: aviso corto que se va solo a los 5 segundos", async ({ page }) => {
    await openPreview(page, "vista-previa");
    await expect(notice(page)).toBeVisible();
    await expect(notice(page)).toHaveText("Vista previa · Borrador sin publicar. Puedes simular una compra.");
    await expect(notice(page)).toHaveAttribute("role", "status");
    const shownAt = Date.now();
    await expect(notice(page)).toBeHidden({ timeout: 9000 });
    expect(Date.now() - shownAt, "no debe irse antes de ~5 s").toBeGreaterThan(4000);
  });

  test("se cierra con la X", async ({ page }) => {
    await openPreview(page, "vista-previa");
    await page.getByRole("button", { name: "Cerrar aviso" }).click();
    await expect(notice(page)).toHaveCount(0);
  });

  test("con el mouse encima no se va", async ({ page, isMobile }) => {
    test.skip(isMobile, "en mobile no hay hover");
    await openPreview(page, "vista-previa");
    await notice(page).hover();
    await page.waitForTimeout(6500);
    await expect(notice(page)).toBeVisible();
    await page.mouse.move(5, 600);
    await expect(notice(page)).toBeHidden({ timeout: 6000 });
  });

  test("flota sobre la página: al irse no mueve el contenido", async ({ page }) => {
    await openPreview(page, "vista-previa");
    await expect(notice(page)).toHaveCSS("position", "fixed");
    const cover = page.getByTestId("event-cover");
    const before = await cover.boundingBox();
    await page.getByRole("button", { name: "Cerrar aviso" }).click();
    await expect(notice(page)).toHaveCount(0);
    expect((await cover.boundingBox())?.y).toBe(before?.y);
  });

  test("evento publicado: lo dice y lleva a la página pública, sin compra simulada", async ({ page, isMobile }) => {
    const card = page.getByTestId("event-action-card");
    await openPreview(page, "vista-previa-publicada");
    await expect(notice(page)).toContainText("Vista previa · Ya está publicado.");
    await expect(notice(page).getByRole("link", { name: "Ver página pública →" })).toHaveAttribute("href", "/eventos/e2e-vista-previa-publicada");
    if (!isMobile) await expect(card.getByTestId("card-preview-note")).toHaveCount(0);
  });
});

test.describe("compra simulada del borrador", () => {
  test("pagado: elegir, datos, simular el pago y llegar a la entrada con QR de muestra", async ({ page, isMobile }) => {
    await captureAnalytics(page);
    const purchases = await openPreview(page, "vista-previa");
    if (!isMobile) {
      const card = page.getByTestId("event-action-card");
      await expect(card.getByTestId("card-label")).toHaveCount(0); // abre con el precio, como publicado
      await expect(card.getByTestId("card-preview-note")).toHaveText("Vista previa: compra de prueba, no se cobra.");
    }

    await openCheckout(page);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("checkout-preview-note")).toContainText("compra de prueba");
    // Un solo tipo de entrada: abre en "Pagar"; los códigos de descuento no se validan en un borrador
    await expect(dialog.getByTestId("resv-step-buyer")).toBeVisible();
    await expect(dialog.getByText("¿Tienes un código de descuento?")).toHaveCount(0);
    await dialog.getByTestId("pay-qty").getByRole("button", { name: /^Agregar una entrada/ }).click();
    await dialog.getByLabel("Nombre y apellido").fill("Ana Pérez");
    await dialog.getByLabel("Email").fill("ana.e2e@gmail.com");
    await dialog.getByTestId("resv-terms-checkbox").check();

    const pay = dialog.getByTestId("resv-pay-button");
    await expect(pay).toHaveText("Simular pago de $8.762");
    await pay.click();

    const result = dialog.getByTestId("sim-result");
    await expect(result).toBeVisible();
    await expect(result.getByRole("heading", { level: 3 })).toHaveText("¡Listo, Ana! Tus entradas están listas.");
    await expect(result).toContainText("Pago aprobado · $8.762");
    await expect(result).toContainText("ana.e2e@gmail.com");
    const tickets = result.getByTestId("sim-ticket");
    await expect(tickets).toHaveCount(2);
    await expect(tickets.first()).toContainText("General");
    await expect(tickets.first()).toContainText("Concierto de prueba");
    await expect(tickets.first()).toContainText("Ana Pérez");
    await expect(tickets.first()).toContainText("Entrada 1 de 2");
    await expect(tickets.first()).toContainText("Muestra · No válido");
    await expect(tickets.first().getByTestId("sim-qr")).toHaveAttribute("src", /^data:image\/png;base64,/);
    await expect(result).toContainText("Este QR no sirve para entrar.");

    expect(purchases, "la vista previa no crea órdenes").toEqual([]);
    const funnel = await page.evaluate(() => ((window as any).__events || []).map((e: [string]) => e[0]));
    expect(funnel.filter((n: string) => n.startsWith("checkout_") || n === "begin_checkout")).toEqual([]);

    // "Probar otra compra" vuelve al formulario; "Volver al evento" cierra el panel
    await result.getByRole("button", { name: "Probar otra compra" }).click();
    await expect(dialog.getByTestId("resv-step-buyer")).toBeVisible();
    // Nombre y email quedan; la casilla de no retracto se vuelve a marcar (consentimiento explícito)
    await expect(dialog.getByLabel("Nombre y apellido")).toHaveValue("Ana Pérez");
    await expect(dialog.getByLabel("Email")).toHaveValue("ana.e2e@gmail.com");
    await dialog.getByTestId("resv-terms-checkbox").check();
    await dialog.getByTestId("resv-pay-button").click();
    await dialog.getByTestId("sim-result").getByRole("button", { name: "Volver al evento" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).not.toHaveURL(/checkout=1/);
  });

  test("mesa para 4: un QR por persona", async ({ page }) => {
    await openPreview(page, "vista-previa-mesa");
    await openCheckout(page);
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nombre y apellido").fill("Ana Pérez");
    await dialog.getByLabel("Email").fill("ana.e2e@gmail.com");
    await dialog.getByTestId("resv-terms-checkbox").check();
    await dialog.getByTestId("resv-pay-button").click();
    const result = dialog.getByTestId("sim-result");
    // Se muestran 3 y el resto se resume
    await expect(result.getByTestId("sim-ticket")).toHaveCount(3);
    await expect(result.getByTestId("sim-ticket").nth(1)).toContainText("Invitado 2 de 4");
    await expect(result).toContainText("+ 1 entrada más, cada una con su propio QR.");
  });

  test("gratis: confirmar asistencia y ver la entrada con QR de muestra", async ({ page }) => {
    const purchases = await openPreview(page, "vista-previa-gratis");
    const card = page.getByTestId("event-action-card");
    await expect(card.getByTestId("card-label")).toHaveText("Gratis");
    await expect(card.getByTestId("rsvp-preview-note")).toBeVisible();
    await card.getByLabel("Nombre y apellido").fill("Ana Pérez");
    await card.getByLabel("Email").fill("ana.e2e@gmail.com");
    await card.getByRole("button", { name: "Confirmar asistencia" }).click();
    await expect(card.getByTestId("card-label")).toHaveText("Asistencia confirmada");

    await card.getByTestId("rsvp-sim-ticket").click();
    const sheet = page.getByTestId("sim-tickets-sheet");
    await expect(sheet).toBeVisible();
    const result = sheet.getByTestId("sim-result");
    await expect(result.getByRole("heading", { level: 3 })).toHaveText("¡Listo, Ana! Estás dentro.");
    await expect(result).toContainText("Asistencia confirmada");
    await expect(result.getByTestId("sim-qr")).toBeVisible();
    expect(purchases).toEqual([]);

    // "Probar otra inscripción" cierra el panel y vuelve al formulario
    await result.getByRole("button", { name: "Probar otra inscripción" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(card.getByLabel("Nombre y apellido")).toBeVisible();
    // Una inscripción simulada no queda guardada en el navegador
    await page.reload();
    await waitForIsland(page, '[data-testid="event-action-card"]');
    await expect(card.getByTestId("card-label")).toHaveText("Gratis");
  });

  test("borrador sin entradas a la venta: lo explica, sin botón de compra", async ({ page }) => {
    await openPreview(page, "vista-previa-sin-entradas");
    const card = page.getByTestId("event-action-card");
    await expect(card.getByTestId("card-label")).toHaveText("Vista previa");
    await expect(card).toContainText("Este borrador todavía no tiene entradas a la venta.");
    await expect(card.getByRole("button", { name: /Comprar|Confirmar|Elegir/ })).toHaveCount(0);
  });
});

test.describe("compra simulada del evento demo", () => {
  test("pagado: termina en la entrada con QR de muestra y el registro de productores", async ({ page }) => {
    const purchases = await openPreview(page, "demo-pagado");
    await expect(page.getByRole("note")).toContainText("hasta la entrada con QR");
    await expect(notice(page)).toHaveCount(0); // el aviso flotante es solo de la vista previa

    await openCheckout(page);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Demostración");
    await dialog.getByLabel("Nombre y apellido").fill("Ana Pérez");
    await dialog.getByLabel("Email").fill("ana.e2e@gmail.com");
    await dialog.getByTestId("resv-terms-checkbox").check();
    await expect(dialog.getByTestId("resv-pay-button")).toHaveText("Simular pago de $4.381");
    await dialog.getByTestId("resv-pay-button").click();

    const result = dialog.getByTestId("sim-result");
    await expect(result.getByRole("heading", { level: 3 })).toHaveText("¡Listo, Ana! Tu entrada está lista.");
    await expect(result).toContainText("Así recibe su entrada quien compra en AI Tickets.");
    await expect(result).toContainText("El productor lo ve al instante");
    await expect(result.getByTestId("sim-ticket")).toHaveCount(1);
    await expect(result.getByTestId("sim-qr")).toBeVisible();
    await expect(result).toContainText("Muestra · No válido");
    await expect(result).toContainText("Demostración: no se creó ninguna orden");
    await expect(result.getByTestId("sim-signup")).toHaveAttribute("href", "/organizadores/registro?utm_source=aitickets&utm_medium=demo_event&utm_campaign=checkout");
    expect(purchases, "el demo no crea órdenes").toEqual([]);

    await result.getByRole("button", { name: "Volver al evento" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("gratis: confirmar asistencia y ver la entrada de muestra", async ({ page }) => {
    const purchases = await openPreview(page, "demo-gratis");
    const card = page.getByTestId("event-action-card");
    await card.getByLabel("Nombre y apellido").fill("Ana Pérez");
    await card.getByLabel("Email").fill("ana.e2e@gmail.com");
    await card.getByRole("button", { name: "Confirmar asistencia" }).click();
    await expect(card).toContainText("Demostración: no se creó ninguna entrada ni se envió un correo.");

    await card.getByTestId("rsvp-sim-ticket").click();
    const sheet = page.getByTestId("sim-tickets-sheet");
    await expect(sheet).toContainText("Demostración · Entrada de muestra");
    const result = sheet.getByTestId("sim-result");
    await expect(result.getByRole("heading", { level: 3 })).toHaveText("¡Listo, Ana! Estás dentro.");
    await expect(result).toContainText("Así recibe su entrada quien se inscribe en AI Tickets.");
    await expect(result.getByTestId("sim-qr")).toBeVisible();
    await expect(result.getByTestId("sim-signup")).toHaveAttribute("href", /utm_campaign=rsvp$/);
    expect(purchases).toEqual([]);

    // Esc cierra el panel
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  });
});
