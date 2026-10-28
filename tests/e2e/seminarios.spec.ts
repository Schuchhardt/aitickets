// Landing de seminarios (/ticketera-seminarios, docs/specs/rediseno/SPEC_landing_seminarios_aitickets.md): H1 sin JS, FAQ
// con JSON-LD, la cotización (fórmula del checkout, fees.mjs), la matriz de acceso (una entrada para un día o para todos,
// nunca dos sueltos), la mesa de acreditación con el aviso de otra función y la validación manual, las láminas del hero
// sin avance automático con "reducir movimiento" y los criterios que no dependen de la BD. El plazo de pago es el de
// legal.mjs y lo que no existe en el producto va con "Pronto".
import { expect, test, type Page } from "@playwright/test";
import { waitForIsland } from "./env";
import { PAYOUT_SCHEDULE_TEXT } from "../../netlify/lib/legal.mjs";

const PATH = "/ticketera-seminarios";

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
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Tú armas el programa.");
  const publish = page.locator('[data-cta="publish"][data-section="hero"]');
  await expect(publish).toBeVisible();
  await expect(publish).toHaveAttribute("href", /^\/organizadores\/registro\?next=.*utm_campaign=seminarios_hero/);
  await expect(page.locator('[data-cta="demo"][data-section="hero"]')).toHaveAttribute("href", "/eventos/evento-demo-gratis");
  await page.waitForLoadState("networkidle");
  expect(errors.filter((text) => !/google-analytics|googletagmanager|partytown|ERR_FAILED|Failed to fetch/.test(text))).toEqual([]);
});

test("sin JS se lee completa: H1, la matriz de solo lectura, la mesa como lista y la FAQ con su JSON-LD", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("La acreditación es un QR.");
  await expect(page.getByTestId("seminar-matrix").locator("tbody tr")).toHaveCount(4);
  await expect(page.getByTestId("seminar-matrix").locator('input[type="radio"]')).toHaveCount(0);
  await expect(page.getByTestId("seminar-card-label")).toHaveText("2 funciones");
  await expect(page.getByTestId("seminar-desk").locator("ol li")).toHaveCount(5);
  const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
  const faq = JSON.parse(jsonLd || "[]").find((item: { "@type": string }) => item["@type"] === "FAQPage");
  expect(faq.mainEntity).toHaveLength(20);
  await expect(page.getByTestId("landing-faq").getByRole("button")).toHaveCount(20);
  await context.close();
});

test("la cotización coincide con el checkout ($60.000 → $65.712 / $60.000; si se vende todo, $11.800.000)", async ({ page }) => {
  await open(page);
  const quote = page.getByTestId("seminar-quote");
  await quote.scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="seminar-quote"]');
  await expect(quote.getByTestId("seminar-quote-public-0")).toHaveText("$65.712");
  await expect(quote.getByTestId("seminar-quote-you-0")).toHaveText("$7.200.000");
  await expect(quote.getByTestId("seminar-quote-total-you")).toHaveText("$11.800.000");
  await expect(quote.getByTestId("seminar-quote-total-public")).toHaveText("$12.923.360");
  await quote.getByTestId("seminar-quote-payer-producer").click();
  await expect(quote.getByTestId("seminar-quote-total-you")).toHaveText("$10.676.640");
});

test("la matriz deja una entrada para un día o para todos, y la card dice lo que diría la página real", async ({ page }) => {
  await open(page);
  const program = page.getByTestId("seminar-program");
  await program.scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="seminar-program"]');
  await expect(program.getByTestId("seminar-card-label")).toHaveText("2 funciones");
  await expect(program.getByTestId("seminar-panel-capacity")).toHaveText("Aforo 260");
  // Un radio por columna: elegir "Día 2" para el pase completo deja de marcar "Todos los días" (nunca dos días sueltos)
  const row = program.getByTestId("seminar-matrix-row-pase");
  if (await row.isVisible()) {
    await program.getByTestId("seminar-scope-pase-d2").check();
    await expect(program.getByTestId("seminar-scope-pase-all")).not.toBeChecked();
    await expect(program.getByTestId("seminar-scope-pase-d1")).not.toBeChecked();
    await expect(row.locator('input[type="radio"]:checked')).toHaveCount(1);
  }
  // Seminario de un día: la fila se elige aunque su único radio ya venga marcado, y con preventa la General la espera
  await program.getByTestId("seminar-format-seminario").click();
  const checkout = program.getByTestId("seminar-checkout-row");
  if (await program.getByTestId("seminar-matrix-row-general").isVisible()) {
    await program.getByTestId("seminar-scope-general-d1").click();
    await expect(checkout).toContainText("General");
  }
  await program.getByTestId("seminar-presale").check();
  await expect(checkout).toContainText("Disponible desde el");
  await program.getByTestId("seminar-format-charla").click();
  await expect(program.getByTestId("seminar-panel-functions")).toHaveText("1 función");
  await program.getByTestId("seminar-mode-free").click();
  // Mientras el rótulo anterior sale (C8) hay dos: se espera a que quede solo el nuevo
  await expect(program.getByTestId("seminar-card-label")).toHaveText(["Gratis"]);
});

test("la mesa de acreditación llega al aviso de otra función y a la validación manual", async ({ page }) => {
  await open(page);
  const desk = page.getByTestId("seminar-desk");
  await page.locator("#acreditacion").scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="seminar-desk-next"]');
  const next = page.getByTestId("seminar-desk-next");
  await next.click();
  await expect(page.getByTestId("seminar-desk-result")).toContainText("✅ Entrada validada con éxito para Carolina Muñoz");
  await next.click();
  await expect(page.getByTestId("seminar-desk-result")).toContainText("(pendiente de sincronizar)");
  await next.click();
  await expect(page.getByTestId("seminar-desk-confirm")).toContainText("⚠️ Esta entrada es para otra función:");
  await page.getByTestId("seminar-desk-validate").click();
  await expect(page.getByTestId("seminar-desk-result")).toContainText("· Ojo: entrada para");
  await next.click();
  await expect(page.getByTestId("seminar-desk-search")).toBeVisible();
  await page.getByTestId("seminar-desk-manual").click();
  await expect(page.getByTestId("seminar-desk-result")).toContainText("✅ Entrada validada manualmente para Rodrigo Pérez");
  await expect(desk.getByTestId("seminar-desk-count")).toContainText("214 / 272");
});

test("lo que no existe va con Pronto y sin testimonio real no hay cita", async ({ page }) => {
  await open(page);
  // La agenda con expositores (el ingreso diario con el mismo pase ya existe)
  await expect(page.locator("#programa").getByTestId("soon-badge")).toHaveCount(1);
  // Datos de cada asistente y de facturación al comprar
  await expect(page.locator("#empresas").getByTestId("soon-badge")).toHaveCount(2);
  // Facebook, TikTok y reels en la serie, LinkedIn desde el panel y segmentar por profesión
  await expect(page.locator("#difusion").getByTestId("soon-badge")).toHaveCount(5);
  // La lista de espera ya existe: sin "Pronto"
  await expect(page.locator("#pagina").getByTestId("soon-badge")).toHaveCount(0);
  // Aforo en vivo y credenciales impresas (el ingreso diario ya existe)
  await expect(page.locator("#acreditacion").getByTestId("soon-badge")).toHaveCount(2);
  await expect(page.locator("#acreditacion")).toContainText("El pase completo, cada día.");
  // Certificados de asistencia
  await expect(page.locator('[data-se-section="despues"]').getByTestId("soon-badge")).toHaveCount(1);
  await expect(page.locator("[data-se-testimonial]")).toHaveCount(0);
});

test("los plazos de pago son los del código", async ({ page }) => {
  await open(page);
  const text = await page.locator("main").innerText();
  expect(text).toContain(PAYOUT_SCHEDULE_TEXT);
});

test("con 'reducir movimiento' las láminas del hero no avanzan solas", async ({ page, isMobile }) => {
  test.skip(isMobile, "En mobile las láminas van en carrusel, sin avance automático");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await waitForIsland(page, '[data-testid="seminar-hero-screen"]');
  const count = page.getByTestId("seminar-slide-count");
  await expect(count).toContainText("1 / 3");
  await expect(page.getByTestId("seminar-slide-pause")).toHaveCount(0);
  await page.waitForTimeout(6800);
  await expect(count).toContainText("1 / 3");
  await page.getByTestId("seminar-slide-next").click();
  await expect(count).toContainText("2 / 3");
});

test("la barra flotante de mobile aparece pasado el hero y se esconde en el cierre", async ({ page, isMobile }) => {
  test.skip(!isMobile, "La barra flotante es solo de mobile");
  await open(page);
  await page.locator('astro-island[component-url*="LandingMobileBar"]:not([ssr])').waitFor({ state: "attached" });
  const bar = page.getByTestId("landing-mobile-bar");
  await expect(bar).toHaveCount(0);
  await page.locator("#para-quien").scrollIntoViewIfNeeded();
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("link", { name: "Publicar mi seminario" })).toHaveAttribute("href", /utm_campaign=seminarios_mobile_bar/);
  await page.locator("[data-final-cta]").scrollIntoViewIfNeeded();
  await expect(bar).toHaveCount(0);
});

test("en mobile no hay scroll horizontal", async ({ page, isMobile }) => {
  test.skip(!isMobile, "El ancho que importa es el de 390 px");
  await open(page);
  await page.locator("[data-final-cta]").scrollIntoViewIfNeeded();
  await page.waitForLoadState("networkidle");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("el footer, /organizadores y talleres enlazan la landing", async ({ page }) => {
  await page.goto("/organizadores");
  await expect(page.locator('a[href="/ticketera-seminarios"]').first()).toBeAttached();
  await expect(page.locator('footer a[href="/ticketera-seminarios"]')).toBeAttached();
  await page.goto("/ticketera-talleres");
  await expect(page.locator('main a[href="/ticketera-seminarios"]').first()).toBeAttached();
});
