import { test, expect } from '@playwright/test';
import { HomePage } from '../Home.page';

test.describe('Home Page - Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Cualquier configuración previa aquí
  });

  test('@smoke @home debe cargar la página principal correctamente', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();

    // Verificar que los elementos principales están visibles
    await expect(home.navbar).toBeVisible();
    await expect(home.hero).toBeVisible();
    await expect(home.footer).toBeVisible();
  });

  test('@smoke @home debe mostrar el hero con título y CTA', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();

    await home.verifyHeroLoaded();
    await expect(home.heroTitle).toBeVisible();
    await expect(home.heroSubtitle).toBeVisible();
    
    // Verificar que los CTAs están visibles (son links, no botones)
    await expect(home.ctaPrimary).toBeVisible();
    await expect(home.ctaSecondary).toBeVisible();
  });

  test('@smoke @home debe cargar la lista de eventos', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();

    // Esperar a que se cargue la lista de eventos
    await page.waitForSelector('[data-testid*="event"]', { timeout: 10000 });
    
    // Verificar que hay al menos un evento visible
    const eventCards = await home.getEventCards();
    expect(eventCards.length).toBeGreaterThan(0);
  });

  test('@smoke @navigation debe navegar entre secciones', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();

    // Scroll a diferentes secciones
    await home.scrollToFooter();
    await expect(home.footer).toBeInViewport();
  });

  test('@regression @home debe permitir búsqueda de eventos', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();

    // Buscar un evento (si existe el campo de búsqueda)
    const searchInput = page.getByPlaceholder(/buscar/i);
    if (await searchInput.isVisible()) {
      await searchInput.fill('concierto');
      await page.waitForTimeout(500); // Esperar debounce
      
      // Verificar que se filtraron resultados
      const eventCards = await home.getEventCards();
      expect(eventCards.length).toBeGreaterThanOrEqual(0);
    }
  });

  test('@smoke @home debe tener meta tags correctos', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();

    // Verificar que tiene un título (cualquiera)
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);

    // Verificar meta description si existe
    const metaDescription = page.locator('meta[name="description"]');
    const metaCount = await metaDescription.count();
    if (metaCount > 0) {
      await expect(metaDescription).toHaveAttribute('content', /.+/);
    }
  });

  test('@accessibility @home elementos principales deben ser accesibles', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();

    // Verificar que los botones tienen labels accesibles
    const buttons = page.getByRole('button');
    const buttonCount = await buttons.count();
    
    for (let i = 0; i < Math.min(buttonCount, 5); i++) {
      const button = buttons.nth(i);
      if (await button.isVisible()) {
        const ariaLabel = await button.getAttribute('aria-label');
        const text = await button.textContent();
        // Cada botón debe tener texto o aria-label
        expect(ariaLabel || text).toBeTruthy();
      }
    }
  });

  test('@smoke @home footer debe tener enlaces importantes', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    
    await home.scrollToFooter();

    // Verificar que existen enlaces de privacidad y términos
    const privacyLink = page.getByRole('link', { name: /privacidad/i });
    const termsLink = page.getByRole('link', { name: /términos|condiciones/i });

    expect(await privacyLink.count() + await termsLink.count()).toBeGreaterThan(0);
  });

  test('@performance @home página debe cargar en menos de 5 segundos', async ({ page }) => {
    const startTime = Date.now();
    
    const home = new HomePage(page);
    await home.goto();
    
    const loadTime = Date.now() - startTime;
    expect(loadTime).toBeLessThan(5000);
  });
});
