// Portada, landing de organizadores y páginas SEO (landings, guías, comparativa): se sirven sin BD.
// En el proyecto "mobile" (390 px) también comprueba que ninguna página tenga scroll horizontal.
import { expect, test } from "@playwright/test";

const PAGES: { path: string; h1: RegExp; competitorPayout?: boolean }[] = [
  { path: "/", h1: /Tu próxima función/ },
  { path: "/organizadores", h1: /merece vender más/ },
  { path: "/ticketera-stand-up", h1: /Tú haz el show/ },
  { path: "/ticketera-teatro", h1: /Que suba el telón/ },
  { path: "/ticketera-musica-en-vivo", h1: /Tú pon la música/ },
  { path: "/ticketera-discotecas", h1: /Abre la puerta/ },
  { path: "/ticketera-fiestas", h1: /Preventa 1: agotada/ },
  { path: "/ticketera-talleres", h1: /Abre inscripciones con un link/ },
  { path: "/ticketera-seminarios", h1: /Tú armas el programa/ },
  { path: "/academias", h1: /El día de la muestra/ },
  { path: "/vender-entradas-online", h1: /entradas/i },
  { path: "/entradas-con-qr", h1: /QR/ },
  { path: "/ventas-por-promotor", h1: /promotor/i },
  // Cita el plazo de Ticketplus (48–72 h) como dato de la competencia
  { path: "/ticketeras-en-chile", h1: /ticketeras/i, competitorPayout: true },
  { path: "/guias", h1: /Guías/i },
  { path: "/guias/como-vender-entradas-online", h1: /vender entradas/i },
];

for (const { path, h1, competitorPayout } of PAGES) {
  test(`${path} responde con su H1, canonical y sin scroll horizontal`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(h1);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(new URL(canonical!).pathname.replace(/\/$/, "") || "/").toBe(path);
    const text = await page.locator("body").innerText();
    // Plazo de pago anterior (antes de la liberación por función) y promesas a futuro
    if (!competitorPayout) expect(text).not.toMatch(/48\s*[–-]\s*72/);
    expect(text).not.toMatch(/Próximamente/i);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

// Search Console: "Bloqueada por robots.txt" (enlaces a rutas con Disallow) y "Página alternativa con etiqueta
// canónica adecuada" (enlaces internos con ?utm_*/next en la query, otra URL por cada botón). Los enlaces internos
// llevan esos parámetros en el fragmento (#, src/components/landing/links.js) y nunca apuntan a rutas bloqueadas.
const ROBOTS_DISALLOWED = ["/dashboard/", "/api/", "/order/", "/ticket/", "/qr/", "/pago/", "/payment-confirmation", "/o/_host/"];
for (const path of [...PAGES.map((p) => p.path), "/organizadores/registro", "/precios", "/web-gratis", "/eventos"]) {
  test(`${path}: enlaces internos sin parámetros de seguimiento en la query ni rutas bloqueadas por robots.txt`, async ({ page, baseURL }) => {
    await page.goto(path);
    const origin = new URL(baseURL!).origin;
    const hrefs = await page.locator("a[href]").evaluateAll((els) => els.map((a) => (a as HTMLAnchorElement).href));
    const internal = hrefs.map((h) => new URL(h)).filter((u) => u.origin === origin);
    expect(internal.filter((u) => /(^|&)(utm_[a-z]+|next)=/.test(u.search.slice(1))).map((u) => u.href)).toEqual([]);
    expect(internal.filter((u) => ROBOTS_DISALLOWED.some((p) => u.pathname.startsWith(p))).map((u) => u.href)).toEqual([]);
  });
}

test("robots.txt bloquea solo rutas privadas y declara el sitemap", async ({ request }) => {
  const res = await request.get("/robots.txt");
  expect(res.status()).toBe(200);
  const body = await res.text();
  const disallowed = [...body.matchAll(/^Disallow:\s*(\S+)/gm)].map((m) => m[1]);
  expect(disallowed.sort()).toEqual([...ROBOTS_DISALLOWED].sort());
  expect(body).toMatch(/^Sitemap: https:\/\/aitickets\.cl\/sitemap\.xml$/m);
});

test("los CTA de la portada llevan a crear cuenta y quedan marcados para GA4", async ({ page }) => {
  await page.goto("/");
  const publish = page.locator('[data-cta="publish"][data-section="hero"]');
  await expect(publish).toHaveAttribute("href", /^\/organizadores\/registro#next=/);
  await expect(page.locator('[data-cta="whatsapp"]').first()).toHaveAttribute("href", /wa\.me/);
});

test("el ejemplo de precio coincide con el checkout ($10.000 → $10.952 / $9.048)", async ({ page }) => {
  await page.goto("/");
  const body = page.locator("body");
  await expect(body).toContainText("$10.952");
  await expect(body).toContainText("$9.048");
});

test("el sitemap incluye las páginas SEO", async ({ request }) => {
  const res = await request.get("/sitemap.xml");
  expect(res.status()).toBe(200);
  const xml = await res.text();
  for (const path of ["/ticketera-stand-up", "/ticketera-musica-en-vivo", "/ticketera-discotecas", "/ticketera-fiestas", "/ticketera-teatro", "/ticketera-talleres", "/ticketera-seminarios", "/academias", "/ventas-por-promotor", "/ticketeras-en-chile", "/guias/como-hacer-check-in-con-qr"]) {
    expect(xml).toContain(`${path}</loc>`);
  }
});

test("los términos dicen que en una cancelación se devuelve el cargo con su IVA", async ({ page }) => {
  await page.goto("/terms");
  await expect(page.locator("body")).toContainText("con su IVA");
  await expect(page.locator("body")).not.toContainText("no se devuelve");
  await page.goto("/precios");
  await expect(page.locator("body")).not.toContainText("IVA del cargo no se devuelve");
});

test("la portada muestra los ocho nichos y cada card lleva a su landing", async ({ page }) => {
  await page.goto("/");
  const cards = page.locator('[data-cta="niche"]');
  await expect(cards).toHaveCount(8);
  for (const href of ["/ticketera-stand-up", "/ticketera-teatro", "/ticketera-musica-en-vivo", "/ticketera-discotecas", "/ticketera-fiestas", "/ticketera-talleres", "/ticketera-seminarios", "/academias"]) {
    await expect(page.locator(`[data-cta="niche"][href="${href}"]`)).toHaveCount(1);
  }
  await expect(page.locator("#precios")).toBeVisible();
});
