// Validador de entradas (/validador): sin sesión pide login y vuelve; la URL antigua /qr/<slug> redirige; y el escáner
// (página con datos fijos, tests/e2e/fixtures/validator-fixture-page.astro) busca, valida, sigue funcionando sin
// conexión (también al recargar: public/validador-sw.js) y sincroniza al volver internet.
import { expect, test, type Page } from "@playwright/test";

const FIXTURE_URL = "/validador/__e2e/basico";
const EVENT_ID = 990001;
const IDS = {
  camila: "00000000-0000-4000-8000-000000000001",
  diego: "00000000-0000-4000-8000-000000000002",
  vale: "00000000-0000-4000-8000-000000000003",
};
const PEOPLE = [
  { id: IDS.camila, first: "Camila", last: "Rojas", email: "camila@example.com", qr: "QR-CAMILA", ticket: "General" },
  { id: IDS.diego, first: "Diego", last: "Muñoz", email: "diego@example.com", qr: "QR-DIEGO", ticket: "VIP" },
  { id: IDS.vale, first: "Valentina", last: "Soto", email: "vale@example.com", qr: "QR-VALE", ticket: "General" },
];

type ServerState = { validated: Set<string>; confirms: Array<Record<string, unknown>>; attendeesDown: boolean };

/** Simula las APIs del escáner: el "servidor" recuerda qué entradas ya entraron. */
async function mockScannerApis(page: Page): Promise<ServerState> {
  const state: ServerState = { validated: new Set(), confirms: [], attendeesDown: false };
  await page.route("**/api/confirm-ticket", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    state.confirms.push(body);
    const id = String(body.ticket_id);
    if (state.validated.has(id)) {
      return route.fulfill({ status: 409, json: { code: "already_validated", message: "Entrada ya validada" } });
    }
    state.validated.add(id);
    return route.fulfill({ status: 200, json: { ok: true, validated_at: String(body.validated_at || new Date().toISOString()) } });
  });
  await page.route("**/api/get-event-attendees**", async (route) => {
    if (state.attendeesDown) return route.abort("internetdisconnected");
    return route.fulfill({
      status: 200,
      json: {
        rendered_at: new Date().toISOString(),
        dates: [],
        attendees: PEOPLE.map((p, i) => ({
          id: p.id,
          event_id: EVENT_ID,
          event_ticket_id: 1,
          event_order_id: 5000 + i,
          qr_code: p.qr,
          status: state.validated.has(p.id) ? "validated" : "active",
          validated_at: state.validated.has(p.id) ? new Date().toISOString() : null,
          is_complimentary: false,
          attendees: { first_name: p.first, last_name: p.last, email: p.email },
          event_tickets: { ticket_name: p.ticket, event_date_id: null },
        })),
      },
    });
  });
  await page.route("**/api/validate-ticket", (route) => route.fulfill({ status: 404, json: { message: "No encontrada" } }));
  return state;
}

const row = (page: Page, name: string) => page.getByTestId("attendee-row").filter({ hasText: name });

async function openScanner(page: Page, url = FIXTURE_URL) {
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Escáner de Entradas QR" })).toBeVisible();
  await page.locator("astro-island:not([ssr])").first().waitFor({ state: "attached" });
  await expect(row(page, "Camila Rojas")).toBeVisible();
}

/** Espera a que el service worker controle la página y la recarga para que guarde la página y sus archivos. */
async function makeAvailableOffline(page: Page) {
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 30_000 });
  await openScanner(page);
  await page.waitForFunction(async () => {
    const pages = await caches.open("validador-pages-v1");
    return Boolean(await pages.match(location.origin + location.pathname));
  });
  // Los archivos se guardan en segundo plano: esperar a que la caché deje de crecer
  await page.waitForFunction(async () => {
    const w = window as unknown as { __assetCount?: number };
    const count = (await (await caches.open("validador-assets-v1")).keys()).length;
    const stable = count > 0 && count === w.__assetCount;
    w.__assetCount = count;
    return stable;
  }, null, { polling: 1000, timeout: 30_000 });
}

test.describe("acceso", () => {
  test("sin sesión /validador pide iniciar sesión y vuelve al validador", async ({ page }) => {
    await page.goto("/validador");
    await expect(page).toHaveURL(/\/organizadores\/login\?next=%2Fvalidador$/);
    await expect(page.getByText("Inicia sesión para validar entradas en la puerta.")).toBeVisible();
  });

  test("la URL antigua /qr/<slug> redirige a /validador/<slug>", async ({ request }) => {
    const res = await request.get("/qr/mi-fiesta?token=qrvalidator", { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers()["location"]).toBe("/validador/mi-fiesta");
  });
});

test.describe("escáner", () => {
  test("busca y valida a mano con conexión", async ({ page }) => {
    const server = await mockScannerApis(page);
    await openScanner(page);
    await expect(page.getByText("0 / 3 entradas validadas")).toBeVisible();

    await page.getByPlaceholder("Buscar por nombre o correo...").fill("diego");
    await expect(page.getByTestId("attendee-row")).toHaveCount(1);
    await row(page, "Diego Muñoz").getByRole("button", { name: "✓ Validar" }).click();

    await expect(page.getByTestId("scan-result")).toContainText("Entrada validada manualmente para Diego Muñoz");
    await expect(page.getByTestId("scan-result")).not.toContainText("pendiente de sincronizar");
    expect(server.confirms).toEqual([expect.objectContaining({ ticket_id: IDS.diego, event_id: EVENT_ID })]);
    await expect(page.getByText("1 / 3 entradas validadas")).toBeVisible();
    await expect(page.getByTestId("pending-sync")).toHaveCount(0);
  });

  test("sin conexión valida, busca y recarga la página; al volver internet sincroniza", async ({ page, context }) => {
    const server = await mockScannerApis(page);
    await openScanner(page);
    await makeAvailableOffline(page);

    await context.setOffline(true);
    await expect(page.getByTestId("connection-status")).toHaveText("Offline");
    await page.getByPlaceholder("Buscar por nombre o correo...").fill("Diego");
    await row(page, "Diego Muñoz").getByRole("button", { name: "✓ Validar" }).click();
    await expect(page.getByTestId("scan-result")).toContainText("(pendiente de sincronizar)");
    await expect(page.getByTestId("pending-sync")).toContainText("1 validación(es) pendiente(s)");
    expect(server.confirms).toHaveLength(0);

    // Sin red la página vuelve a abrir (copia del service worker) con la lista y lo pendiente del teléfono
    await page.reload();
    await expect(page.getByRole("heading", { name: "Escáner de Entradas QR" })).toBeVisible();
    await page.locator("astro-island:not([ssr])").first().waitFor({ state: "attached" });
    await expect(page.getByTestId("connection-status")).toHaveText("Offline");
    await expect(page.getByTestId("pending-sync")).toContainText("1 validación(es) pendiente(s)");
    await expect(row(page, "Diego Muñoz")).toContainText("✓ Validado");
    await page.getByPlaceholder("Buscar por nombre o correo...").fill("vale");
    await expect(page.getByTestId("attendee-row")).toHaveCount(1);
    await expect(row(page, "Valentina Soto")).toContainText("Pendiente");

    // Vuelve internet: se sube lo pendiente (con la hora en que entró) y se baja la lista actual
    await context.setOffline(false);
    await expect.poll(() => server.confirms.map((c) => c.ticket_id)).toContain(IDS.diego);
    expect(server.confirms[0]).toMatchObject({ ticket_id: IDS.diego, event_id: EVENT_ID, force: true, validated_at: expect.any(String) });
    await expect(page.getByTestId("pending-sync")).toHaveCount(0, { timeout: 20_000 });
  });

  test("una copia guardada más vieja que la lista del teléfono no deshace validaciones", async ({ page }) => {
    const server = await mockScannerApis(page);
    await openScanner(page);
    await makeAvailableOffline(page);

    // Otro teléfono validó a Camila; este sincroniza después de que se guardó la copia de la página
    server.validated.add(IDS.camila);
    await page.getByRole("button", { name: "🔄 Sincronizar" }).click();
    await expect(page.getByTestId("scan-result")).toContainText("Sincronización completada");
    await expect(row(page, "Camila Rojas")).toContainText("✓ Validado");

    // Red lenta (el teléfono cree que hay conexión): a los 5 s el service worker entrega la copia guardada, cuya
    // lista dice que Camila no ha entrado. La API tampoco responde: solo queda lo guardado en el teléfono.
    server.attendeesDown = true;
    await page.goto(`${FIXTURE_URL}?delay=8000`);
    await expect(page.getByRole("heading", { name: "Escáner de Entradas QR" })).toBeVisible();
    await page.locator("astro-island:not([ssr])").first().waitFor({ state: "attached" });
    await expect(page.getByTestId("connection-status")).toHaveText("Online");
    await expect(row(page, "Camila Rojas")).toContainText("✓ Validado");
    await expect(page.getByText("1 / 3 entradas validadas")).toBeVisible();
  });
});
