// Landing de talleres (/ticketera-talleres, docs/specs/rediseno/SPEC_landing_talleres_aitickets.md): H1 sin JS, FAQ
// con JSON-LD, el armador (rótulos de la página real y precio del checkout), la cuenta del cuaderno (fees.mjs, con los
// cupos como multiplicador), el pase de lista, lo que no existe con "Pronto" y los criterios que no dependen de la BD.
import { expect, test, type Page } from "@playwright/test";
import { waitForIsland } from "./env";
import { PAYOUT_RELEASE_HOURS } from "../../netlify/lib/legal.mjs";

const PATH = "/ticketera-talleres";

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
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Abre inscripciones con un link.");
  const publish = page.locator('[data-cta="publish"][data-section="hero"]');
  await expect(publish).toBeVisible();
  await expect(publish).toHaveAttribute("href", /^\/organizadores\/registro\?next=.*utm_campaign=talleres_hero/);
  await expect(page.locator('[data-cta="demo"][data-section="hero"]')).toHaveAttribute("href", "/eventos/evento-demo-gratis");
  // La ficha del hero: el rótulo real para 7 de 10 pagados y el precio final del checkout ($28.000 → $30.666)
  const card = page.getByTestId("workshop-hero-card");
  await expect(card).toContainText("Últimas entradas");
  await expect(card).toContainText("$30.666");
  await page.waitForLoadState("networkidle");
  expect(errors.filter((text) => !/google-analytics|googletagmanager|partytown|ERR_FAILED|Failed to fetch/.test(text))).toEqual([]);
});

test("sin JS se lee completa: H1, pendientes tachados, el armador en su estado inicial y la FAQ con su JSON-LD", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("El día del taller, solo enseña.");
  await expect(page.getByTestId("workshop-pending").locator("s")).toHaveCount(6);
  const builder = page.getByTestId("workshop-builder");
  await expect(builder.getByTestId("workshop-label")).toHaveText("Últimas entradas");
  // Sin JS los controles no se muestran (no responderían)
  await expect(builder.getByTestId("workshop-enrolled")).toBeHidden();
  await expect(page.getByTestId("workshop-roll-count")).toHaveText("9");
  const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
  const faq = JSON.parse(jsonLd || "[]").find((item: { "@type": string }) => item["@type"] === "FAQPage");
  expect(faq.mainEntity).toHaveLength(20);
  await expect(page.getByTestId("landing-faq").getByRole("button")).toHaveCount(20);
  await context.close();
});

test("el armador lleno muestra el rótulo real y el Pronto de la lista de espera", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  const builder = page.getByTestId("workshop-builder");
  await builder.scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="workshop-builder"]');
  // Con "reducir movimiento" queda en 7 de 10, sin moverse solo
  await expect(builder.getByTestId("workshop-enrolled")).toHaveValue("7");
  await builder.getByTestId("workshop-free").check();
  await expect(builder.getByTestId("workshop-label")).toHaveText("Gratis · Quedan 3 cupos");
  await builder.getByTestId("workshop-enrolled").fill("10");
  await expect(builder.getByTestId("workshop-label")).toHaveText("Gratis · Cupos llenos");
  await expect(builder.getByTestId("workshop-waitlist")).toContainText("Avisarme si se libera un cupo");
  await expect(builder.locator('[data-note="waitlist"]').getByTestId("soon-badge")).toHaveCount(0);
  await builder.getByTestId("workshop-paid").check();
  await expect(builder.getByTestId("workshop-label")).toHaveText("Agotado");
});

test("el curso de 4 sesiones muestra la entrada del curso y que se pasa lista en cada sesión", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  const builder = page.getByTestId("workshop-builder");
  await builder.scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="workshop-builder"]');
  await builder.getByTestId("workshop-format-course").check();
  await expect(builder.getByTestId("workshop-phone")).toContainText("Curso completo · 4 sesiones");
  await expect(builder.getByTestId("workshop-phone")).toContainText("Sáb 14, 21 y 28 nov y sáb 5 dic · 10:00");
  // $95.000 con el cargo del checkout
  await expect(builder.getByTestId("workshop-final")).toHaveText("$104.044");
  await expect(builder.locator('[data-note="roll"]')).toContainText("entra una vez por sesión");
  await expect(builder.locator('[data-note="roll"]').getByTestId("soon-badge")).toHaveCount(0);
  await expect(builder.locator('[data-note="payout"]')).toContainText("después de la última sesión");
});

test("la cuenta coincide con el checkout ($25.000 × 12 → $27.380 / $25.000 / $300.000; absorbido $22.620 / $271.440)", async ({ page }) => {
  await open(page);
  const sum = page.getByTestId("workshop-sum");
  await sum.scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="workshop-sum"]');
  await expect(sum.getByTestId("workshop-sum-pays")).toHaveText("$27.380");
  await expect(sum.getByTestId("workshop-sum-gets")).toHaveText("$25.000");
  await expect(sum.getByTestId("workshop-sum-total")).toContainText("$300.000");
  await sum.getByTestId("workshop-sum-payer-producer").click();
  await expect(sum.getByTestId("workshop-sum-pays")).toHaveText("$25.000");
  await expect(sum.getByTestId("workshop-sum-gets")).toHaveText("$22.620");
  await expect(sum.getByTestId("workshop-sum-total")).toContainText("$271.440");
  await sum.getByTestId("workshop-sum-free").check();
  await expect(sum.getByTestId("workshop-sum-zero")).toHaveText("$0 para todos");
});

test("con 'reducir movimiento' los pendientes quedan tachados y el pase de lista en 9 de 10", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await expect(page.locator("html")).not.toHaveClass(/lp-motion/);
  const strike = page.getByTestId("workshop-pending").locator(".tl-pend-strike").first();
  await strike.scrollIntoViewIfNeeded();
  await expect(strike).toBeVisible();
  const roll = page.getByTestId("workshop-roll");
  await roll.scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="workshop-roll"]');
  await page.waitForTimeout(2000);
  await expect(roll.getByTestId("workshop-roll-count")).toHaveText("9");
  // Los dos casos especiales se ven también en mobile (390 px muestra 6 filas)
  await expect(roll.locator(".cr-tag", { hasText: "buscada por nombre" })).toBeVisible();
  await expect(roll.locator(".cr-repeat", { hasText: "Entrada ya validada · 10:04" })).toBeVisible();
});

test("lo que no existe va con Pronto y sin testimonio real no hay cita", async ({ page }) => {
  await open(page);
  // Preguntas al inscribirse (antes), pasar lista por sesión (el día), Facebook/TikTok/reels (difusión), reseñas
  // mientras quedan fechas (después)
  await expect(page.locator("#antes").getByTestId("soon-badge")).toHaveCount(1);
  // Pasar lista en cada sesión ya existe
  await expect(page.locator("#el-dia").getByTestId("soon-badge")).toHaveCount(0);
  await expect(page.locator("#el-dia")).toContainText("una vez en cada sesión");
  await expect(page.locator("#difusion").getByTestId("soon-badge")).toHaveCount(3);
  await expect(page.locator("#despues").getByTestId("soon-badge")).toHaveCount(1);
  await expect(page.locator('[data-tl-section="testimonio"]')).toHaveCount(0);
});

test("los plazos de pago son los del código", async ({ page }) => {
  await open(page);
  // El plazo del nicho (cada fecha o la última sesión del curso), armado con la constante de legal.mjs
  const text = await page.locator("#precio").innerText();
  expect(text).toContain(`disponible ${PAYOUT_RELEASE_HOURS} h después de cada fecha (o de la última sesión del curso)`);
});

test("la barra flotante de mobile aparece pasado el hero y se esconde en el cierre", async ({ page, isMobile }) => {
  test.skip(!isMobile, "La barra flotante es solo de mobile");
  await open(page);
  await page.locator('astro-island[component-url*="LandingMobileBar"]:not([ssr])').waitFor({ state: "attached" });
  const bar = page.getByTestId("landing-mobile-bar");
  await expect(bar).toHaveCount(0);
  await page.locator("[data-hero-cta]").scrollIntoViewIfNeeded();
  await page.locator("#pendientes").scrollIntoViewIfNeeded();
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("link", { name: "Abrir inscripciones" })).toHaveAttribute("href", /utm_campaign=talleres_mobile_bar/);
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
  await expect(page.locator('a[href="/ticketera-talleres"]').first()).toBeAttached();
  await expect(page.locator('footer a[href="/ticketera-talleres"]')).toBeAttached();
});
