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

type TrackedEvent = [string, Record<string, unknown>];

/**
 * Captura lo que la página manda a GA (gtag("event", …)) en window.__events. Llamar antes de page.goto. La propiedad
 * queda fija: ni el stub de Layout ni el `function gtag()` del script de GA (que aquí falla al redeclararla, y GA igual
 * está bloqueado) ni Partytown la reemplazan.
 */
export async function captureAnalytics(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const events: [string, Record<string, unknown>][] = [];
    Object.defineProperty(window, "__events", { value: events });
    Object.defineProperty(window, "gtag", {
      value: (...args: unknown[]) => {
        if (args[0] === "event") events.push([String(args[1]), (args[2] as Record<string, unknown>) || {}]);
      },
      writable: false,
      enumerable: true,
      configurable: false,
    });
  });
}

/** Parámetros de cada evento `name` capturado por captureAnalytics, en orden. */
export function trackedEvents(page: import("@playwright/test").Page, name: string) {
  return page.evaluate(
    (n) => (window as unknown as { __events: TrackedEvent[] }).__events.filter(([e]) => e === n).map(([, p]) => p),
    name,
  );
}

/**
 * Simula el avance del <video> abierto en el modal de demo (VideoModal): 60% → 80% → fin, y el fin otra vez (no debe
 * repetir hitos). Se fija la duración en la instancia para no depender de que el navegador baje el video.
 */
export async function playModalVideo(page: import("@playwright/test").Page) {
  const video = page.getByTestId("video-modal").locator("video");
  await video.waitFor({ state: "attached" });
  await video.evaluate((v: HTMLVideoElement) => {
    let now = 0;
    Object.defineProperty(v, "duration", { configurable: true, get: () => 100 });
    Object.defineProperty(v, "currentTime", { configurable: true, get: () => now, set: () => {} });
    for (const t of [60, 80]) {
      now = t;
      v.dispatchEvent(new Event("timeupdate"));
    }
    now = 100;
    v.dispatchEvent(new Event("ended"));
    v.dispatchEvent(new Event("timeupdate"));
    v.dispatchEvent(new Event("ended"));
  });
}
