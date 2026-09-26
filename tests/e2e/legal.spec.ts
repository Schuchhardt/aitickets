// Páginas legales y pie de página: el operador es Chanium LLC (nunca "AI Tickets SpA") y no hay TODO visibles.
import { expect, test } from "@playwright/test";

const PAGES = [
  { path: "/terms", heading: /Términos/i },
  { path: "/privacy", heading: /Privacidad/i },
  { path: "/terminos-productores", heading: /Términos/i },
];

for (const { path, heading } of PAGES) {
  test(`${path} identifica a Chanium LLC`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(heading);
    const main = page.locator("body");
    await expect(main).toContainText("Chanium LLC");
    await expect(main).toContainText("Delaware");
    const text = await main.innerText();
    expect(text).not.toContain("AI Tickets SpA");
    expect(text).not.toMatch(/\bTODO\b/);
  });
}

test("el pie de página muestra al operador y enlaza los documentos legales", async ({ page }) => {
  await page.goto("/terms");
  const footer = page.locator("footer").last();
  await expect(footer).toContainText("Chanium LLC");
  await expect(footer.locator('a[href="/terms"]').first()).toBeVisible();
  await expect(footer.locator('a[href="/privacy"]').first()).toBeVisible();
  await expect(footer.locator('a[href="/terminos-productores"]').first()).toBeAttached();
  expect(await footer.innerText()).not.toContain("SpA");
});

test("/privacy tiene la sección de contacto comercial (B2B)", async ({ page }) => {
  await page.goto("/privacy#contacto-comercial");
  await expect(page.locator("#contacto-comercial")).toBeAttached();
});
