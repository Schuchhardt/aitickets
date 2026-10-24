// Video de portada de la galería (src/components/event/GalleryVideo.vue), en desktop y mobile (proyectos de
// playwright.config.ts): arranca solo y sin sonido al aparecer en pantalla, se pausa al salir y el botón del
// parlante activa y silencia el sonido.
// Sin BD: página real con datos fijos (tests/e2e/fixtures, escenario "con-video-galeria").
import { expect, test, type Page } from "@playwright/test";
import { waitForIsland } from "./env";
import { FIXTURE_ROUTE } from "./fixtures/event-scenarios.mjs";

async function openScenario(page: Page) {
  await page.route(/google-analytics\.com|googletagmanager\.com/, (route) => route.abort());
  await page.route("**/api/events/visit", (route) => route.fulfill({ status: 204 }));
  const response = await page.goto(`${FIXTURE_ROUTE}/con-video-galeria`);
  expect(response?.status(), "el servidor debe levantarse con E2E_FIXTURES=1 (playwright.config.ts)").toBe(200);
  await page.addStyleTag({ content: "astro-dev-toolbar{display:none!important}" });
  await waitForIsland(page, '[data-testid="gallery-video"]');
}

const videoState = (page: Page) =>
  page.getByTestId("gallery-video").locator("video").evaluate((v: HTMLVideoElement) => ({ paused: v.paused, muted: v.muted }));

test("video de la galería: autoplay sin sonido en pantalla, pausa al salir y botón de sonido", async ({ page }) => {
  await openScenario(page);
  const figure = page.getByTestId("gallery-video");
  const video = figure.locator("video");
  await expect(video).toHaveAttribute("poster", "/videos/aitickets-demo-poster.jpg");

  // Fuera de pantalla no se reproduce
  expect((await videoState(page)).paused).toBe(true);

  // Al entrar en pantalla arranca solo y sin sonido
  await figure.scrollIntoViewIfNeeded();
  await expect.poll(async () => (await videoState(page)).paused, { timeout: 10_000 }).toBe(false);
  expect((await videoState(page)).muted).toBe(true);

  // El parlante activa y silencia el sonido
  const sound = page.getByTestId("gallery-video-sound");
  await expect(sound).toHaveAttribute("aria-label", "Activar sonido");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-label", "Silenciar");
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  expect((await videoState(page)).muted).toBe(false);
  await sound.click();
  await expect(sound).toHaveAttribute("aria-label", "Activar sonido");
  expect((await videoState(page)).muted).toBe(true);

  // Al salir de pantalla se pausa
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(async () => (await videoState(page)).paused, { timeout: 10_000 }).toBe(true);
});
