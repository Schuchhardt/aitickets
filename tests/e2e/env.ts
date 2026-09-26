// Utilidades compartidas de los e2e.

/** true si el servidor bajo prueba tiene una BD real (E2E_DB=1 o un servidor propio con E2E_BASE_URL). */
export const HAS_DB = process.env.E2E_DB === "1" || Boolean(process.env.E2E_BASE_URL?.trim());

export const NO_DB_REASON =
  "Requiere base de datos: corre con E2E_DB=1 (usa el .env local) o contra tu propio `netlify dev` con E2E_BASE_URL.";

export const DEMO_EVENT_SLUG = "evento-demo-aitickets";

/**
 * Espera a que la isla de Astro que contiene `selector` esté hidratada (Astro quita el atributo `ssr`
 * al hidratar). Sin esto, escribir en un input antes de la hidratación se pierde.
 */
export async function waitForIsland(page: import("@playwright/test").Page, selector: string) {
  await page.locator(`astro-island:not([ssr]):has(${selector})`).first().waitFor({ state: "attached" });
}
