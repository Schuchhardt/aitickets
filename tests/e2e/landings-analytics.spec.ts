// Analítica de las landings de nicho (docs/specs/rediseno/README.md, commit 13): cada una manda los eventos de la landing
// principal con su prefijo (SPEC_landing_standup §8, SPEC_landing_academias §6 y §10 de música, teatro, talleres, clubs,
// fiestas y seminarios) más los propios de sus islas; y el embudo de la página del evento (SPEC_evento §14) con la
// página de datos fijos (tests/e2e/fixtures). Lo de /organizadores (lp_) está en landings-seo.spec.ts.
import { expect, test, type Page } from "@playwright/test";
import { captureAnalytics, playModalVideo, trackedEvents as events, waitForIsland } from "./env";
import { FIXTURE_ROUTE, TICKETS } from "./fixtures/event-scenarios.mjs";

type IslandCheck = {
  /** data-testid de la isla */
  island: string;
  /** Interacción con la isla */
  act: (page: Page) => Promise<void>;
  event: string;
  params: Record<string, unknown>;
};

const LANDINGS: { prefix: string; path: string; island: IslandCheck }[] = [
  {
    prefix: "su",
    path: "/ticketera-stand-up",
    island: {
      island: "standup-ads-demo",
      act: (page) => page.getByTestId("standup-ads-launch").click(),
      event: "su_ads_demo",
      params: { budget: 10000, days: 3 },
    },
  },
  {
    prefix: "ac",
    path: "/academias",
    island: {
      island: "academy-compare",
      // Pasa sola a "Con AI Tickets" (auto) y la persona vuelve a "Antes"
      act: async (page) => {
        await expect(page.getByTestId("academy-compare")).toHaveAttribute("data-mode", "after", { timeout: 6000 });
        await page.getByTestId("academy-compare-before").click();
      },
      event: "ac_compare_toggle",
      params: { to: "before", auto: false },
    },
  },
  {
    prefix: "mu",
    path: "/ticketera-musica-en-vivo",
    island: {
      island: "music-audience",
      act: (page) => page.getByTestId("music-audience-producer").click(),
      event: "mu_audience_tab",
      params: { audience: "producer" },
    },
  },
  {
    prefix: "te",
    path: "/ticketera-teatro",
    island: {
      island: "theatre-function-picker",
      act: (page) => page.getByTestId("theatre-pick-f5").click(),
      event: "te_function_pick",
      params: { weekday: expect.any(String) },
    },
  },
  {
    prefix: "tl",
    path: "/ticketera-talleres",
    island: {
      island: "workshop-builder",
      act: (page) => page.getByTestId("workshop-format-course").check(),
      event: "tl_builder_change",
      params: { control: "format", value: "course" },
    },
  },
  {
    prefix: "cl",
    path: "/ticketera-discotecas",
    island: {
      island: "club-calc",
      act: (page) => page.getByTestId("club-calc-preset-mesa").click(),
      event: "cl_calc_preset",
      params: { preset: "mesa" },
    },
  },
  {
    prefix: "fi",
    path: "/ticketera-fiestas",
    island: {
      island: "party-stairs",
      act: (page) => page.getByTestId("party-stairs-play").click(),
      event: "fi_stairs_play",
      params: {},
    },
  },
  {
    prefix: "se",
    path: "/ticketera-seminarios",
    island: {
      island: "seminar-program",
      act: (page) => page.getByTestId("seminar-format-charla").click(),
      event: "se_program_format",
      params: { format: "charla" },
    },
  },
];

async function open(page: Page, path: string) {
  await captureAnalytics(page);
  await page.route(/google-analytics\.com|googletagmanager\.com/, (route) => route.abort());
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
}

/** Evita que el clic en un link navegue (el tracking escucha en la fase de captura, antes) */
const noNavigation = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((a) => a.addEventListener("click", (e) => e.preventDefault()));

for (const { prefix, path, island } of LANDINGS) {
  test.describe(`analítica de ${path} (${prefix}_)`, () => {
    test("vista, sección del hero, CTA del hero y FAQ", async ({ page }) => {
      await open(page, path);
      expect(await events(page, `${prefix}_view`)).toEqual([{ page: path }]);
      await expect.poll(async () => (await events(page, `${prefix}_section_view`)).map((p) => p.section)).toContain("hero");

      const hero = '[data-cta="publish"][data-section="hero"]';
      await noNavigation(page, hero);
      await page.locator(hero).first().click();
      expect(await events(page, `${prefix}_cta_click`)).toEqual([{ position: "hero" }]);

      const faq = page.getByTestId("landing-faq").first();
      await faq.scrollIntoViewIfNeeded();
      await waitForIsland(page, '[data-testid="landing-faq"]');
      await faq.locator("button").first().click();
      const [opened] = await events(page, `${prefix}_faq_open`);
      expect(String(opened?.question)).toMatch(/\S/);
      // Al cerrarla no se manda otro
      await faq.locator("button").first().click();
      expect(await events(page, `${prefix}_faq_open`)).toHaveLength(1);
    });

    test(`${island.event} desde su isla`, async ({ page }) => {
      await open(page, path);
      const root = page.getByTestId(island.island);
      await root.scrollIntoViewIfNeeded();
      await waitForIsland(page, `[data-testid="${island.island}"]`);
      await island.act(page);
      // Algunas islas mandan con debounce (tl_builder_change, 600 ms)
      await expect.poll(() => events(page, island.event), { timeout: 4000 }).toContainEqual(island.params);
    });
  });
}

test("stand-up: abrir el video del modal manda su_video_open y su avance su_video_progress", async ({ page }) => {
  await page.route(/\/videos\/aitickets-demo\.(mp4|webm)$/, (route) => route.abort());
  await open(page, "/ticketera-stand-up");
  await waitForIsland(page, '[data-testid="video-modal"]');
  await page.locator('[data-cta="video"][data-section="hero"]').click();
  expect(await events(page, "su_video_open")).toEqual([{ position: "hero" }]);
  await expect(page.getByTestId("video-modal").locator('source[type="video/webm"]')).toHaveAttribute("src", "/videos/aitickets-demo.webm");
  await playModalVideo(page);
  expect(await events(page, "su_video_progress")).toEqual([{ pct: 25 }, { pct: 50 }, { pct: 75 }, { pct: 100 }]);
});

test("stand-up: la calculadora manda su_calc_change una vez por campo, 1 s después del último cambio", async ({ page }) => {
  await open(page, "/ticketera-stand-up");
  const calc = page.getByTestId("standup-price");
  await calc.scrollIntoViewIfNeeded();
  await waitForIsland(page, '[data-testid="standup-price"]');
  const range = page.getByTestId("standup-price-range");
  await range.fill("15000");
  await range.fill("20000");
  await expect.poll(() => events(page, "su_calc_change"), { timeout: 4000 }).toEqual([{ price: 20000, payer: "buyer", field: "price" }]);
  // El precio ya se midió en esta sesión: solo sale el de quién paga
  await range.fill("25000");
  await page.getByTestId("standup-price-payer-producer").click();
  await expect.poll(async () => (await events(page, "su_calc_change")).length, { timeout: 4000 }).toBe(2);
  expect((await events(page, "su_calc_change"))[1]).toEqual({ price: 25000, payer: "producer", field: "payer" });
});

test.describe("embudo de la página del evento (SPEC_evento §14)", () => {
  const EVENT_ID = 9100;

  test("event_view, checkout_open con su entrada y checkout_qty_change", async ({ page, isMobile }) => {
    await page.route("**/api/events/visit", (route) => route.fulfill({ status: 204 }));
    await open(page, `${FIXTURE_ROUTE}/varias-entradas`);
    // La barra de herramientas de `astro dev` tapa el pie del bottom sheet en mobile
    await page.addStyleTag({ content: "astro-dev-toolbar{display:none!important}" });
    await waitForIsland(page, '[data-testid="event-action-card"]');
    await expect.poll(() => events(page, "event_view")).toEqual([expect.objectContaining({ event_id: EVENT_ID, state: expect.any(String) })]);

    if (isMobile) {
      // Mobile: la barra inferior (aparece al pasar el lugar) abre el checkout
      await page.evaluate(() => window.scrollBy(0, 900));
      const bar = page.getByTestId("mobile-sticky-bar");
      await expect(bar).toBeVisible();
      await bar.getByRole("button").click();
    } else {
      await page.getByTestId("buy-button").click();
    }
    expect(await events(page, "checkout_open")).toEqual([
      expect.objectContaining({ event_id: EVENT_ID, entry: isMobile ? "sticky" : "card" }),
    ]);

    const step1 = page.getByRole("dialog").getByTestId("resv-step-tickets");
    await expect(step1).toBeVisible();
    await step1.getByRole("button", { name: `Agregar una entrada ${TICKETS.vip.ticket_name}`, exact: true }).click();
    expect(await events(page, "checkout_qty_change")).toEqual([
      expect.objectContaining({ event_id: EVENT_ID, ticket_id: TICKETS.vip.id, quantity: 1 }),
    ]);
  });
});
