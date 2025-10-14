import { Page, expect, Locator } from '@playwright/test';

/**
 * Clase de utilidades comunes para tests E2E
 */
export class TestUtils {
  constructor(public page: Page) {}

  /**
   * Espera a que la página esté completamente cargada
   */
  async waitReady() {
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Espera a que el DOM esté cargado
   */
  async waitForDomContentLoaded() {
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Click con espera posterior
   */
  async click(locator: Locator) {
    await locator.click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Click sin esperar networkidle (para casos donde no hay navegación)
   */
  async clickNoWait(locator: Locator) {
    await locator.click();
  }

  /**
   * Fill input y espera
   */
  async fill(locator: Locator, value: string) {
    await locator.fill(value);
    await this.page.waitForTimeout(100); // pequeña espera para validaciones
  }

  /**
   * Assert que un elemento es visible
   */
  async assertVisible(selector: string) {
    await expect(this.page.locator(selector)).toBeVisible();
  }

  /**
   * Assert que un elemento contiene texto
   */
  async assertText(selector: string, text: string | RegExp) {
    await expect(this.page.locator(selector)).toContainText(text);
  }

  /**
   * Assert que un elemento tiene un atributo
   */
  async assertAttribute(selector: string, attr: string, value: string | RegExp) {
    await expect(this.page.locator(selector)).toHaveAttribute(attr, value);
  }

  /**
   * Navegar y esperar carga completa
   */
  async goto(path: string) {
    await this.page.goto(path);
    await this.waitReady();
  }

  /**
   * Tomar screenshot con nombre personalizado
   */
  async screenshot(name: string) {
    await this.page.screenshot({ path: `e2e/screenshots/${name}.png`, fullPage: true });
  }

  /**
   * Esperar por un selector específico
   */
  async waitForSelector(selector: string, options?: { timeout?: number; state?: 'attached' | 'detached' | 'visible' | 'hidden' }) {
    await this.page.waitForSelector(selector, options);
  }

  /**
   * Scroll al elemento
   */
  async scrollTo(locator: Locator) {
    await locator.scrollIntoViewIfNeeded();
  }

  /**
   * Esperar por navegación
   */
  async waitForNavigation(action: () => Promise<void>) {
    await Promise.all([
      this.page.waitForNavigation(),
      action()
    ]);
  }

  /**
   * Obtener texto de un elemento
   */
  async getText(selector: string): Promise<string> {
    return await this.page.locator(selector).textContent() || '';
  }

  /**
   * Verificar que el URL contiene un path
   */
  async assertUrlContains(path: string) {
    await expect(this.page).toHaveURL(new RegExp(path));
  }

  /**
   * Verificar que el título de la página
   */
  async assertTitle(title: string | RegExp) {
    await expect(this.page).toHaveTitle(title);
  }

  /**
   * Mock de una API response
   */
  async mockApiResponse(url: string | RegExp, response: any, status = 200) {
    await this.page.route(url, async (route) => {
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(response)
      });
    });
  }

  /**
   * Interceptar requests a una URL
   */
  async interceptRequest(url: string | RegExp, handler: (route: any) => Promise<void>) {
    await this.page.route(url, handler);
  }

  /**
   * Limpiar todas las rutas mockeadas
   */
  async clearRoutes() {
    await this.page.unrouteAll({ behavior: 'ignoreErrors' });
  }

  /**
   * Verificar que un elemento no existe
   */
  async assertNotExists(selector: string) {
    await expect(this.page.locator(selector)).toHaveCount(0);
  }

  /**
   * Contar elementos
   */
  async count(selector: string): Promise<number> {
    return await this.page.locator(selector).count();
  }

  /**
   * Esperar tiempo específico (usar con precaución)
   */
  async wait(ms: number) {
    await this.page.waitForTimeout(ms);
  }

  /**
   * Verificar accesibilidad básica (aria-labels, roles, etc)
   */
  async checkAccessibility(selector: string) {
    const locator = this.page.locator(selector);
    await expect(locator).toBeVisible();
    // Aquí se pueden agregar más checks de accesibilidad
  }

  /**
   * Limpiar localStorage
   */
  async clearLocalStorage() {
    await this.page.evaluate(() => localStorage.clear());
  }

  /**
   * Limpiar sessionStorage
   */
  async clearSessionStorage() {
    await this.page.evaluate(() => sessionStorage.clear());
  }

  /**
   * Set item en localStorage
   */
  async setLocalStorage(key: string, value: string) {
    await this.page.evaluate(
      ({ key, value }) => localStorage.setItem(key, value),
      { key, value }
    );
  }

  /**
   * Get item de localStorage
   */
  async getLocalStorage(key: string): Promise<string | null> {
    return await this.page.evaluate(
      (key) => localStorage.getItem(key),
      key
    );
  }
}
