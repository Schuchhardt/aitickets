// Landing de clubs y discotecas (/ticketera-discotecas, docs/specs/rediseno/SPEC_landing_clubs_aitickets.md): H1 sin JS,
// FAQ con JSON-LD, la calculadora (fórmula del checkout, fees.mjs), el ranking de RRPP, la noche en vivo y los criterios
// que no dependen de la BD. El plazo de pago es el de legal.mjs, lo que no existe en el producto va con "Pronto" y las
// variantes con "clubs" de la URL redirigen con 301.
import { expect, test, type Page } from "@playwright/test";
import { waitForIsland } from "./env";
import { PAYOUT_SCHEDULE_TEXT } from "../../netlify/lib/legal.mjs";

const PATH = "/ticketera-discotecas";

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
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Abre la puerta.");
  const publish = page.locator('[data-cta="publish"][data-section="hero"]');
  await expect(publish).toBeVisible();
  await expect(publish).toHaveAttribute("href", /^\/organizadores\/registro\?next=.*utm_campaign=clubs_hero/);
  await expect(page.locator('[data-cta="demo"][data-section="hero"]')).toHaveAttribute("href", "/eventos/evento-demo-concierto");
  await page.waitForLoadState("networkidle");
  expect(errors.filter((text) => !/google-analytics|googletagmanager|partytown|ERR_FAILED|Failed to fetch/.test(text))).toEqual([]);
});

test("sin JS se lee completa: H1, la noche en su estado de 01:30 con la tabla y la FAQ con su JSON-LD", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Nosotros llevamos la lista.");
  await expect(page.getByTestId("club-night-inside")).toHaveText("455");
  await expect(page.locator("#en-vivo table tbody tr")).toHaveCount(6);
  await expect(page.getByTestId("club-month").locator(".cm-night")).toHaveCount(15);
  const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
  const faq = JSON.parse(jsonLd || "[]").find((item: { "@type": string }) => item["@type"] === "FAQPage");
  expect(faq.mainEntity).toHaveLength(16);
  await expect(page.getByTestId("landing-faq").getByRole("button")).toHaveCount(16);
  await context.close();
});

test("la calculadora coincide con el checkout (cover $10.000 → $10.952 / $10.000; mesa $180.000 → $197.136)", async ({ page }) => {
  await open(page);
  const calc = page.getByTestId("club-calc");
  await calc.scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="club-calc"]');
  await expect(calc.getByTestId("club-calc-public")).toHaveText("$10.952");
  await expect(calc.getByTestId("club-calc-you")).toHaveText("$10.000");
  await calc.getByTestId("club-calc-payer-producer").click();
  await expect(calc.getByTestId("club-calc-public")).toHaveText("$10.000");
  await expect(calc.getByTestId("club-calc-you")).toHaveText("$9.048");
  await calc.getByTestId("club-calc-payer-buyer").click();
  await calc.getByTestId("club-calc-preset-mesa").click();
  await expect(calc.getByTestId("club-calc-public")).toHaveText("$197.136");
  await expect(calc.getByTestId("club-calc-you")).toHaveText("$180.000");
  await calc.getByTestId("club-calc-preset-lista").click();
  await expect(calc.getByTestId("club-calc-free")).toBeVisible();
  await expect(calc.getByTestId("club-calc-payer-buyer")).toHaveCount(0);
});

test("el ranking de RRPP se reordena y cada fila muestra su link", async ({ page }) => {
  await open(page);
  const board = page.getByTestId("club-rrpp");
  await board.scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="club-rrpp"]');
  await expect(board.getByTestId("club-rrpp-link")).toHaveText(/\?ref=cata$/);
  await board.getByTestId("club-rrpp-sort-revenue").click();
  await expect(board.getByTestId("club-rrpp-sort-revenue")).toHaveAttribute("aria-checked", "true");
  await expect(board.locator("tbody tr").first()).toHaveAttribute("data-testid", "club-rrpp-row-directo");
  await board.getByRole("button", { name: "Nico V." }).click();
  await expect(board.getByTestId("club-rrpp-link")).toHaveText(/\?ref=nico$/);
});

test("la noche en vivo se mueve con el crossfader y el teclado", async ({ page }) => {
  await open(page);
  const night = page.getByTestId("club-night");
  await night.scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="club-night"]');
  const fader = night.getByTestId("club-night-fader");
  await fader.focus();
  await page.keyboard.press("End");
  await expect(night.getByTestId("club-night-final")).toContainText("Ingresaron 498 de 539");
  await page.keyboard.press("Home");
  await expect(night.getByTestId("club-night-sign")).toHaveText("Abrimos 23:30");
  await page.keyboard.press("PageUp");
  await page.keyboard.press("PageUp");
  await expect(fader).toHaveAttribute("aria-valuetext", "00:00, 96 personas adentro");
});

test("lo que no existe va con Pronto y sin testimonio real no hay cita", async ({ page }) => {
  await open(page);
  // Facebook, TikTok y el reel en la serie, y los gustos en los anuncios, ya existen
  await expect(page.getByTestId("club-series").getByTestId("soon-badge")).toHaveCount(0);
  await expect(page.getByTestId("club-ads-demo").getByTestId("soon-badge")).toHaveCount(0);
  // El acceso del RRPP a sus números y cuántos de cada lista entraron ya existen
  await expect(page.locator("#lista").getByTestId("soon-badge")).toHaveCount(0);
  await expect(page.locator("#lista")).toContainText("en su celular ve cuántas entradas vendió");
  await expect(page.getByTestId("club-rrpp-soon")).toContainText("Cuántos de cada lista entraron, en las métricas de tu noche");
  // Validar la hora de ingreso de la lista (estado de 01:30); el aforo en vivo en el panel ya existe
  await expect(page.getByTestId("club-night").getByTestId("soon-badge")).toHaveCount(1);
  await expect(page.getByTestId("club-night")).toContainText("Aforo en vivo en tu panel");
  await expect(page.locator("#puerta").getByTestId("soon-badge")).toHaveCount(1);
  // Un QR para cada invitado de la mesa ya existe (people_per_ticket)
  await expect(page.locator("#mesas").getByTestId("soon-badge")).toHaveCount(0);
  await expect(page.getByTestId("club-table-guests")).toContainText("6 QR en la orden");
  await expect(page.locator("[data-cl-testimonial]")).toHaveCount(0);
});

test("los plazos de pago son los del código", async ({ page }) => {
  await open(page);
  const text = await page.locator("main").innerText();
  expect(text).toContain(PAYOUT_SCHEDULE_TEXT);
});

test("con 'reducir movimiento' la noche queda en 01:30 sin Repetir y el timbre se ve completo", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  const night = page.getByTestId("club-night");
  await night.scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="club-night"]');
  await expect(night.getByTestId("club-night-inside")).toHaveText("455");
  await expect(night.getByTestId("club-night-replay")).toHaveCount(0);
  const mask = await page.locator('[data-uv="hero"] .cl-uv-lit').evaluate((el) => getComputedStyle(el).maskImage);
  expect(mask).toBe("none");
});

test("/ticketera-clubs y /ticketera-clubes redirigen con 301", async ({ request }) => {
  for (const path of ["/ticketera-clubs", "/ticketera-clubes"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(new URL(res.headers().location, "http://x").pathname).toBe(PATH);
  }
});

test("la barra flotante de mobile aparece pasado el hero y se esconde en el cierre", async ({ page, isMobile }) => {
  test.skip(!isMobile, "La barra flotante es solo de mobile");
  await open(page);
  await page.locator('astro-island[component-url*="LandingMobileBar"]:not([ssr])').waitFor({ state: "attached" });
  const bar = page.getByTestId("landing-mobile-bar");
  await expect(bar).toHaveCount(0);
  await page.locator("#noches").scrollIntoViewIfNeeded();
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("link", { name: "Publicar mi noche" })).toHaveAttribute("href", /utm_campaign=clubs_mobile_bar/);
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
  await expect(page.locator('a[href="/ticketera-discotecas"]').first()).toBeAttached();
  await expect(page.locator('footer a[href="/ticketera-discotecas"]')).toBeAttached();
});
