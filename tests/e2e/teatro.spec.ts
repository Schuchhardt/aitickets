// Landing de teatro (/ticketera-teatro, docs/specs/rediseno/SPEC_landing_teatro_aitickets.md): H1 sin JS, FAQ con
// JSON-LD, la calculadora (fórmula del checkout, fees.mjs), el selector de funciones, el fader de la temporada y los
// criterios que no dependen de la BD. El plazo de pago es el de legal.mjs y lo que no existe en el producto va con
// "Pronto".
import { expect, test, type Page } from "@playwright/test";
import { waitForIsland } from "./env";
import { PAYOUT_SHORT_TEXT } from "../../netlify/lib/legal.mjs";

const PATH = "/ticketera-teatro";

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
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Que suba el telón.");
  const publish = page.locator('[data-cta="publish"][data-section="hero"]');
  await expect(publish).toBeVisible();
  await expect(publish).toHaveAttribute("href", /^\/organizadores\/registro\?next=.*utm_campaign=teatro_hero/);
  await expect(page.locator('[data-cta="demo"][data-section="hero"]')).toHaveAttribute("href", "/eventos/evento-demo-teatro");
  await page.waitForLoadState("networkidle");
  expect(errors.filter((text) => !/google-analytics|googletagmanager|partytown|ERR_FAILED|Failed to fetch/.test(text))).toEqual([]);
});

test("sin JS se lee completa: H1, el reparto, los cinco momentos de la temporada y la FAQ con su JSON-LD", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("La boletería de tu obra ya está lista.");
  await expect(page.getByTestId("theatre-reparto").locator("dt")).toHaveCount(7);
  const season = page.getByTestId("theatre-season");
  // §4.4: sin JS, el paso 4 y la lista con los cinco momentos (en un <noscript>, fuera de la isla)
  await expect(season.getByTestId("theatre-season-title")).toHaveText("Bajó el telón");
  await expect(page.getByTestId("theatre-season-moments").locator(":scope > li")).toHaveCount(5);
  await expect(season.locator("table caption")).toHaveText("Temporada de ejemplo, 16 funciones");
  const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
  const faq = JSON.parse(jsonLd || "[]").find((item: { "@type": string }) => item["@type"] === "FAQPage");
  expect(faq.mainEntity).toHaveLength(18);
  await expect(page.getByTestId("landing-faq").getByRole("button")).toHaveCount(18);
  await context.close();
});

test("la calculadora coincide con el checkout ($10.000 → $10.952 / $10.000; absorbido $9.048)", async ({ page }) => {
  await open(page);
  const calc = page.getByTestId("theatre-calculator");
  await calc.scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="theatre-calculator"]');
  await expect(calc.getByTestId("theatre-calculator-public")).toHaveText("$10.952");
  await expect(calc.getByTestId("theatre-calculator-company")).toHaveText("$10.000");
  await calc.getByTestId("theatre-calculator-payer-producer").click();
  await expect(calc.getByTestId("theatre-calculator-public")).toHaveText("$10.000");
  await expect(calc.getByTestId("theatre-calculator-company")).toHaveText("$9.048");
});

test("el selector de funciones pasa a las entradas con el precio final del checkout", async ({ page }) => {
  await open(page);
  const picker = page.getByTestId("theatre-function-picker");
  await picker.scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="theatre-function-picker"]');
  // El estreno está agotado: sin botón
  await expect(picker.getByTestId("theatre-pick-f1")).toHaveCount(0);
  await picker.getByTestId("theatre-pick-f5").click();
  const tickets = picker.getByTestId("theatre-picker-tickets");
  await expect(tickets.getByTestId("theatre-ticket-general")).toHaveText("$10.952");
  await expect(tickets.getByTestId("theatre-ticket-estudiante")).toHaveText("$7.666");
  await expect(tickets.getByTestId("theatre-ticket-jueves")).toHaveText("$6.571");
  // El foco sigue a la vista nueva: al botón para volver y, al volver, a la función elegida
  await expect(picker.locator(".fp-back")).toBeFocused();
  await tickets.getByRole("button", { name: /Funciones/ }).click();
  await expect(picker.getByTestId("theatre-pick-f2")).toBeVisible();
  await expect(picker.getByTestId("theatre-pick-f5")).toBeFocused();
  // "Ver las 16 funciones" desaparece y el foco pasa a la primera función nueva
  await picker.getByTestId("theatre-picker-all").click();
  await expect(picker.getByTestId("theatre-pick-f6")).toBeFocused();
});

test("el fader se mueve con el teclado y cambia la cartelera y el panel", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  const season = page.getByTestId("theatre-season");
  await season.scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="theatre-season"]');
  const fader = season.getByTestId("theatre-fader");
  // Con "reducir movimiento" queda en el paso 4, sin moverse solo
  await expect(fader).toHaveValue("4");
  await expect(season.getByTestId("theatre-season-title")).toHaveText("Bajó el telón");
  await fader.focus();
  await page.keyboard.press("Home");
  await expect(season.getByTestId("theatre-season-title")).toHaveText("Estreno");
  await expect(season.getByTestId("theatre-season-done")).toHaveText("0");
  await page.keyboard.press("ArrowRight");
  await expect(season.getByTestId("theatre-season-title")).toHaveText("Semana 2");
  await expect(fader).toHaveAttribute("aria-valuetext", "Semana 2");
  // Las reseñas en la página durante la temporada ya existen
  await expect(season.getByTestId("soon-badge")).toHaveCount(0);
});

test("con 'reducir movimiento' el escáner queda fijo en el aviso de otra función, con el botón", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  const scanner = page.getByTestId("theatre-scanner");
  await scanner.scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="theatre-scanner"]');
  await expect(scanner.getByTestId("theatre-scanner-other")).toContainText("Esta entrada es para otra función");
  await page.waitForTimeout(3000);
  await expect(scanner.getByTestId("theatre-scanner-other")).toBeVisible();
  await scanner.getByTestId("theatre-scanner-toggle").click();
  await expect(scanner.getByTestId("theatre-scanner-valid")).toContainText("Válida");
});

test("lo que no existe va con Pronto y sin testimonio real no hay crítica", async ({ page }) => {
  await open(page);
  // Repetir funciones, copiar entradas y el borderó por función ya existen; Facebook, TikTok y reels (entreacto)
  await expect(page.locator("#obra").getByTestId("soon-badge")).toHaveCount(0);
  await expect(page.locator("#obra")).toContainText("Repetir funciones de jueves a domingo");
  await expect(page.getByTestId("theatre-series").getByTestId("soon-badge")).toHaveCount(3);
  await expect(page.locator("#salas").getByTestId("soon-badge")).toHaveCount(0);
  await expect(page.locator("#salas")).toContainText("Un borderó por función");
  await expect(page.locator("[data-te-testimonial]")).toHaveCount(0);
  // Las butacas numeradas no son "Pronto": se dice que no hay
  await expect(page.locator("#obra")).toContainText("No hay butacas numeradas");
});

test("los plazos de pago son los del código", async ({ page }) => {
  await open(page);
  const text = await page.locator("main").innerText();
  expect(text).toContain(PAYOUT_SHORT_TEXT);
});

test("la barra flotante de mobile aparece pasado el hero y se esconde en el cierre", async ({ page, isMobile }) => {
  test.skip(!isMobile, "La barra flotante es solo de mobile");
  await open(page);
  await page.locator('astro-island[component-url*="LandingMobileBar"]:not([ssr])').waitFor({ state: "attached" });
  const bar = page.getByTestId("landing-mobile-bar");
  await expect(bar).toHaveCount(0);
  // En mobile el CTA del hero queda bajo la foto (62svh): se pasa por él antes de seguir, como al hacer scroll
  await page.locator("[data-hero-cta]").scrollIntoViewIfNeeded();
  await page.locator("#obra").scrollIntoViewIfNeeded();
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("link", { name: "Publicar obra" })).toHaveAttribute("href", /utm_campaign=teatro_mobile_bar/);
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
  await expect(page.locator('a[href="/ticketera-teatro"]').first()).toBeAttached();
  await expect(page.locator('footer a[href="/ticketera-teatro"]')).toBeAttached();
});
