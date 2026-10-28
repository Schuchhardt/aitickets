// Agenda con expositores y salas en la página del evento (PENDIENTES_pronto ítem 17): por día, solo cuando hay bloques.
// Página real del evento con datos fijos (tests/e2e/fixtures, sin BD).
import { expect, test, type Page } from "@playwright/test";
import { waitForIsland } from "./env";
import { FIXTURE_ROUTE } from "./fixtures/event-scenarios.mjs";

async function openScenario(page: Page, scenario: string) {
  await page.route(/google-analytics\.com|googletagmanager\.com/, (route) => route.abort());
  await page.route("**/api/events/visit", (route) => route.fulfill({ status: 204 }));
  const response = await page.goto(`${FIXTURE_ROUTE}/${scenario}`);
  expect(response?.status(), "el servidor debe levantarse con E2E_FIXTURES=1 (playwright.config.ts)").toBe(200);
  await page.addStyleTag({ content: "astro-dev-toolbar{display:none!important}" });
  await waitForIsland(page, '[data-testid="event-action-card"]');
}

test("la agenda va por día, con hora, expositores y sala", async ({ page }) => {
  await openScenario(page, "congreso-con-agenda");
  const agenda = page.getByTestId("event-agenda");
  await expect(agenda.getByRole("heading", { name: "Agenda" })).toBeVisible();
  const days = agenda.locator("h3");
  await expect(days).toHaveCount(3);
  await expect(days.nth(0)).toHaveText("Todos los días");
  await expect(days.nth(1)).toContainText("Día 1 ·");
  await expect(days.nth(2)).toContainText("Día 2 ·");
  const rows = agenda.getByTestId("agenda-row");
  await expect(rows).toHaveCount(4);
  // Dentro de cada día, por hora
  await expect(rows.nth(1)).toContainText("09:00 – 09:30");
  await expect(rows.nth(1)).toContainText("Bienvenida");
  await expect(rows.nth(2)).toContainText("Charla inaugural");
  await expect(rows.nth(2)).toContainText("Ana Pérez (Empresa Ejemplo)");
  await expect(rows.nth(2)).toContainText("Sala 1");
  await expect(rows.nth(3)).toContainText("Panel: IA en la empresa");
  // En desktop la card de compra sigue a la vista junto a la agenda (en mobile la reemplaza la barra inferior)
  if ((page.viewportSize()?.width ?? 0) >= 1024) await expect(page.getByTestId("event-action-card")).toBeVisible();
});

test("sin bloques no hay sección de agenda", async ({ page }) => {
  await openScenario(page, "varias-funciones");
  await expect(page.getByTestId("event-agenda")).toHaveCount(0);
});
