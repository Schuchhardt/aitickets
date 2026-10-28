// Landing de fiestas (/ticketera-fiestas, docs/specs/rediseno/SPEC_landing_fiestas_aitickets.md): H1 sin JS, FAQ con
// JSON-LD, la calculadora por etapas (fórmula del checkout, fees.mjs), la escalera que se detiene en "¿Abrimos la 2?" y
// sigue al adelantar, la plancha de promotores y los criterios que no dependen de la BD. El plazo de pago es el de
// legal.mjs y lo que no existe en el producto va con "Pronto".
import { expect, test, type Page } from "@playwright/test";
import { waitForIsland } from "./env";
import { PAYOUT_SCHEDULE_TEXT } from "../../netlify/lib/legal.mjs";

const PATH = "/ticketera-fiestas";

async function open(page: Page) {
  await page.route(/google-analytics\.com|googletagmanager\.com/, (route) => route.abort());
  const response = await page.goto(PATH);
  expect(response?.status()).toBe(200);
  await page.addStyleTag({ content: "astro-dev-toolbar{display:none!important}" });
}

test("carga con su H1, el CTA del hero y sin errores en la consola", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await open(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Preventa 1: agotada.");
  const publish = page.locator('[data-cta="publish"][data-section="hero"]');
  await expect(publish).toBeVisible();
  await expect(publish).toHaveAttribute("href", /^\/organizadores\/registro\?next=.*utm_campaign=fiestas_hero/);
  await expect(page.locator('[data-cta="demo"][data-section="hero"]')).toHaveAttribute("href", "/eventos/evento-demo-concierto");
  await page.waitForLoadState("networkidle");
  expect(errors.filter((text) => !/google-analytics|googletagmanager|partytown|ERR_FAILED|Failed to fetch/.test(text))).toEqual([]);
});

test("sin JS se lee completa: H1, la escalera con su tabla, el escáner como lista y la FAQ con su JSON-LD", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("¿Abrimos la 2?");
  await expect(page.locator("#preventa table tbody tr")).toHaveCount(4);
  await expect(page.getByTestId("party-scanner").locator("ol li")).toHaveCount(4);
  await expect(page.getByTestId("party-hero-card")).toContainText("Disponible desde el");
  const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
  const faq = JSON.parse(jsonLd || "[]").find((item: { "@type": string }) => item["@type"] === "FAQPage");
  expect(faq.mainEntity).toHaveLength(18);
  await expect(page.getByTestId("landing-faq").getByRole("button")).toHaveCount(18);
  await context.close();
});

test("la calculadora coincide con el checkout ($10.000 → $10.952 / $10.000; si se vende todo, $7.850.000)", async ({ page }) => {
  await open(page);
  const calc = page.getByTestId("party-calc");
  await calc.scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="party-calc"]');
  await expect(calc.getByTestId("party-calc-public-1")).toHaveText("$10.952");
  await expect(calc.getByTestId("party-calc-you-1")).toHaveText("$10.000");
  await expect(calc.getByTestId("party-calc-total-you")).toHaveText("$7.850.000");
  await expect(calc.getByTestId("party-calc-total-public")).toHaveText("$8.597.300");
  await calc.getByTestId("party-calc-payer-producer").click();
  await expect(calc.getByTestId("party-calc-you-1")).toHaveText("$9.048");
  await expect(calc.getByTestId("party-calc-total-you")).toHaveText("$7.102.700");
});

test("la escalera se detiene en '¿Abrimos la 2?' y al adelantar sigue", async ({ page }) => {
  await open(page);
  const stairs = page.getByTestId("party-stairs");
  await stairs.scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="party-stairs"]');
  await stairs.getByTestId("party-stairs-play").click();
  const pause = stairs.getByTestId("party-stairs-pause");
  await expect(pause).toBeVisible({ timeout: 5000 });
  await expect(pause).toContainText("Preventa 1: agotada en 4 días.");
  await expect(pause).toContainText("¿Abrimos la 2?");
  // La etapa encadenada ya se abre sola: la pausa no promete nada "Pronto"
  await expect(pause.getByTestId("soon-badge")).toHaveCount(0);
  await expect(pause).toContainText("se abre sola cuando se agota");
  await expect(stairs.getByTestId("party-stairs-advance")).toBeFocused();
  await stairs.getByTestId("party-stairs-advance").click();
  await expect(stairs.getByTestId("party-stairs-pause")).toContainText("Preventa 2: agotada", { timeout: 5000 });
  await stairs.getByTestId("party-stairs-advance").click();
  await expect(stairs.getByTestId("party-stairs-pause")).toContainText("Preventa 3: agotada", { timeout: 5000 });
  await stairs.getByTestId("party-stairs-advance").click();
  await expect(stairs.getByTestId("party-stairs-end")).toContainText("Agotado", { timeout: 5000 });
  await expect(stairs.getByTestId("party-stairs-you")).toHaveText("$7.850.000");
  await expect(stairs.getByTestId("party-stairs-sold")).toHaveText("700 de 700");
});

test("la plancha de promotores muestra los números del panel y el link de cada uno", async ({ page }) => {
  await open(page);
  const promos = page.getByTestId("party-promos");
  await promos.scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="party-promos"]');
  await promos.getByTestId("party-promo-CATA10").click();
  const back = promos.getByTestId("party-promo-back-CATA10");
  await expect(back).toContainText("44 / 60");
  await expect(back).toContainText("$88.000");
  await expect(back).toContainText("$792.000");
  // El reverso nombra al botón (sin aria-label que lo tape) y sus números se anuncian
  await expect(promos.getByTestId("party-promo-CATA10")).toHaveAccessibleName(/Usos 44 \/ 60/);
  await expect(promos.getByTestId("party-promo-status")).toContainText("usos 44 de 60");
  await promos.getByTestId("party-promos-mode-links").click();
  await expect(promos.getByTestId("party-promo-link")).toHaveText(/\?ref=cata$/);
});

test("lo que no existe va con Pronto y sin testimonio real no hay cita", async ({ page }) => {
  await open(page);
  // El aviso a la lista ya existe; "abrir sola" en la pausa se ve al jugar
  await expect(page.locator("#preventa").getByTestId("soon-badge")).toHaveCount(0);
  // Acceso del promotor
  await expect(page.locator("#promotores").getByTestId("soon-badge")).toHaveCount(1);
  // Facebook, TikTok y reels en la serie; gustos en los anuncios
  await expect(page.locator("#difusion").getByTestId("soon-badge")).toHaveCount(4);
  // Dirección que solo ven quienes compran
  await expect(page.locator("#pagina").getByTestId("soon-badge")).toHaveCount(1);
  // Vista de aforo en el panel
  await expect(page.locator("#puerta").getByTestId("soon-badge")).toHaveCount(1);
  await expect(page.locator("[data-fi-testimonial]")).toHaveCount(0);
});

test("los plazos de pago son los del código", async ({ page }) => {
  await open(page);
  const text = await page.locator("main").innerText();
  expect(text).toContain(PAYOUT_SCHEDULE_TEXT);
});

test("con 'reducir movimiento' la escalera avanza por pasos y no hay ráfagas de confeti", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  const stairs = page.getByTestId("party-stairs");
  await stairs.scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="party-stairs"]');
  const play = stairs.getByTestId("party-stairs-play");
  await expect(play).toHaveText("Siguiente día");
  await play.click();
  await expect(stairs.getByTestId("party-stairs-counter")).toHaveText("D-26");
  for (let i = 0; i < 4; i++) await play.click();
  await expect(stairs.getByTestId("party-stairs-pause")).toBeVisible();
  await expect(page.locator(".fi-burst-piece")).toHaveCount(0);
});

test("la barra flotante de mobile aparece pasado el hero y se esconde en el cierre", async ({ page, isMobile }) => {
  test.skip(!isMobile, "La barra flotante es solo de mobile");
  await open(page);
  await page.locator('astro-island[component-url*="LandingMobileBar"]:not([ssr])').waitFor({ state: "attached" });
  const bar = page.getByTestId("landing-mobile-bar");
  await expect(bar).toHaveCount(0);
  await page.locator("#para-quien").scrollIntoViewIfNeeded();
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("link", { name: "Publicar mi fiesta" })).toHaveAttribute("href", /utm_campaign=fiestas_mobile_bar/);
  await page.locator("[data-final-cta]").scrollIntoViewIfNeeded();
  await expect(bar).toHaveCount(0);
});

test("en mobile no hay scroll horizontal, tampoco con las pulseras a sangre", async ({ page, isMobile }) => {
  test.skip(!isMobile, "El ancho que importa es el de 390 px");
  await open(page);
  await page.locator("[data-final-cta]").scrollIntoViewIfNeeded();
  await page.waitForLoadState("networkidle");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("el footer y /organizadores enlazan la landing", async ({ page }) => {
  await page.goto("/organizadores");
  await expect(page.locator('a[href="/ticketera-fiestas"]').first()).toBeAttached();
  await expect(page.locator('footer a[href="/ticketera-fiestas"]')).toBeAttached();
});
