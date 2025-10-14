import { Page, Locator } from '@playwright/test';
import { TID } from '../../support/test-ids';
import { TestUtils } from '../../support/test-utils';

/**
 * Page Object para la página de inicio (Home)
 * 
 * Responsabilidades:
 * - Navegación a la página principal
 * - Interacción con elementos del Hero
 * - Navegación hacia eventos
 * - Verificación de secciones principales
 */
export class HomePage {
  private utils: TestUtils;

  // Locators principales
  readonly navbar: Locator;
  readonly navLogo: Locator;
  readonly hero: Locator;
  readonly heroTitle: Locator;
  readonly heroSubtitle: Locator;
  readonly cta: Locator;
  readonly ctaPrimary: Locator;
  readonly ctaSecondary: Locator;
  readonly eventList: Locator;
  readonly footer: Locator;
  readonly aiAssistant: Locator;

  constructor(private page: Page) {
    this.utils = new TestUtils(page);
    
    // Inicialización de locators usando test-ids
    this.navbar = this.page.getByTestId(TID.navbar);
    this.navLogo = this.page.getByTestId(TID.navLogo);
    this.hero = this.page.getByTestId(TID.hero);
    this.heroTitle = this.page.getByTestId(TID.heroTitle);
    this.heroSubtitle = this.page.getByTestId(TID.heroSubtitle);
    this.cta = this.page.getByTestId(TID.cta);
    this.ctaPrimary = this.page.getByTestId(TID.ctaPrimary);
    this.ctaSecondary = this.page.getByTestId(TID.ctaSecondary);
    this.eventList = this.page.getByTestId(TID.eventList);
    this.footer = this.page.getByTestId(TID.footer);
    this.aiAssistant = this.page.getByTestId(TID.aiAssistant);
  }

  /**
   * Navega a la página principal
   */
  async goto() {
    await this.page.goto('/');
    await this.utils.waitReady();
  }

  /**
   * Click en el CTA principal
   */
  async clickPrimaryCTA() {
    await this.utils.click(this.ctaPrimary);
  }

  /**
   * Click en el CTA secundario
   */
  async clickSecondaryCTA() {
    await this.utils.click(this.ctaSecondary);
  }

  /**
   * Navega a la sección de eventos usando el navbar
   */
  async navigateToEvents() {
    const eventsLink = this.navbar.getByRole('link', { name: /eventos/i });
    await this.utils.click(eventsLink);
  }

  /**
   * Navega a la página de organizadores
   */
  async navigateToProducers() {
    const producersLink = this.navbar.getByRole('link', { name: /organizadores/i });
    await this.utils.click(producersLink);
  }

  /**
   * Busca un evento específico por nombre
   */
  async searchEvent(eventName: string) {
    const searchInput = this.page.getByPlaceholder(/buscar evento/i);
    await this.utils.fill(searchInput, eventName);
  }

  /**
   * Obtiene todos los eventos visibles
   */
  async getEventCards(): Promise<Locator[]> {
    const cards = await this.page.getByTestId(TID.eventCard).all();
    return cards;
  }

  /**
   * Click en un evento específico por su índice
   */
  async clickEventByIndex(index: number) {
    const cards = await this.getEventCards();
    if (cards[index]) {
      await this.utils.click(cards[index]);
    }
  }

  /**
   * Verifica que el hero está visible y cargado
   */
  async verifyHeroLoaded() {
    await this.utils.assertVisible(`[data-testid="${TID.hero}"]`);
    await this.utils.assertVisible(`[data-testid="${TID.heroTitle}"]`);
  }

  /**
   * Verifica que la lista de eventos está cargada
   */
  async verifyEventsLoaded() {
    await this.utils.waitForSelector(`[data-testid="${TID.eventList}"]`);
    const count = await this.utils.count(`[data-testid="${TID.eventCard}"]`);
    return count > 0;
  }

  /**
   * Abre el asistente AI
   */
  async openAIAssistant() {
    const assistantButton = this.page.getByRole('button', { name: /asistente/i });
    await this.utils.clickNoWait(assistantButton);
  }

  /**
   * Scroll hacia la sección de features
   */
  async scrollToFeatures() {
    const featuresSection = this.page.locator('[data-testid="features"]');
    await this.utils.scrollTo(featuresSection);
  }

  /**
   * Scroll hacia el footer
   */
  async scrollToFooter() {
    await this.utils.scrollTo(this.footer);
  }

  /**
   * Suscribirse al newsletter desde el footer
   */
  async subscribeNewsletter(email: string) {
    const newsletterInput = this.footer.getByPlaceholder(/email/i);
    const submitButton = this.footer.getByRole('button', { name: /suscribir/i });
    
    await this.utils.fill(newsletterInput, email);
    await this.utils.clickNoWait(submitButton);
  }
}
