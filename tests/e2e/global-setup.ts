// Precalentamiento del servidor de desarrollo antes de los e2e.
// Con un servidor en frío (siempre en CI), Vite descubre dependencias del cliente al hidratar las islas,
// las optimiza y RECARGA la página: un test que ya estaba llenando un formulario pierde lo escrito.
// Aquí se visitan las páginas con islas una vez (hasta que no haya recargas) para que eso pase antes.
import { chromium, type FullConfig } from "@playwright/test";

const WARMUP_PATHS = ["/terms", "/precios", "/o/demo", "/o/demo/contacto", "/outreach/baja?t=warmup"];

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL;
  if (!baseURL || process.env.E2E_BASE_URL?.trim()) return; // servidor externo: ya está caliente
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL });
    for (let round = 0; round < 3; round++) {
      let reloads = 0;
      for (const path of WARMUP_PATHS) {
        let loads = 0;
        const onLoad = () => loads++;
        page.on("load", onLoad);
        await page.goto(path, { waitUntil: "networkidle", timeout: 90_000 }).catch(() => {});
        // Las islas client:visible hidratan al verse
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
        await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(1500);
        page.off("load", onLoad);
        if (loads > 1) reloads++;
      }
      if (reloads === 0 && round > 0) break;
    }
  } finally {
    await browser.close();
  }
}
