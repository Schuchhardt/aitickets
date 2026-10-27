// Lo transversal de las landings (docs/specs/rediseno/README.md, commit 13): SEO de cada página (Open Graph con su
// tarjeta 1200×630 de src/lib/ogPages.ts, JSON-LD), fotos servidas en AVIF/WebP con tamaño reservado, el hub de
// /organizadores y el footer enlazando todas las landings por tipo de evento, y la analítica lp_ de /organizadores
// (SPEC_landing_productores §11).
import { expect, test, type Page } from "@playwright/test";
import { captureAnalytics, playModalVideo, trackedEvents as events, waitForIsland } from "./env";

const LANDINGS: { path: string; schemas: string[]; ogImage: RegExp }[] = [
  { path: "/organizadores", schemas: ["Organization", "SoftwareApplication", "FAQPage"], ogImage: /\/og\/paginas\/organizadores\.jpg\?v=[0-9a-f]{12}$/ },
  { path: "/ticketera-stand-up", schemas: ["BreadcrumbList", "SoftwareApplication", "FAQPage"], ogImage: /\/og\/paginas\/ticketera-stand-up\.jpg\?v=[0-9a-f]{12}$/ },
  { path: "/academias", schemas: ["BreadcrumbList", "SoftwareApplication", "FAQPage"], ogImage: /\/og\/paginas\/academias\.jpg\?v=[0-9a-f]{12}$/ },
  { path: "/ticketera-musica-en-vivo", schemas: ["BreadcrumbList", "SoftwareApplication", "FAQPage"], ogImage: /\/og\/paginas\/ticketera-musica-en-vivo\.jpg\?v=[0-9a-f]{12}$/ },
  { path: "/ticketera-teatro", schemas: ["BreadcrumbList", "SoftwareApplication", "FAQPage"], ogImage: /\/og\/paginas\/ticketera-teatro\.jpg\?v=[0-9a-f]{12}$/ },
  { path: "/ticketera-talleres", schemas: ["BreadcrumbList", "SoftwareApplication", "FAQPage"], ogImage: /\/og\/paginas\/ticketera-talleres\.jpg\?v=[0-9a-f]{12}$/ },
  { path: "/ticketera-discotecas", schemas: ["BreadcrumbList", "SoftwareApplication", "FAQPage"], ogImage: /\/og\/paginas\/ticketera-discotecas\.jpg\?v=[0-9a-f]{12}$/ },
  { path: "/ticketera-fiestas", schemas: ["BreadcrumbList", "SoftwareApplication", "FAQPage"], ogImage: /\/og\/paginas\/ticketera-fiestas\.jpg\?v=[0-9a-f]{12}$/ },
  { path: "/ticketera-seminarios", schemas: ["BreadcrumbList", "SoftwareApplication", "FAQPage"], ogImage: /\/og\/paginas\/ticketera-seminarios\.jpg\?v=[0-9a-f]{12}$/ },
];

const VERTICALS = [
  "/ticketera-stand-up",
  "/ticketera-teatro",
  "/ticketera-musica-en-vivo",
  "/ticketera-discotecas",
  "/ticketera-fiestas",
  "/ticketera-talleres",
  "/ticketera-seminarios",
  "/academias",
];

async function open(page: Page, path: string) {
  await page.route(/google-analytics\.com|googletagmanager\.com/, (route) => route.abort());
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
}

for (const { path, schemas, ogImage } of LANDINGS) {
  test(`${path}: title, description, Open Graph y JSON-LD`, async ({ page }) => {
    await open(page, path);
    const title = await page.title();
    expect(title).toMatch(/AI Tickets/);
    const description = await page.locator('meta[name="description"]').getAttribute("content");
    expect(description?.length ?? 0).toBeGreaterThan(80);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", title);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", description!);
    const ogUrl = await page.locator('meta[property="og:url"]').getAttribute("content");
    expect(new URL(ogUrl!).pathname).toBe(path);
    const image = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(image).toMatch(/^https?:\/\//);
    expect(image).toMatch(ogImage);

    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const types = blocks.flatMap((text) => {
      const data = JSON.parse(text);
      return (Array.isArray(data) ? data : [data]).map((d) => d["@type"]);
    });
    for (const schema of schemas) expect(types).toContain(schema);
  });

  test(`${path}: fotos en AVIF/WebP con ancho y alto reservados`, async ({ page }) => {
    await open(page, path);
    const pictures = page.locator("main picture");
    expect(await pictures.count()).toBeGreaterThan(0);
    const bad = await pictures.evaluateAll((list) =>
      list
        .filter((p) => {
          const types = [...p.querySelectorAll("source")].map((s) => s.getAttribute("type"));
          const img = p.querySelector("img");
          return !types.includes("image/avif") || !img?.getAttribute("width") || !img?.getAttribute("height");
        })
        .map((p) => p.outerHTML.slice(0, 160)),
    );
    expect(bad).toEqual([]);
    // Ninguna foto de /landing/ suelta en JPG: o va en su <picture> o es la variante AVIF/WebP
    const looseJpg = await page
      .locator("main img")
      .evaluateAll((imgs) =>
        imgs
          .filter((img) => !img.closest("picture") && /\/landing\/[^/]+\.jpe?g$/.test(new URL(img.getAttribute("src") || "", location.href).pathname))
          .map((img) => img.getAttribute("src")),
      );
    expect(looseJpg).toEqual([]);
  });
}

test("el hub de /organizadores y el footer enlazan todas las landings por tipo de evento", async ({ page }) => {
  await open(page, "/organizadores");
  const hub = await page.locator('[data-cta="vertical"]').evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  const footer = await page.locator("footer a").evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  for (const path of VERTICALS) {
    expect(hub).toContain(path);
    expect(footer).toContain(path);
  }
});

test("/organizadores: el video de portada ofrece WebM y MP4", async ({ page }) => {
  await open(page, "/organizadores");
  await page.waitForLoadState("load");
  const video = page.locator(".hero video").first();
  await expect(video).toBeAttached({ timeout: 10_000 });
  await expect(video.locator('source[type="video/webm"]')).toHaveAttribute("src", "/landing/cover-standup.webm");
  await expect(video.locator('source[type="video/mp4"]')).toHaveAttribute("src", "/landing/cover-standup.mp4");
  // El póster del <video> es la versión optimizada que ya bajó el <picture>, no el JPG
  await expect(video).toHaveAttribute("poster", /\.(avif|webp)$/);
});

test.describe("analítica de /organizadores (lp_)", () => {
  test.beforeEach(async ({ page }) => {
    await captureAnalytics(page);
  });

  test("vista, secciones, CTA, FAQ y demos", async ({ page }) => {
    await open(page, "/organizadores");
    expect(await events(page, "lp_view")).toHaveLength(1);
    await expect.poll(async () => (await events(page, "lp_section_view")).map((p) => p.section)).toContain("hero");

    const hero = page.locator('[data-cta="publish"][data-section="hero"]');
    await hero.evaluate((a) => a.addEventListener("click", (e) => e.preventDefault()));
    await hero.click();
    const [cta] = await events(page, "lp_cta_click");
    expect(cta).toMatchObject({ position: "hero" });
    expect(String(cta.label)).toMatch(/\S/);

    const faq = page.getByTestId("landing-faq").first();
    await faq.scrollIntoViewIfNeeded();
    await waitForIsland(page, '[data-testid="landing-faq"]');
    await faq.locator("button").first().click();
    expect((await events(page, "lp_faq_open"))[0]?.question).toBeTruthy();

    // El calendario de marketing es de desktop (en mobile la sección muestra la lista)
    if (test.info().project.name === "mobile") return;
    const week = page.getByTestId("marketing-week");
    await week.scrollIntoViewIfNeeded();
    await waitForIsland(page, '[data-testid="marketing-week"]');
    await week.getByTestId("marketing-toggle-story").click();
    expect(await events(page, "lp_mk_toggle")).toEqual([{ type: "story", on: false }]);

    const ads = page.getByTestId("ads-demo");
    await ads.scrollIntoViewIfNeeded();
    await waitForIsland(page, '[data-testid="ads-demo"]');
    await page.getByTestId("ads-demo-launch").click();
    expect(await events(page, "lp_ads_demo")).toEqual([{ budget: 10000, days: 3 }]);

    const wall = page.getByTestId("wall-demo").first();
    await wall.scrollIntoViewIfNeeded();
    await waitForIsland(page, '[data-testid="wall-demo-input"]');
    await wall.getByTestId("wall-demo-input").fill("Nos vemos");
    await wall.getByTestId("wall-demo-publish").click();
    expect(await events(page, "lp_wall_demo")).toEqual([{ emoji: expect.any(String), has_text: true }]);

    const invite = page.getByTestId("invite-demo");
    await invite.scrollIntoViewIfNeeded();
    await waitForIsland(page, '[data-testid="invite-demo"]');
    await invite.click();
    await invite.click();
    expect(await events(page, "lp_invite_demo")).toHaveLength(1);
  });

  test("WhatsApp, conectar IA y el video del modal con su avance", async ({ page }) => {
    // El video no se baja: el avance se simula (playModalVideo)
    await page.route(/\/videos\/aitickets-demo\.(mp4|webm)$/, (route) => route.abort());
    await open(page, "/organizadores");
    const noNavigation = (link: import("@playwright/test").Locator) => link.evaluate((a) => a.addEventListener("click", (e) => e.preventDefault()));

    const whatsapp = page.locator('[data-cta="whatsapp"][data-section="hero"]');
    await noNavigation(whatsapp);
    await whatsapp.click();
    expect(await events(page, "lp_whatsapp_click")).toEqual([{ position: "hero" }]);

    const connect = page.locator('[data-cta="connect_ai"]');
    await connect.scrollIntoViewIfNeeded();
    await noNavigation(connect);
    await connect.click();
    expect(await events(page, "lp_ai_connect_click")).toHaveLength(1);

    await waitForIsland(page, '[data-testid="video-modal"]');
    const play = page.locator('[data-cta="video"][data-section="hero"]');
    await play.scrollIntoViewIfNeeded();
    await play.click();
    expect(await events(page, "lp_video_open")).toEqual([{ position: "hero" }]);
    const modal = page.getByTestId("video-modal");
    await expect(modal.locator('source[type="video/webm"]')).toHaveAttribute("src", "/videos/aitickets-demo.webm");
    await expect(modal.locator('source[type="video/mp4"]')).toHaveAttribute("src", "/videos/aitickets-demo.mp4");
    await playModalVideo(page);
    // Cada hito una sola vez
    expect(await events(page, "lp_video_progress")).toEqual([{ pct: 25 }, { pct: 50 }, { pct: 75 }, { pct: 100 }]);
  });

  test("sonido de la portada y reseña de la demo del correo (desktop)", async ({ page, isMobile }) => {
    test.skip(isMobile, "La demo del correo es de desktop (en mobile la sección es compacta)");
    await open(page, "/organizadores");
    const cover = page.locator(".comm-desktop .browser-cover");
    await cover.scrollIntoViewIfNeeded();
    // El botón de sonido aparece cuando arranca el video (después de load, en un momento ocioso)
    const sound = cover.getByTestId("cover-sound");
    await expect(sound).toBeVisible({ timeout: 15_000 });
    await sound.click();
    expect(await events(page, "lp_cover_sound")).toEqual([{ on: true }]);

    const review = page.getByTestId("review-demo");
    await review.scrollIntoViewIfNeeded();
    await waitForIsland(page, '[data-testid="review-demo"]');
    await review.getByRole("radio", { name: /^4 estrellas/ }).click();
    await review.getByTestId("review-demo-send").click();
    expect(await events(page, "lp_review_demo")).toEqual([{ stars: 4 }]);
  });

  test("la calculadora manda lp_calc_change una vez por campo, 1 s después del último cambio", async ({ page }) => {
    await open(page, "/organizadores");
    const calc = page.getByTestId("price-calculator");
    await calc.scrollIntoViewIfNeeded();
    await waitForIsland(page, '[data-testid="price-calculator"]');
    const price = page.getByTestId("price-calculator-price");
    await price.fill("15000");
    await price.fill("15990");
    await expect.poll(() => events(page, "lp_calc_change"), { timeout: 4000 }).toEqual([
      { price: 15990, qty: 100, payer: "buyer", field: "price" },
    ]);
    await price.fill("20000");
    await page.getByTestId("price-calculator-payer-producer").click();
    await expect.poll(async () => (await events(page, "lp_calc_change")).length, { timeout: 4000 }).toBe(2);
    expect((await events(page, "lp_calc_change"))[1]).toMatchObject({ price: 20000, payer: "producer", field: "payer" });
  });
});
