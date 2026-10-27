// Landing de academias (/academias, docs/specs/rediseno/SPEC_landing_academias_aitickets.md): el comparador, la
// calculadora y los criterios de aceptación que no dependen de la BD. La fórmula del precio es la del checkout
// (fees.mjs); el plazo de pago, el de legal.mjs; lo que no existe en el producto va con "Pronto".
import { expect, test, type Page } from "@playwright/test";
import { waitForIsland } from "./env";
import { PAYOUT_RELEASE_HOURS } from "../../netlify/lib/legal.mjs";

const PATH = "/academias";

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
  await expect(page.getByRole("heading", { level: 1 })).toContainText("El día de la muestra, preocúpate solo del escenario.");
  const publish = page.locator('[data-cta="publish"][data-section="hero"]');
  await expect(publish).toBeVisible();
  await expect(publish).toHaveAttribute("href", /^\/organizadores\/registro\?next=.*utm_campaign=academias_hero/);
  await page.waitForLoadState("networkidle");
  expect(errors.filter((text) => !/google-analytics|googletagmanager|partytown|ERR_FAILED/.test(text))).toEqual([]);
});

test("el comparador arranca en Antes y pasa solo a Con AI Tickets una vez", async ({ page }) => {
  await open(page);
  const compare = page.getByTestId("academy-compare");
  await waitForIsland(page, '[data-testid="academy-compare"]');
  await expect(compare).toHaveAttribute("data-mode", "before");
  await page.locator("#ac-compare-body").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("academy-compare-list")).toContainText("80 mensajes preguntando lo mismo");
  await expect(compare).toHaveAttribute("data-mode", "after", { timeout: 6000 });
  await expect(page.getByTestId("academy-compare-after")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("academy-compare-list")).toContainText("Un link en el grupo, y listo");
  // La lista de asistentes por función todavía no existe
  await expect(page.locator("#ac-compare-body").getByTestId("soon-badge")).toHaveText("Pronto");
});

test("si la persona elige antes, el comparador no cambia solo", async ({ page }) => {
  await open(page);
  const compare = page.getByTestId("academy-compare");
  await waitForIsland(page, '[data-testid="academy-compare"]');
  const before = page.getByTestId("academy-compare-before");
  await before.scrollIntoViewIfNeeded();
  await before.click();
  await page.waitForTimeout(3200);
  await expect(compare).toHaveAttribute("data-mode", "before");
  await expect(before).toHaveAttribute("aria-checked", "true");
});

test("con 'reducir movimiento' el comparador queda en Con AI Tickets", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await waitForIsland(page, '[data-testid="academy-compare"]');
  await expect(page.getByTestId("academy-compare")).toHaveAttribute("data-mode", "after");
});

test("la calculadora coincide con el checkout ($5.000 → $5.476 / $5.000; absorbido $4.524)", async ({ page, isMobile }) => {
  await open(page);
  const calc = page.getByTestId("academy-calculator");
  await calc.scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="academy-calculator"]');
  await expect(calc.getByTestId("academy-calculator-family")).toHaveText("$5.476");
  await expect(calc.getByTestId("academy-calculator-academy")).toHaveText("$5.000");
  if (isMobile) {
    // §3.10: en mobile no hay selector, se muestra el caso "paga la familia"
    await expect(calc.getByRole("radiogroup")).toBeHidden();
    return;
  }
  await calc.getByTestId("academy-calculator-payer-producer").click();
  await expect(calc.getByTestId("academy-calculator-family")).toHaveText("$5.000");
  await expect(calc.getByTestId("academy-calculator-academy")).toHaveText("$4.524");
});

test("los plazos de pago son los del código y sin testimonio real no hay cita", async ({ page }) => {
  await open(page);
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(new RegExp(`${PAYOUT_RELEASE_HOURS} horas después del evento`, "i"));
  expect(text).toContain(`disponible para retirar ${PAYOUT_RELEASE_HOURS} horas`);
  await expect(page.locator("[data-ac-testimonial]")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Hecho para" })).toBeVisible();
});

test("la barra flotante de mobile aparece pasado el hero y se esconde en el cierre", async ({ page, isMobile }) => {
  test.skip(!isMobile, "La barra flotante es solo de mobile");
  await open(page);
  await page.locator('astro-island[component-url*="LandingMobileBar"]:not([ssr])').waitFor({ state: "attached" });
  const bar = page.getByTestId("landing-mobile-bar");
  await expect(bar).toHaveCount(0);
  await page.locator("#como").scrollIntoViewIfNeeded();
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("Gratis para muestras gratis");
  await expect(bar.getByRole("link", { name: "Crear muestra" })).toHaveAttribute("href", /utm_campaign=academias_mobile_bar/);
  await page.locator("[data-final-cta]").scrollIntoViewIfNeeded();
  await expect(bar).toHaveCount(0);
});

test("el footer y /organizadores enlazan la landing", async ({ page }) => {
  await page.goto("/organizadores");
  await expect(page.locator('a[href="/academias"]').first()).toBeAttached();
  await expect(page.locator('footer a[href="/academias"]')).toBeAttached();
});
