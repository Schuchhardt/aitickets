// Landing de stand-up (/ticketera-stand-up, docs/specs/rediseno/SPEC_landing_standup_aitickets.md): las demos y los
// criterios de aceptación que no dependen de la BD. La fórmula del precio es la del checkout (fees.mjs); la cadencia
// del calendario, la de socialSeriesCadence.ts; lo que no existe en el producto va con "Pronto".
import { expect, test, type Page } from "@playwright/test";
import { waitForIsland } from "./env";

const PATH = "/ticketera-stand-up";

async function open(page: Page) {
  await page.route(/google-analytics\.com|googletagmanager\.com/, (route) => route.abort());
  const response = await page.goto(PATH);
  expect(response?.status()).toBe(200);
  await page.addStyleTag({ content: "astro-dev-toolbar{display:none!important}" });
}

/** Las islas client:visible se hidratan al entrar en pantalla */
async function showIsland(page: Page, testId: string) {
  await page.getByTestId(testId).first().scrollIntoViewIfNeeded();
  await waitForIsland(page, `[data-testid="${testId}"]`);
  return page.getByTestId(testId).first();
}

test("carga con su H1, el CTA del hero y sin errores en la consola", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await open(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Tú haz el show.");
  const publish = page.locator('[data-cta="publish"][data-section="hero"]');
  await expect(publish).toBeVisible();
  await expect(publish).toHaveAttribute("href", /^\/organizadores\/registro\?next=/);
  await page.waitForLoadState("networkidle");
  // GA4 queda bloqueado en open(): su request abortado y lo que falla en el worker de Partytown al no poder cargarlo
  // no son errores de la página
  expect(errors.filter((text) => !/google-analytics|googletagmanager|partytown|ERR_FAILED/.test(text))).toEqual([]);
});

test("la calculadora coincide con el checkout ($10.000 → $10.952 / $9.048)", async ({ page }) => {
  await open(page);
  const price = await showIsland(page, "standup-price");
  const title = price.getByRole("heading", { level: 2 });
  await expect(title).toContainText("Tú recibes $10.000");
  await expect(title).toContainText("Tu público paga $10.952");
  await price.getByTestId("standup-price-payer-producer").click();
  await expect(title).toContainText("Tú recibes $9.048");
  await expect(title).toContainText("Tu público paga $10.000");
  await expect(price.getByTestId("standup-price-payer-producer")).toHaveAttribute("aria-checked", "true");
});

test("los switches de marketing quitan sus publicaciones y el contador se actualiza", async ({ page }) => {
  await open(page);
  const week = await showIsland(page, "standup-marketing-week");
  const live = week.locator("[aria-live]");
  // Historias de lunes a sábado (funciones viernes y sábado) + posts de lunes a jueves
  await expect(live).toHaveText("10 publicaciones esta semana");
  const story = week.getByTestId("standup-marketing-toggle-story");
  await story.click();
  await expect(story).toHaveAttribute("aria-checked", "false");
  await expect(live).toHaveText("4 publicaciones esta semana");
  await week.getByTestId("standup-marketing-toggle-post").click();
  await expect(live).toHaveText("0 publicaciones esta semana");
  // El reel (con el video del evento) parte apagado y suma una publicación
  const reel = week.getByTestId("standup-marketing-toggle-reel");
  await expect(reel).toHaveAttribute("aria-checked", "false");
  await reel.click();
  await expect(live).toHaveText("1 publicaciones esta semana");
  await expect(week.getByTestId("soon-badge")).toHaveCount(0);
});

test("el calendario marca las dos funciones de la semana (desktop)", async ({ page, isMobile }) => {
  test.skip(isMobile, "En mobile el calendario no se muestra: solo los switches");
  await open(page);
  const week = await showIsland(page, "standup-marketing-week");
  await expect(week.getByText("FUNCIÓN 21:00")).toHaveCount(2);
  // Instagram, Facebook y TikTok conectados, sin "Pronto"
  await expect(week.getByRole("list", { name: "Redes" })).toContainText("TikTok · conectado");
  await expect(week.getByRole("list", { name: "Redes" }).getByTestId("soon-badge")).toHaveCount(0);
});

test("la demo de anuncios pasa a campaña activa y se pausa", async ({ page }) => {
  await open(page);
  const ads = await showIsland(page, "standup-ads-demo");
  // Segmentar por intereses existe: el chip es un ejemplo, sin "Pronto"
  await expect(ads.getByText("Comedia y stand-up")).toHaveCount(1);
  await expect(ads.getByTestId("soon-badge")).toHaveCount(0);
  await ads.getByTestId("standup-ads-launch").click();
  await expect(ads.getByRole("status")).toContainText("Campaña activa · 3 días");
  const pause = ads.getByRole("button", { name: "Pausar" });
  await expect(pause).toBeFocused();
  await pause.click();
  await expect(ads.getByTestId("standup-ads-launch")).toBeFocused();
});

test("el mapa de sala muestra la sala llena con el total de su grilla", async ({ page, isMobile }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  const map = page.getByTestId("seat-map");
  await map.scrollIntoViewIfNeeded();
  const total = isMobile ? 96 : 200;
  await expect(page.getByRole("img", { name: `Mapa de la sala: ${total} de ${total} asientos vendidos` })).toBeVisible();
  await expect(page.locator(".seat-number:visible")).toHaveText(new RegExp(`^\\s*${total}\\s*de ${total} entradas\\s*$`));
  await expect(page.getByText("Función agotada · 100% vendido")).toBeVisible();
});

test("sin testimonio real la sección no se muestra", async ({ page }) => {
  await open(page);
  await expect(page.locator('[data-su-section="testimonial"]')).toHaveCount(0);
});

test("la barra flotante de mobile aparece pasado el hero y se esconde en el cierre", async ({ page, isMobile }) => {
  test.skip(!isMobile, "La barra flotante es solo de mobile");
  await open(page);
  await page.locator('astro-island[component-url*="LandingMobileBar"]:not([ssr])').waitFor({ state: "attached" });
  const bar = page.getByTestId("landing-mobile-bar");
  await expect(bar).toHaveCount(0);
  await page.locator("#redes").scrollIntoViewIfNeeded();
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("Gratis para publicar");
  await page.locator("[data-final-cta]").scrollIntoViewIfNeeded();
  await expect(bar).toHaveCount(0);
});
