// Sitios de productor armados con plantillas completas (src/lib/sitePresets.ts) y el editor visual (SiteBuilder.vue),
// sobre las páginas de prueba sin BD (tests/e2e/fixtures/site-fixture-page.astro y site-builder-fixture-page.astro):
// pestañas, carruseles, ventanas, menú lateral y del celular, lo incompleto oculto, y en el editor: aplicar plantilla,
// editar un texto dentro de la vista previa, seleccionar una sección, deshacer y guardar.
import { expect, test } from "@playwright/test";

test.describe("sitio con secciones interactivas", () => {
  test("pestañas, carrusel y ventana con más información", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Se prueba en computador; el menú del celular tiene su propio test");
    await page.goto("/__e2e/sitios/teatro-sala");
    await expect(page.locator('.sn-page[data-nav="sidebar"]')).toBeVisible();

    const tab = page.getByRole("tab", { name: "Accesibilidad" });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#visitanos-panel-2")).toBeVisible();
    await expect(page.locator("#visitanos-panel-0")).toBeHidden();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Cómo llegar" })).toHaveAttribute("aria-selected", "true");

    const track = page.locator("#galeria .sn-carousel-track");
    await page.locator("#galeria [data-sn-next]").click();
    await expect.poll(() => track.evaluate((t) => t.scrollLeft)).toBeGreaterThan(0);
    await expect(page.locator("#galeria [data-sn-prev]")).toBeEnabled();

    await page.getByRole("button", { name: "Ver condiciones" }).click();
    const dialog = page.locator("#arriendo-ventana");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Escríbenos" })).toHaveAttribute("href", "/o/demo/contacto");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("bio de una persona y fotos en grande", async ({ page }) => {
    await page.goto("/__e2e/sitios/teatro-compania");
    await page.locator("#elenco .sn-link").first().click();
    await expect(page.locator("#elenco-persona-0")).toBeVisible();
    await page.locator("#elenco-persona-0 [data-sn-close]").click();
    await expect(page.locator("#elenco-persona-0")).toBeHidden();

    await page.locator("#fotos .sn-gallery-open").nth(2).click();
    const lightbox = page.locator("#fotos-fotos");
    await expect(lightbox).toBeVisible();
    await expect.poll(() => lightbox.locator(".sn-carousel-track").evaluate((t) => t.scrollLeft)).toBeGreaterThan(0);
  });

  test("menú del celular", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/__e2e/sitios/musica-banda");
    await expect(page.locator(".sn-nav")).toBeHidden();
    await page.getByRole("button", { name: "Abrir menú" }).click();
    const drawer = page.locator("#sn-menu");
    await expect(drawer).toBeVisible();
    await drawer.getByRole("link", { name: "Fechas" }).click();
    await expect(drawer).toBeHidden();
  });

  test("recién aplicada, la plantilla no muestra lo que el productor debe completar", async ({ page }) => {
    await page.goto("/__e2e/sitios/teatro-compania?vacio=1");
    await expect(page.locator('[data-section-id="portada"]')).toBeVisible();
    await expect(page.getByTestId("site-event-grid")).toBeVisible();
    // Elenco, prensa y fotos vacíos no se publican; las preguntas sin respuesta tampoco
    for (const id of ["elenco", "prensa", "fotos"]) await expect(page.locator(`[data-section-id="${id}"]`)).toHaveCount(0);
    await expect(page.locator("#preguntas summary")).toHaveCount(2);
    await expect(page.locator("[data-edit]")).toHaveCount(0);
  });
});

test.describe("editor visual del sitio", () => {
  test.skip(({ isMobile }) => isMobile, "El editor visual se prueba en computador");

  test("aplicar una plantilla, editar un texto en la vista previa, deshacer y guardar", async ({ page }) => {
    let saved: any = null;
    await page.route("**/api/sites", async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      saved = route.request().postDataJSON();
      await route.fulfill({ json: { site: { slug: "demo", published: true, template: saved.template, content: saved.content } } });
    });
    page.on("dialog", (d) => d.accept());
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/__e2e/sitio-editor");
    await expect(page.getByTestId("site-builder")).toBeVisible();

    // Abre en el asistente; las plantillas están en su pestaña
    await expect(page.getByTestId("site-ai-panel")).toBeVisible();
    await page.getByTestId("builder-tab-presets").click();
    await page.locator('[data-preset="teatro-festival"]').click();
    const preview = page.frameLocator('[data-testid="site-builder-preview"]');
    await expect(preview.locator('.sn-page[data-nav="centered"]')).toBeVisible();
    await expect(page.getByTestId("site-section-list")).toContainText("Día a día");

    // Editar el título de la portada ahí mismo
    const title = preview.locator(".sn-hero h1 [data-edit]");
    await title.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("Festival del Sur");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("site-section-list").locator("li").first()).toContainText("Festival del Sur");

    // Clic en una sección: abre sus ajustes
    await preview.locator('[data-section-id="programa"] .sn-head').click({ position: { x: 4, y: 4 } });
    await expect(page.getByTestId("site-inspector").last()).toContainText("Pestañas");

    // Deshacer (el foco quedó en la vista previa: el atajo llega igual)
    await preview.locator("body").press("ControlOrMeta+z");
    await expect(title).not.toHaveText("Festival del Sur");
    await preview.locator("body").press("ControlOrMeta+Shift+z");
    await expect(title).toHaveText("Festival del Sur");

    await page.getByTestId("site-builder-save").click();
    await expect(page.getByTestId("site-builder-save")).toHaveText("Guardado");
    expect(saved.template).toBe("teatro");
    expect(saved.content.preset).toBe("teatro-festival");
    expect(saved.content.layout).toEqual({ nav: "centered", sticky: true });
    expect(saved.content.sections[0].data.title).toBe("Festival del Sur");
    expect(Object.keys(saved.content)).not.toContain("socials");
  });

  test("el asistente es la primera pestaña: aplica cambios, recuerda la conversación y se puede enfocar en una sección", async ({ page }) => {
    const calls: any[] = [];
    await page.route("**/api/sites/ai", async (route) => {
      const body = route.request().postDataJSON();
      calls.push(body);
      const sections = body.draft.sections.map((s: any) => (s.type === "hero" ? { ...s, data: { ...s.data, title: `Portada ${calls.length}` } } : s));
      await route.fulfill({
        json: { summary: `Listo (${calls.length}): puse el menú a la izquierda.`, changes: { layout: { nav: "sidebar" }, sections } },
      });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/__e2e/sitio-editor");
    await expect(page.getByTestId("builder-tab-ai")).toHaveAttribute("aria-pressed", "true");
    const nav = page.getByRole("navigation", { name: "Paneles del editor" }).getByRole("button");
    await expect(nav.first()).toHaveText(/Asistente/);

    const panel = page.getByTestId("site-ai-panel");
    const input = panel.getByRole("textbox", { name: "Pídele un cambio al asistente" });
    await input.fill("Pon el menú a la izquierda");
    await input.press("Enter");
    await expect(panel).toContainText("Listo (1): puse el menú a la izquierda.");
    const preview = page.frameLocator('[data-testid="site-builder-preview"]');
    await expect(preview.locator('.sn-page[data-nav="sidebar"]')).toBeVisible();
    await expect(preview.locator(".sn-hero h1")).toHaveText("Portada 1");

    // Seleccionar una sección en la vista previa ofrece enfocar el pedido en ella
    await preview.locator('[data-section-id="events"]').click({ position: { x: 6, y: 6 } });
    await panel.getByRole("button", { name: /Enfocar en/ }).click();
    await expect(panel.getByTestId("ai-target")).toBeVisible();
    await input.fill("Hazlo más corto");
    await panel.getByTestId("ai-send").click();
    await expect(panel).toContainText("Listo (2)");
    expect(calls[1].section_id).toBe("events");
    expect(calls[1].history).toEqual([{ instruction: "Pon el menú a la izquierda", summary: "Listo (1): puse el menú a la izquierda." }]);

    // Deshacer desde el chat
    await panel.getByRole("button", { name: "Deshacer este cambio" }).click();
    await expect(preview.locator(".sn-hero h1")).toHaveText("Portada 1");
  });
});
