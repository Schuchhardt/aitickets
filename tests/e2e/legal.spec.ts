// Páginas legales y pie de página: el operador en Chile es Servicios Informáticos Sebastián Schuchhardt EIRL,
// que aparece SOLO en términos y aviso de privacidad (no en el footer). Sin rastros de Chanium/Delaware ni TODO.
import { expect, test } from "@playwright/test";

const PAGES = [
  { path: "/terms", heading: /Términos/i },
  { path: "/privacy", heading: /Privacidad/i },
  { path: "/terminos-productores", heading: /Términos/i },
];

for (const { path, heading } of PAGES) {
  test(`${path} identifica a la EIRL operadora`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(heading);
    const main = page.locator("main");
    await expect(main).toContainText("Servicios Informáticos Sebastián Schuchhardt EIRL");
    await expect(main).toContainText("77.893.286-5");
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/Chanium|Delaware|DMCA/);
    expect(text).not.toContain("AI Tickets SpA");
    expect(text).not.toMatch(/\bTODO\b/);
  });
}

test("el pie de página muestra solo la marca y enlaza los documentos legales", async ({ page }) => {
  await page.goto("/terms");
  const footer = page.locator("footer").last();
  await expect(footer).toContainText("© 2026 AI Tickets");
  await expect(footer.locator('a[href="/terms"]').first()).toBeVisible();
  await expect(footer.locator('a[href="/privacy"]').first()).toBeVisible();
  await expect(footer.locator('a[href="/terminos-productores"]').first()).toBeAttached();
  const text = await footer.innerText();
  expect(text).not.toMatch(/EIRL|77\.893\.286|Chanium|SpA/);
});

test("/privacy tiene la sección de contacto comercial (B2B) y lista a Didit", async ({ page }) => {
  await page.goto("/privacy#contacto-comercial");
  await expect(page.locator("#contacto-comercial")).toBeAttached();
  await expect(page.locator("main")).toContainText("Didit");
});
