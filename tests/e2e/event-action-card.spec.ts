// Card de acción v2 (SPEC_evento_checkout §4.4b): cada fila de la tabla de estados montada en la página real del
// evento (tests/e2e/fixtures, sin BD), con su rótulo, su contenido y su acción principal. En mobile la card de los
// eventos pagados a la venta de una función no se muestra (la barra inferior abre el checkout): esos casos corren
// solo en desktop y en mobile se prueba la fila de accesos de la página. Con varias funciones la card sí va inline.
import { expect, test, type Page } from "@playwright/test";
import { waitForIsland } from "./env";
import { FIXTURE_ROUTE } from "./fixtures/event-scenarios.mjs";

const EVENT_ID = 9100;
const ORDER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Órdenes guardadas en este navegador (como las deja RsvpForm o la página de confirmación de pago). */
async function seedOrders(page: Page, orders: Array<Record<string, unknown>>) {
  await page.addInitScript(
    ({ key, value }) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* storage no disponible */
      }
    },
    { key: `purchase_event_${EVENT_ID}`, value: JSON.stringify(orders) },
  );
}

async function openScenario(page: Page, scenario: string) {
  await page.route(/google-analytics\.com|googletagmanager\.com/, (route) => route.abort());
  await page.route("**/api/events/visit", (route) => route.fulfill({ status: 204 }));
  const response = await page.goto(`${FIXTURE_ROUTE}/${scenario}`);
  expect(response?.status(), "el servidor debe levantarse con E2E_FIXTURES=1 (playwright.config.ts)").toBe(200);
  await page.addStyleTag({ content: "astro-dev-toolbar{display:none!important}" });
  await waitForIsland(page, '[data-testid="event-action-card"]');
  return page.getByTestId("event-action-card");
}

const label = (page: Page) => page.getByTestId("card-label");

test.describe("gratis", () => {
  test("con cupos: GRATIS y el formulario inline", async ({ page }) => {
    const card = await openScenario(page, "gratis");
    await expect(label(page)).toHaveText("Gratis");
    await expect(card.getByLabel("Nombre y apellido")).toBeVisible();
    await expect(card.getByRole("button", { name: "Confirmar asistencia" })).toBeVisible();
  });

  test("pocos cupos: GRATIS · QUEDAN N CUPOS en tono de alerta", async ({ page }) => {
    await openScenario(page, "gratis-pocos-cupos");
    await expect(label(page)).toHaveText("Gratis · Quedan 8 cupos");
    await expect(label(page)).toHaveClass(/is-warning/);
  });

  test("ya confirmado en este navegador: ASISTENCIA CONFIRMADA, ver mi entrada y quiénes van", async ({ page }) => {
    await seedOrders(page, [{ orderId: ORDER, eventId: EVENT_ID, amount: 0, ticketsCount: 1, email: "ana.e2e@gmail.com", name: "Ana Pérez" }]);
    const card = await openScenario(page, "gratis");
    await expect(label(page)).toHaveText("Asistencia confirmada");
    await expect(label(page)).toHaveClass(/is-positive/);
    const confirmed = card.getByTestId("rsvp-confirmed");
    await expect(confirmed).toContainText(/Te esperamos el \S+ \d+/);
    // Email enmascarado: en la página pública no se muestran datos completos
    await expect(confirmed).toContainText("an*****@gmail.com");
    await expect(confirmed.getByRole("link", { name: "Ver mi entrada" })).toHaveAttribute("href", `/order/${ORDER}`);
    await expect(confirmed.getByRole("link", { name: "Ver quiénes van →" })).toHaveAttribute("href", `/order/${ORDER}#quienes-van`);
    await expect(confirmed.getByRole("button", { name: "Añadir al calendario" })).toBeVisible();
    // Debajo de la card sigue "Compartir"; "Añadir al calendario" no se repite
    await expect(page.locator(".secondary").getByRole("button", { name: "Compartir" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Añadir al calendario" })).toHaveCount(1);
  });

  test("email ya inscrito: YA ESTÁS INSCRITO y reenviar entrada", async ({ page }) => {
    await page.route("**/api/purchase-ticket", async (route) => {
      if (route.request().method() !== "POST") return route.fulfill({ json: { turnstileSiteKey: "" } });
      await route.fulfill({ status: 409, json: { code: "ALREADY_REGISTERED", message: "Ya estás inscrito." } });
    });
    const card = await openScenario(page, "gratis");
    await card.getByLabel("Nombre y apellido").fill("Ana Pérez");
    await card.getByLabel("Email").fill("ana.e2e@gmail.com");
    await card.getByRole("button", { name: "Confirmar asistencia" }).click();
    await expect(label(page)).toHaveText("Ya estás inscrito");
    // El cuerpo queda igual que antes (§4.4b b) y va dentro del role="status" para que se anuncie
    const info = card.getByRole("status").filter({ hasText: "Ya estás inscrito con este email." });
    await expect(info).toContainText("ana.e2e@gmail.com");
    await expect(card.getByRole("button", { name: "Reenviar entrada" })).toBeVisible();
  });

  test("lleno: GRATIS · CUPOS LLENOS y lista de espera", async ({ page }) => {
    const card = await openScenario(page, "gratis-lleno");
    await expect(label(page)).toHaveText("Gratis · Cupos llenos");
    await expect(card.getByRole("button", { name: "Avisarme si se libera un cupo" })).toBeVisible();
  });
});

test.describe("pagado a la venta", () => {
  const desktopOnly = "en mobile la card de los eventos pagados de una función no se muestra";

  test("1 función, 1 tipo: abre con el precio (sin rótulo) y el stepper", async ({ page, isMobile }) => {
    test.skip(isMobile, desktopOnly);
    const card = await openScenario(page, "poster-una-entrada");
    await expect(label(page)).toHaveCount(0);
    await expect(card.getByTestId("buy-button")).toHaveText("Comprar entrada");
    await expect(card.getByRole("button", { name: "Agregar una entrada General", exact: true })).toBeVisible();
  });

  test("varios tipos y 1 función: Desde $X y el resumen de tipos", async ({ page, isMobile }) => {
    test.skip(isMobile, desktopOnly);
    const card = await openScenario(page, "varias-entradas");
    await expect(label(page)).toHaveCount(0);
    await expect(card).toContainText(/Desde \$\d/);
    await expect(card).toContainText("2 tipos de entrada");
    await expect(card.getByTestId("buy-button")).toHaveText("Elegir entradas");
  });

  test("últimas entradas: rótulo de alerta", async ({ page, isMobile }) => {
    test.skip(isMobile, desktopOnly);
    await openScenario(page, "pagado-ultimas");
    await expect(label(page)).toHaveText("Últimas entradas");
    await expect(label(page)).toHaveClass(/is-warning/);
  });

  test("varias funciones: N FUNCIONES · M LUGARES, chips y el chip abre el checkout con esa función", async ({ page, isMobile }) => {
    const card = await openScenario(page, "varias-funciones");
    // También en mobile: la card va inline después del lugar y los chips en una fila con scroll horizontal
    await expect(card).toBeVisible();
    await expect(label(page)).toHaveText("5 funciones · 2 lugares");
    await expect(card).toContainText(/Desde \$\d/);
    const chips = card.getByTestId("card-function-chips");
    // La primera función está agotada: no aparece. A la segunda le quedan pocas (punto de alerta).
    const fnChips = chips.locator("button[data-function-id]");
    await expect(fnChips).toHaveCount(3);
    await expect(fnChips.first()).toHaveAttribute("data-function-id", "9201");
    await expect(fnChips.first()).toContainText("Providencia");
    await expect(fnChips.first().locator(".chip-dot")).toHaveCount(1);
    await expect(fnChips.nth(1)).toContainText("Ñuñoa");
    await expect(chips.getByRole("button", { name: "+ 1 función" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Ver todas las funciones ↓" })).toBeVisible();
    if (isMobile) {
      await expect(chips).toHaveCSS("scroll-snap-type", "x mandatory");
      await expect(chips).toHaveCSS("flex-wrap", "nowrap");
    }

    await fnChips.nth(1).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveURL(/[?&]funcion=9202(&|$)/);
  });

  test("varias funciones: \"Ver todas las funciones\" lleva el foco a la sección Funciones", async ({ page }) => {
    const card = await openScenario(page, "varias-funciones");
    await card.getByRole("button", { name: "Ver todas las funciones ↓" }).click();
    await expect(page.locator("#funciones-title")).toBeFocused();
  });

  test("ya compró en este navegador: franja Tienes N entradas con mis entradas y quiénes van", async ({ page, isMobile }) => {
    test.skip(isMobile, desktopOnly);
    await seedOrders(page, [{ orderId: ORDER, eventId: EVENT_ID, amount: 8762, ticketsCount: 2 }]);
    const card = await openScenario(page, "poster-una-entrada");
    const orders = card.getByTestId("card-orders");
    await expect(orders).toContainText("Tienes 2 entradas");
    await expect(orders.getByRole("button", { name: "Ver mis entradas" })).toBeVisible();
    await expect(orders.getByRole("link", { name: "Ver quiénes van →" })).toHaveAttribute("href", `/order/${ORDER}#quienes-van`);
    // Se mantiene el estado de venta
    await expect(card.getByTestId("buy-button")).toHaveText("Comprar entrada");
  });

  test("ya compró en este navegador (mobile): mis entradas y quiénes van en la fila de accesos", async ({ page, isMobile }) => {
    test.skip(!isMobile, "en desktop lo muestra la franja de la card");
    await seedOrders(page, [{ orderId: ORDER, eventId: EVENT_ID, amount: 8762, ticketsCount: 2 }]);
    await openScenario(page, "poster-una-entrada");
    await expect(page.getByRole("button", { name: "Mis entradas (1)" })).toBeVisible();
    await expect(page.getByTestId("mobile-feed-link")).toHaveAttribute("href", `/order/${ORDER}#quienes-van`);
  });
});

test.describe("sin venta", () => {
  test("venta por abrir: VENTA ABRE EL … y avisarme", async ({ page }) => {
    const card = await openScenario(page, "venta-por-abrir");
    await expect(label(page)).toHaveText(/^Venta abre el \d+ \w+, \d{2}:\d{2}$/);
    await expect(card.getByRole("button", { name: "Avisarme cuando abra" })).toBeVisible();
  });

  test("agotado: AGOTADO y avisarme si se liberan", async ({ page }) => {
    const card = await openScenario(page, "agotado");
    await expect(label(page)).toHaveText("Agotado");
    await expect(card).toContainText("Se vendieron todas las entradas.");
    await expect(card.getByRole("button", { name: "Avisarme si se liberan" })).toBeVisible();
  });

  test("finalizado con reseñas: promedio, cantidad y calificar", async ({ page }) => {
    const card = await openScenario(page, "terminado-con-resenas");
    await expect(label(page)).toHaveText("Evento finalizado");
    await expect(card.getByTestId("card-rating")).toContainText("4,5");
    await expect(card.getByTestId("card-rating")).toContainText("4 reseñas");
    await expect(card.getByTestId("review-cta")).toHaveText("★ ¿Fuiste? Califica el evento");
    await expect(card.getByRole("link", { name: "Ver próximos eventos de Productora de Prueba →" })).toBeVisible();
  });

  test("finalizado sin reseñas: este evento ya ocurrió", async ({ page }) => {
    const card = await openScenario(page, "terminado-sin-resenas");
    await expect(label(page)).toHaveText("Evento finalizado");
    await expect(card).toContainText("Este evento ya ocurrió.");
    await expect(card.getByTestId("card-rating")).toHaveCount(0);
  });

  test("vista previa de un borrador: VISTA PREVIA y la acción deshabilitada", async ({ page }) => {
    const card = await openScenario(page, "vista-previa");
    await expect(label(page)).toHaveText("Vista previa");
    await expect(card).toContainText("La compra se habilita al publicar el evento.");
    await expect(card.getByRole("button", { name: "Comprar entrada" })).toBeDisabled();
    await expect(card.getByTestId("review-cta")).toHaveCount(0);
  });

  test("venta cerrada", async ({ page }) => {
    const card = await openScenario(page, "venta-cerrada");
    await expect(label(page)).toHaveText("Venta cerrada");
    await expect(card).toContainText("No hay entradas disponibles en este momento.");
  });
});
