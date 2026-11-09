// Página del evento con artistas: sección "Participan" visible y JSON-LD (schema.org/Event, src/lib/eventJsonLd.ts)
// con los campos que Search Console marcaba como faltantes: performer, offers[].validFrom y organizer.url.
// Sin BD: la página real del evento con datos fijos (tests/e2e/fixtures).
import { expect, test } from "@playwright/test";
import { FIXTURE_CREATED_AT, FIXTURE_ROUTE } from "./fixtures/event-scenarios.mjs";

test("muestra quiénes participan y los publica en el JSON-LD con validFrom y organizer.url", async ({ page }) => {
  await page.route(/google-analytics\.com|googletagmanager\.com/, (route) => route.abort());
  await page.route("**/api/events/visit", (route) => route.fulfill({ status: 204 }));
  const response = await page.goto(`${FIXTURE_ROUTE}/con-artistas`);
  expect(response?.status(), "el servidor debe levantarse con E2E_FIXTURES=1 (playwright.config.ts)").toBe(200);

  const section = page.getByTestId("event-performers");
  await expect(section.getByRole("heading", { name: "Participan" })).toBeVisible();
  await expect(section.getByTestId("event-performer")).toHaveText(["Ana Tijoux", "Los Bunkers"]);

  const raw = await page.locator('script[type="application/ld+json"]').first().textContent();
  const data = JSON.parse(raw || "{}");
  expect(data["@type"]).toBe("Event");
  expect(data.performer).toEqual([
    { "@type": "Person", name: "Ana Tijoux" },
    { "@type": "PerformingGroup", name: "Los Bunkers" },
  ]);
  expect(data.organizer).toMatchObject({
    "@type": "Organization",
    name: "Productora de Prueba",
    url: "https://aitickets.cl/o/productora-de-prueba",
    sameAs: ["https://www.instagram.com/productoradeprueba"],
  });
  expect(data.offers.length).toBeGreaterThan(0);
  for (const offer of data.offers) expect(offer.validFrom).toBe(FIXTURE_CREATED_AT);
});

test("sin artistas no hay sección Participan", async ({ page }) => {
  await page.route(/google-analytics\.com|googletagmanager\.com/, (route) => route.abort());
  await page.route("**/api/events/visit", (route) => route.fulfill({ status: 204 }));
  await page.goto(`${FIXTURE_ROUTE}/poster-una-entrada`);
  await expect(page.getByRole("heading", { name: "Sobre el evento" })).toBeVisible();
  await expect(page.getByTestId("event-performers")).toHaveCount(0);
});
