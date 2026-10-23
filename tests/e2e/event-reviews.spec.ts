// Reseñas en la página de un evento terminado (src/components/event/EventReviews.vue), en desktop y mobile.
// Sin BD: la página real con datos fijos (tests/e2e/fixtures, escenario "terminado-con-resenas"); las APIs de
// reseñas se interceptan en el navegador y se revisa lo que se les envía.
import { expect, test, type Page } from "@playwright/test";
import { waitForIsland } from "./env";
import { FIXTURE_ROUTE } from "./fixtures/event-scenarios.mjs";

const SCENARIO = "terminado-con-resenas";
const ORDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const session = (over: Record<string, unknown> = {}) => ({
  event_id: 9100,
  email: "an*@x.cl",
  name: "Ana",
  review: null,
  reward_offer: { label: "10% de descuento", valid_days: 60 },
  reward: null,
  photos: [],
  max_photos: 6,
  moderate_photos: false,
  ...over,
});

async function openScenario(page: Page, hash = "") {
  await page.route(/google-analytics\.com|googletagmanager\.com/, (route) => route.abort());
  await page.route("**/api/events/visit", (route) => route.fulfill({ status: 204 }));
  const response = await page.goto(`${FIXTURE_ROUTE}/${SCENARIO}${hash}`);
  expect(response?.status(), "el servidor debe levantarse con E2E_FIXTURES=1 (playwright.config.ts)").toBe(200);
  await page.addStyleTag({ content: "astro-dev-toolbar{display:none!important}" });
  await waitForIsland(page, '[data-testid="event-reviews"]');
}

test("evento terminado: resumen, comentarios y galería de asistentes", async ({ page }) => {
  await openScenario(page);
  await expect(page.getByTestId("event-action-card")).toHaveAttribute("data-state", "ended");
  await expect(page.getByTestId("review-cta")).toBeVisible();
  const reviews = page.getByTestId("event-reviews");
  await expect(reviews.getByTestId("reviews-summary")).toContainText("4,5");
  await expect(reviews.getByTestId("reviews-summary")).toContainText("4 reseñas");
  await expect(reviews.getByTestId("reviews-list").locator("li")).toHaveCount(2);
  await expect(reviews.getByTestId("attendee-gallery")).toContainText("Fotos de los asistentes");
  // Abre el visor de fotos con el pie "Foto de <nombre>"
  await reviews.getByTestId("attendee-gallery").getByRole("button").first().click();
  await expect(page.getByRole("dialog")).toContainText("Foto de Ana R.");
});

test("validar con la entrada, calificar y recibir el código de premio", async ({ page }) => {
  const sent: any[] = [];
  await page.route("**/api/reviews/verify", async (route) => {
    sent.push({ verify: route.request().postDataJSON() });
    await route.fulfill({ json: { token: "tok.firmado", verified_via: "order", ...session() } });
  });
  await page.route("**/api/reviews", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON();
    sent.push({ review: body });
    await route.fulfill({
      json: session({
        created: true,
        review: { rating: body.rating, public_comment: body.public_comment, private_comment: body.private_comment, public_status: "visible" },
        reward: { code: "GRACIAS-7KQ2MX", label: "10% de descuento", valid_until: "2026-12-20T12:00:00Z" },
      }),
    });
  });
  await openScenario(page);
  await page.getByTestId("review-cta").click();
  const card = page.getByTestId("review-card");
  await card.getByTestId("review-with-ticket").click();
  await card.getByLabel("Link de tu entrada u orden").fill(`https://aitickets.cl/order/${ORDER}`);
  await card.getByRole("button", { name: "Validar entrada" }).click();

  const form = card.getByTestId("review-form");
  await expect(form).toBeVisible();
  await expect(form).toContainText("10% de descuento");
  await form.getByTestId("star-5").click();
  await expect(form.getByTestId("star-5")).toHaveAttribute("aria-checked", "true");
  await expect(form).toContainText("Excelente");
  await form.getByLabel(/Comentario público/).fill("¡Volvería mil veces!");
  await form.getByLabel(/Mensaje privado/).fill("Faltaron baños");
  await form.getByTestId("review-submit").click();

  await expect(card.getByTestId("review-done")).toContainText("¡Gracias por calificar!");
  await expect(card.getByTestId("review-reward")).toContainText("GRACIAS-7KQ2MX");
  expect(sent[0]).toEqual({ verify: { eventId: 9100, reference: `https://aitickets.cl/order/${ORDER}` } });
  expect(sent[1]).toEqual({ review: { token: "tok.firmado", rating: 5, public_comment: "¡Volvería mil veces!", private_comment: "Faltaron baños" } });
  // Las fotos se pueden subir después de validar
  await expect(card.getByRole("button", { name: /Subir fotos/ })).toBeVisible();
});

test("link del correo: abre con la nota tocada y saca el token de la URL", async ({ page }) => {
  let sessionToken = "";
  await page.route("**/api/reviews/session", async (route) => {
    sessionToken = route.request().postDataJSON().token;
    await route.fulfill({ json: session() });
  });
  await openScenario(page, "#resena=tok.del.correo&nota=4");
  const form = page.getByTestId("review-form");
  await expect(form).toBeVisible();
  await expect(form.getByTestId("star-4")).toHaveAttribute("aria-checked", "true");
  expect(sessionToken).toBe("tok.del.correo");
  await expect(page).toHaveURL(new RegExp(`${SCENARIO}#resenas$`));
});

test("validar con el correo muestra el aviso genérico", async ({ page }) => {
  let body: any = null;
  await page.route("**/api/reviews/request-link", async (route) => {
    body = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, message: "Si ese correo tiene entradas para este evento, te enviamos un link para calificar." } });
  });
  await openScenario(page);
  const card = page.getByTestId("review-card");
  await card.getByTestId("review-with-email").click();
  await card.getByLabel(/El correo con el que compraste/).fill("ana@x.cl");
  await card.getByRole("button", { name: "Enviarme el link para calificar" }).click();
  await expect(card.getByRole("status")).toContainText("te enviamos un link");
  expect(body).toEqual({ eventId: 9100, email: "ana@x.cl" });
});
