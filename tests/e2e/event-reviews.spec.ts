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

async function openScenario(page: Page, hash = "", scenario = SCENARIO) {
  await page.route(/google-analytics\.com|googletagmanager\.com/, (route) => route.abort());
  await page.route("**/api/events/visit", (route) => route.fulfill({ status: 204 }));
  const response = await page.goto(`${FIXTURE_ROUTE}/${scenario}${hash}`);
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
  await page.keyboard.press("Escape");
  // Los videos van aparte, con su póster y reproductor
  const videos = reviews.getByTestId("attendee-videos");
  await expect(videos).toContainText("Videos de los asistentes");
  await expect(videos).toContainText("Video de Beto S.");
  await expect(videos.locator("video")).toHaveAttribute("poster", "/videos/aitickets-demo-poster.jpg");
});

test("subir un video: URL firmada, subida directa a Storage y confirmación con póster y duración", async ({ page }) => {
  const calls: any[] = [];
  await page.route("**/api/reviews/session", (route) =>
    route.fulfill({ json: session({ max_videos: 2, max_video_bytes: 50 * 1024 * 1024, max_video_seconds: 60 }) }),
  );
  await page.route("https://storage.test/**", async (route) => {
    calls.push({ storage: route.request().method() });
    await route.fulfill({ status: 200, json: { Key: "ok" } });
  });
  await page.route("**/api/reviews/videos", async (route) => {
    const type = route.request().headers()["content-type"] || "";
    if (type.includes("application/json")) {
      calls.push({ upload_url: route.request().postDataJSON() });
      return route.fulfill({ json: { uploadUrl: "https://storage.test/upload/video-1.webm", publicUrl: "https://storage.test/public/video-1.webm" } });
    }
    const body = route.request().postDataBuffer()?.toString("latin1") || "";
    calls.push({ set: { action: /name="action"\r\n\r\nset/.test(body), url: body.includes("https://storage.test/public/video-1.webm"), poster: body.includes('name="poster"'), duration: /name="duration"\r\n\r\n\d+/.test(body) } });
    const video = { id: "v9", media_type: "video", url: "https://storage.test/public/video-1.webm", thumb_url: null, status: "visible", duration: 12 };
    return route.fulfill({ status: 201, json: { video, photos: [video], message: "¡Listo! Tu video ya está en la galería." } });
  });
  await openScenario(page, "#resena=tok.del.correo");
  const box = page.getByTestId("review-videos");
  await expect(box).toContainText("Tus videos del evento");
  await expect(box).toContainText("Hasta 60 segundos y 50 MB");
  await box.getByTestId("review-video-input").setInputFiles("public/videos/aitickets-demo.webm");
  await expect(box.getByRole("status")).toContainText("Tu video ya está en la galería");
  await expect(box.locator(".thumb")).toHaveCount(1);
  expect(calls[0].upload_url).toMatchObject({ token: "tok.del.correo", action: "upload_url", contentType: "video/webm" });
  expect(calls[0].upload_url.duration).toBeGreaterThan(0);
  expect(calls[1]).toEqual({ storage: "PUT" });
  expect(calls[2]).toEqual({ set: { action: true, url: true, poster: true, duration: true } });
});

test("un video demasiado pesado se rechaza en el navegador, sin subir nada", async ({ page }) => {
  let apiCalls = 0;
  await page.route("**/api/reviews/session", (route) => route.fulfill({ json: session({ max_videos: 2, max_video_bytes: 1024 * 1024, max_video_seconds: 60 }) }));
  await page.route("**/api/reviews/videos", (route) => {
    apiCalls += 1;
    return route.fulfill({ status: 500, json: {} });
  });
  await openScenario(page, "#resena=tok.del.correo");
  const box = page.getByTestId("review-videos");
  await box.getByTestId("review-video-input").setInputFiles("public/videos/aitickets-demo.webm");
  await expect(box.getByRole("alert")).toContainText("el máximo es 1 MB");
  expect(apiCalls).toBe(0);
});

test("obra en cartelera: reseñas de las funciones pasadas junto al botón de compra", async ({ page }) => {
  await openScenario(page, "", "cartelera-con-resenas");
  const card = page.getByTestId("event-action-card");
  await expect(card).not.toHaveAttribute("data-state", "ended");
  await expect(card.getByTestId("buy-button")).toBeVisible();
  const reviews = page.getByTestId("event-reviews");
  await expect(reviews.getByTestId("reviews-summary")).toContainText("4,5");
  await expect(reviews.getByTestId("reviews-list").locator("li")).toHaveCount(2);
  await expect(page.locator(".badges")).toContainText("★ 4,5");
  // En mobile la tarjeta de compra no tapa las reseñas: ambas caben en el ancho de la pantalla
  const width = page.viewportSize()?.width || 0;
  for (const box of [await card.boundingBox(), await reviews.boundingBox()]) expect(box && box.x + box.width).toBeLessThanOrEqual(width + 1);
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
