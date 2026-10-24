// Videos del evento (src/components/event/AutoplayVideo.vue), en desktop y mobile (proyectos de playwright.config.ts):
// - de portada: reemplaza la imagen arriba de la página (póster, portada ancha; el diseño compacto se muestra como
//   póster), arranca solo y sin sonido al cargar y se pausa al salir de pantalla;
// - de la galería (opcional): arranca solo y sin sonido al aparecer en pantalla.
// En ambos, el botón del parlante activa y silencia el sonido.
// Sin BD: página real con datos fijos (tests/e2e/fixtures, escenarios "con-video-*").
import { expect, test, type Locator, type Page } from "@playwright/test";
import { waitForIsland } from "./env";
import { FIXTURE_ROUTE } from "./fixtures/event-scenarios.mjs";

async function openScenario(page: Page, scenario: string, testId: string) {
  await page.route(/google-analytics\.com|googletagmanager\.com/, (route) => route.abort());
  await page.route("**/api/events/visit", (route) => route.fulfill({ status: 204 }));
  const response = await page.goto(`${FIXTURE_ROUTE}/${scenario}`);
  expect(response?.status(), "el servidor debe levantarse con E2E_FIXTURES=1 (playwright.config.ts)").toBe(200);
  await page.addStyleTag({ content: "astro-dev-toolbar{display:none!important}" });
  await waitForIsland(page, `[data-testid="${testId}"]`);
}

const videoState = (box: Locator) => box.locator("video").evaluate((v: HTMLVideoElement) => ({ paused: v.paused, muted: v.muted }));

async function expectSoundToggle(page: Page, box: Locator, testId: string) {
  const sound = page.getByTestId(`${testId}-sound`);
  await expect(sound).toHaveAttribute("aria-label", "Activar sonido");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-label", "Silenciar");
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  expect((await videoState(box)).muted).toBe(false);
  await sound.click();
  await expect(sound).toHaveAttribute("aria-label", "Activar sonido");
  expect((await videoState(box)).muted).toBe(true);
}

for (const [scenario, layout] of [
  ["con-video-portada", "poster"],
  ["con-video-portada-ancha", "banner"],
  ["con-video-portada-compacto", "poster"],
] as const) {
  test(`video de portada (${scenario}): reemplaza la imagen, autoplay sin sonido al cargar, sonido y pausa al salir`, async ({ page }) => {
    await openScenario(page, scenario, "cover-video");
    const cover = page.getByTestId("event-cover");
    await expect(page.locator(".ev-page")).toHaveClass(new RegExp(`layout-${layout}`));
    // El video reemplaza la imagen de portada
    await expect(cover.getByTestId("cover-video")).toBeVisible();
    await expect(cover.locator("img")).toHaveCount(0);
    const box = cover.getByTestId("cover-video");
    await expect(box.locator("video")).toHaveAttribute("poster", "/videos/aitickets-demo-poster.jpg");

    // Arriba de la página: arranca solo (sin scroll) y sin sonido
    await expect.poll(async () => (await videoState(box)).paused, { timeout: 10_000 }).toBe(false);
    expect((await videoState(box)).muted).toBe(true);

    await expectSoundToggle(page, box, "cover-video");

    // Al salir de pantalla se pausa
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(async () => (await videoState(box)).paused, { timeout: 10_000 }).toBe(true);
  });
}

test("video de la galería: autoplay sin sonido en pantalla, pausa al salir y botón de sonido", async ({ page }) => {
  await openScenario(page, "con-video-galeria", "gallery-video");
  // Sin video de portada, arriba sigue la imagen
  await expect(page.getByTestId("event-cover").locator("img")).toHaveCount(1);
  const box = page.getByTestId("gallery-video");
  await expect(box.locator("video")).toHaveAttribute("poster", "/videos/aitickets-demo-poster.jpg");

  // Fuera de pantalla no se reproduce
  expect((await videoState(box)).paused).toBe(true);

  // Al entrar en pantalla arranca solo y sin sonido
  await box.scrollIntoViewIfNeeded();
  await expect.poll(async () => (await videoState(box)).paused, { timeout: 10_000 }).toBe(false);
  expect((await videoState(box)).muted).toBe(true);

  await expectSoundToggle(page, box, "gallery-video");

  // Al salir de pantalla se pausa
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(async () => (await videoState(box)).paused, { timeout: 10_000 }).toBe(true);
});
