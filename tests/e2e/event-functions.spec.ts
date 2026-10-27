// Eventos con varias funciones (SPEC_evento_checkout §4.9b y §6.3): sección "Funciones" v2, el paso Elegir con la
// función preseleccionada, el aviso de función agotada y la barra inferior de mobile. Página real del evento con
// datos fijos (tests/e2e/fixtures, sin BD). Los eventos de una función los cubren event-quantity y event-action-card.
import { expect, test, type Page } from "@playwright/test";
import { waitForIsland } from "./env";
import { FIXTURE_ROUTE } from "./fixtures/event-scenarios.mjs";

async function openScenario(page: Page, scenario: string, query = "") {
  await page.route(/google-analytics\.com|googletagmanager\.com/, (route) => route.abort());
  await page.route("**/api/events/visit", (route) => route.fulfill({ status: 204 }));
  const response = await page.goto(`${FIXTURE_ROUTE}/${scenario}${query}`);
  expect(response?.status(), "el servidor debe levantarse con E2E_FIXTURES=1 (playwright.config.ts)").toBe(200);
  await page.addStyleTag({ content: "astro-dev-toolbar{display:none!important}" });
  await waitForIsland(page, '[data-testid="event-action-card"]');
}

const section = (page: Page) => page.getByTestId("event-functions");
const rows = (page: Page) => section(page).locator("li[data-function-id]");
const row = (page: Page, id: number) => section(page).locator(`li[data-function-id="${id}"]`);

test.describe("sección Funciones", () => {
  test("agrupada por lugar con dirección, con estado por función y Elegir solo en las disponibles", async ({ page }) => {
    await openScenario(page, "varias-funciones");
    await expect(rows(page)).toHaveCount(5);
    await expect(section(page)).toContainText("Providencia · Sala Agustín Siré");
    await expect(section(page)).toContainText("Morandé 750");
    await expect(section(page)).toContainText("Ñuñoa · Teatro Ñuñoa");
    // La primera está agotada: atenuada, tachada y sin "Elegir"
    await expect(row(page, 9200)).toContainText("Agotada");
    await expect(row(page, 9200)).toHaveClass(/is-out/);
    await expect(row(page, 9200).getByRole("button")).toHaveCount(0);
    await expect(row(page, 9201)).toContainText("Últimas");
    await expect(row(page, 9202)).toContainText("Disponible");
    await expect(row(page, 9202).getByRole("button", { name: /^Elegir .+, en Ñuñoa$/ })).toBeVisible();
    // Sin ninguna lista larga: no hay "Ver las N funciones"
    await expect(section(page).getByRole("button", { name: /^Ver las/ })).toHaveCount(0);
  });

  test("toda la fila abre el checkout con esa función, con el foco en la primera fila de entradas", async ({ page }) => {
    await openScenario(page, "varias-funciones");
    await row(page, 9202).locator(".fn-date").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/[?&]funcion=9202(&|$)/);
    await expect(dialog.getByRole("radio", { name: "Ñuñoa" })).toHaveAttribute("aria-checked", "true");
    await expect(dialog.getByRole("radiogroup", { name: "Fecha y hora" }).locator('[aria-checked="true"]')).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: "Agregar una entrada General", exact: true })).toBeFocused();
  });

  test("la función agotada no abre el checkout", async ({ page }) => {
    await openScenario(page, "varias-funciones");
    await row(page, 9200).locator(".fn-date").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("lista larga: las 6 próximas y \"Ver las N funciones\" expande", async ({ page }) => {
    await openScenario(page, "muchas-funciones");
    await expect(rows(page)).toHaveCount(6);
    const more = section(page).getByRole("button", { name: "Ver las 9 funciones" });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.click();
    await expect(rows(page)).toHaveCount(9);
    // Un solo lugar: sin encabezado de lugar. La última tiene entradas más caras: su desde-precio propio
    await expect(section(page).locator(".fn-place")).toHaveCount(0);
    await expect(row(page, 9208)).toContainText(/Desde \$\d/);
    await expect(row(page, 9200).locator(".fn-price")).toHaveCount(0);
    await expect(section(page).locator("[aria-live]")).toHaveText("9 funciones");
    const less = section(page).getByRole("button", { name: "Ver menos" });
    await expect(less).toHaveAttribute("aria-expanded", "true");
    await less.click();
    await expect(rows(page)).toHaveCount(6);
  });

  test("función con la venta por abrir: \"Disponible desde el …\", sin tachar ni \"Elegir\"", async ({ page }) => {
    await openScenario(page, "funciones-venta-por-abrir");
    await expect(row(page, 9204)).toContainText("Disponible desde el");
    await expect(row(page, 9204)).not.toContainText("Agotada");
    await expect(row(page, 9204)).not.toHaveClass(/is-out/);
    await expect(row(page, 9204).getByRole("button")).toHaveCount(0);
    await row(page, 9204).locator(".fn-date").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("entradas válidas para cualquier función: lista informativa, sin estado ni \"Elegir\"", async ({ page }) => {
    await openScenario(page, "funciones-entrada-general");
    await expect(rows(page)).toHaveCount(3);
    await expect(section(page).getByRole("button")).toHaveCount(0);
    await expect(section(page)).not.toContainText("Disponible");
    await row(page, 9201).locator(".fn-date").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("\"y N funciones más\" del bloque de fecha lleva a la sección (no abre el checkout)", async ({ page }) => {
    await openScenario(page, "varias-funciones");
    await page.getByRole("button", { name: "y 4 funciones más →" }).click();
    await expect(page.locator("#funciones-title")).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("paso Elegir", () => {
  test("link a una función agotada: aviso inline y queda el selector en su lugar", async ({ page }) => {
    await openScenario(page, "varias-funciones", "?checkout=1&funcion=9200");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("status").filter({ hasText: "Esa función se agotó. Elige otra:" })).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "Providencia" })).toHaveAttribute("aria-checked", "true");
    const tiles = dialog.getByRole("radiogroup", { name: "Fecha y hora" });
    await expect(tiles.locator('[aria-checked="true"]')).toHaveCount(0);
    await expect(tiles.locator('[aria-disabled="true"]')).toHaveCount(1);
    await expect(dialog.getByTestId("resv-pay-button")).toBeDisabled();
  });

  test("link a una función con la venta por abrir: no dice que se agotó, sus entradas dicen desde cuándo", async ({ page }) => {
    await openScenario(page, "funciones-venta-por-abrir", "?checkout=1&funcion=9204");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toContainText("Esa función se agotó");
    await expect(dialog.getByRole("radio", { name: "Ñuñoa" })).toHaveAttribute("aria-checked", "true");
    await expect(dialog.getByRole("radiogroup", { name: "Fecha y hora" }).locator('[aria-checked="true"]')).toHaveCount(1);
    await expect(dialog).toContainText("Disponible desde el");
  });
});

test.describe("barra inferior (mobile)", () => {
  test("varias funciones: Desde $X, N funciones y Elegir entradas", async ({ page, isMobile }) => {
    test.skip(!isMobile, "la barra inferior es solo de mobile");
    await openScenario(page, "varias-funciones");
    const bar = page.getByTestId("mobile-sticky-bar");
    // La card va inline (chips): la barra espera a que salga de pantalla
    await expect(bar).toHaveCount(0);
    await section(page).scrollIntoViewIfNeeded();
    await expect(bar).toBeVisible();
    await expect(bar).toContainText(/Desde \$\d/);
    await expect(bar).toContainText("5 funciones");
    await bar.getByRole("button", { name: "Elegir entradas" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("varias funciones con un solo tipo de entrada: precio, N funciones y Comprar", async ({ page, isMobile }) => {
    test.skip(!isMobile, "la barra inferior es solo de mobile");
    await openScenario(page, "funciones-entrada-general");
    const bar = page.getByTestId("mobile-sticky-bar");
    await section(page).scrollIntoViewIfNeeded();
    await expect(bar).toBeVisible();
    await expect(bar).toContainText("3 funciones");
    await expect(bar).not.toContainText("incluye cargo");
    await expect(bar.getByRole("button", { name: "Comprar" })).toBeVisible();
  });
});
