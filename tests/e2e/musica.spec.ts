// Landing de música en vivo (/ticketera-musica-en-vivo, docs/specs/rediseno/SPEC_landing_musica_aitickets.md): H1 sin
// JS, FAQ con JSON-LD, la calculadora (fórmula del checkout, fees.mjs), las demos y los criterios que no dependen de la
// BD. El plazo de pago es el de legal.mjs y lo que no existe en el producto va con "Pronto".
import { expect, test, type Page } from "@playwright/test";
import { waitForIsland } from "./env";
import { PAYOUT_RELEASE_HOURS, PAYOUT_SCHEDULE_TEXT } from "../../netlify/lib/legal.mjs";

const PATH = "/ticketera-musica-en-vivo";

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
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Tú pon la música.");
  const publish = page.locator('[data-cta="publish"][data-section="hero"]');
  await expect(publish).toBeVisible();
  await expect(publish).toHaveAttribute("href", /^\/organizadores\/registro\?next=.*utm_campaign=musica_hero/);
  await expect(page.locator('[data-cta="demo"][data-section="hero"]')).toHaveAttribute("href", "/eventos/evento-demo-concierto");
  await page.waitForLoadState("networkidle");
  expect(errors.filter((text) => !/google-analytics|googletagmanager|partytown|ERR_FAILED|Failed to fetch/.test(text))).toEqual([]);
});

test("sin JS se lee completa: H1, las tres audiencias, los momentos y la FAQ con su JSON-LD", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("La boletería corre por nuestra cuenta.");
  const audience = page.getByTestId("music-audience");
  for (const label of ["Banda o solista", "Productora", "Sala o venue"]) await expect(audience.getByRole("heading", { name: label })).toBeAttached();
  await expect(page.getByTestId("music-curve").locator("ol > li")).toHaveCount(6);
  const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
  const faq = JSON.parse(jsonLd || "[]").find((item: { "@type": string }) => item["@type"] === "FAQPage");
  expect(faq.mainEntity).toHaveLength(16);
  await expect(page.getByTestId("landing-faq").getByRole("button")).toHaveCount(16);
  await context.close();
});

test("la calculadora coincide con el checkout ($12.000 → $13.142 / $12.000; absorbido $10.858)", async ({ page }) => {
  await open(page);
  const calc = page.getByTestId("music-calculator");
  await calc.scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="music-calculator"]');
  await expect(calc.getByTestId("music-calculator-public")).toHaveText("$13.142");
  await expect(calc.getByTestId("music-calculator-you")).toHaveText("$12.000");
  // §4.9: a diferencia de academias, el selector también está en mobile
  await calc.getByTestId("music-calculator-payer-producer").click();
  await expect(calc.getByTestId("music-calculator-public")).toHaveText("$12.000");
  await expect(calc.getByTestId("music-calculator-you")).toHaveText("$10.858");
});

test("el selector de audiencia cambia las líneas y el cartel lleva un link por banda", async ({ page }) => {
  await open(page);
  const audience = page.getByTestId("music-audience");
  await audience.scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="music-audience"]');
  await audience.getByTestId("music-audience-producer").click();
  await expect(audience.getByTestId("music-audience-producer")).toHaveAttribute("aria-checked", "true");
  await expect(audience.getByTestId("music-audience-lines")).toContainText("Varias fechas y ciudades en un evento.");

  const lineup = page.getByTestId("music-lineup");
  await lineup.scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="music-lineup"]');
  await expect(lineup.getByTestId("music-lineup-link")).toHaveText(/utm_source=niebla-norte$/);
  await lineup.getByTestId("music-lineup-name-los-trasnoche").click();
  await expect(lineup.getByTestId("music-lineup-link")).toHaveText(/utm_source=los-trasnoche$/);
});

test("lo que no existe va con Pronto y sin testimonio real no hay cita", async ({ page }) => {
  await open(page);
  await expect(page.locator("#como-se-vende").getByTestId("soon-badge").first()).toHaveText("Pronto");
  // El aviso a la lista de espera ya existe: la preventa no promete nada "Pronto"
  await expect(page.locator("#preventa").getByTestId("soon-badge")).toHaveCount(0);
  // Facebook, TikTok y reels en la serie; gustos musicales en los anuncios
  await expect(page.getByTestId("music-series").getByTestId("soon-badge")).toHaveCount(3);
  await expect(page.getByTestId("music-ads-demo").getByTestId("soon-badge")).toHaveCount(1);
  await expect(page.locator("[data-mu-testimonial]")).toHaveCount(0);
});

test("los plazos de pago son los del código", async ({ page }) => {
  await open(page);
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(new RegExp(`${PAYOUT_RELEASE_HOURS} horas después del evento`, "i"));
  expect(text).toContain(PAYOUT_SCHEDULE_TEXT);
});

test("con 'reducir movimiento' las tandas quedan en su estado final, con el sello y sin Repetir", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  const tiers = page.getByTestId("music-tiers");
  await tiers.scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="music-tiers"]');
  await expect(tiers.getByTestId("music-tiers-stamp")).toBeVisible();
  await expect(tiers.getByTestId("music-tiers-left")).toHaveText("Quedan 38");
  await expect(tiers.getByTestId("music-tiers-replay")).toHaveCount(0);
});

test("la barra flotante de mobile aparece pasado el hero y se esconde en el cierre", async ({ page, isMobile }) => {
  test.skip(!isMobile, "La barra flotante es solo de mobile");
  await open(page);
  await page.locator('astro-island[component-url*="LandingMobileBar"]:not([ssr])').waitFor({ state: "attached" });
  const bar = page.getByTestId("landing-mobile-bar");
  await expect(bar).toHaveCount(0);
  await page.locator("#para-quien").scrollIntoViewIfNeeded();
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("link", { name: "Publicar fecha" })).toHaveAttribute("href", /utm_campaign=musica_mobile_bar/);
  await page.locator("[data-final-cta]").scrollIntoViewIfNeeded();
  await expect(bar).toHaveCount(0);
});

test("en mobile no hay scroll horizontal, tampoco al recorrer la página entera", async ({ page, isMobile }) => {
  test.skip(!isMobile, "El ancho que importa es el de 390 px");
  await open(page);
  await page.locator("[data-final-cta]").scrollIntoViewIfNeeded();
  await page.waitForLoadState("networkidle");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("el footer y /organizadores enlazan la landing", async ({ page }) => {
  await page.goto("/organizadores");
  await expect(page.locator('a[href="/ticketera-musica-en-vivo"]').first()).toBeAttached();
  await expect(page.locator('footer a[href="/ticketera-musica-en-vivo"]')).toBeAttached();
});
