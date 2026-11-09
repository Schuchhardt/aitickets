// Precalentamiento del servidor de desarrollo para los e2e con base real (playwright.stack.config.ts). Igual que
// tests/e2e/global-setup.ts: visita las páginas con islas hasta que Vite deje de optimizar dependencias y recargar, para
// que un test no pierda lo escrito en un formulario. Además espera a que pase el arranque del adaptador de Netlify (si su
// emulación de edge functions falla, Vite muestra un overlay de error a las páginas abiertas en ese momento).
import { chromium, type FullConfig } from "@playwright/test";

const WARMUP_PATHS = [
  "/terms",
  "/organizadores/registro",
  "/organizadores/login",
  "/organizadores/recuperar",
  "/invitacion/aitinv_warmup",
  "/validador",
  "/dashboard",
];

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL;
  if (!baseURL) return;
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
        await page.waitForTimeout(1500);
        page.off("load", onLoad);
        if (loads > 1) reloads++;
      }
      if (reloads === 0 && round > 0) break;
    }
    // Una página nueva no debe recibir un overlay de error (si aparece, el arranque aún no terminó: se espera)
    for (let i = 0; i < 6; i++) {
      await page.goto("/terms", { waitUntil: "networkidle" }).catch(() => {});
      await page.waitForTimeout(5000);
      if (!(await page.locator("vite-error-overlay").count())) break;
    }
  } finally {
    await browser.close();
  }
}
