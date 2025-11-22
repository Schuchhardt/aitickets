import { Page, Locator } from '@playwright/test';
import { TID } from '../../support/test-ids';
import { TestUtils } from '../../support/test-utils';

/**
 * Page Object para autenticación y registro
 * 
 * Responsabilidades:
 * - Login de usuarios
 * - Registro de usuarios
 * - Validación de formularios
 * - Gestión de sesión
 */
export class AuthPage {
  private utils: TestUtils;

  // Locators de login
  readonly loginBtn: Locator;
  readonly loginForm: Locator;
  readonly loginEmail: Locator;
  readonly loginPassword: Locator;
  readonly loginSubmit: Locator;

  // Locators de registro
  readonly registerBtn: Locator;
  readonly registerForm: Locator;

  // Locators comunes
  readonly formError: Locator;

  constructor(private page: Page) {
    this.utils = new TestUtils(page);

    // Login elements
    this.loginBtn = this.page.getByTestId(TID.loginBtn);
    this.loginForm = this.page.getByTestId(TID.loginForm);
    this.loginEmail = this.page.getByTestId(TID.loginEmail);
    this.loginPassword = this.page.getByTestId(TID.loginPassword);
    this.loginSubmit = this.page.getByTestId(TID.loginSubmit);

    // Register elements
    this.registerBtn = this.page.getByTestId(TID.registerBtn);
    this.registerForm = this.page.getByTestId(TID.registerForm);

    // Common elements
    this.formError = this.page.getByTestId(TID.formError);
  }

  /**
   * Navega a la página de login
   */
  async gotoLogin() {
    await this.page.goto('/login');
    await this.utils.waitReady();
  }

  /**
   * Navega a la página de registro
   */
  async gotoRegister() {
    await this.page.goto('/register');
    await this.utils.waitReady();
  }

  /**
   * Realiza login con credenciales
   */
  async login(email: string, password: string) {
    await this.utils.fill(this.loginEmail, email);
    await this.utils.fill(this.loginPassword, password);
    await this.utils.click(this.loginSubmit);
  }

  /**
   * Click en el botón de login (para abrir modal o navegar)
   */
  async clickLoginButton() {
    await this.utils.clickNoWait(this.loginBtn);
  }

  /**
   * Click en el botón de registro
   */
  async clickRegisterButton() {
    await this.utils.clickNoWait(this.registerBtn);
  }

  /**
   * Registro de nuevo usuario (stub - implementar según formulario real)
   */
  async register(userData: {
    name: string;
    email: string;
    password: string;
    confirmPassword: string;
  }) {
    // TODO: Implementar cuando se tenga el formulario de registro completo
    await this.utils.fill(
      this.registerForm.getByPlaceholder(/nombre/i),
      userData.name
    );
    await this.utils.fill(
      this.registerForm.getByPlaceholder(/email/i),
      userData.email
    );
    await this.utils.fill(
      this.registerForm.getByPlaceholder(/contraseña/i),
      userData.password
    );
    await this.utils.fill(
      this.registerForm.getByPlaceholder(/confirmar/i),
      userData.confirmPassword
    );

    const submitBtn = this.registerForm.getByRole('button', { name: /registrar/i });
    await this.utils.click(submitBtn);
  }

  /**
   * Verifica que se muestra error de validación
   */
  async verifyValidationError(message?: string | RegExp) {
    await this.utils.assertVisible(`[data-testid="${TID.formError}"]`);
    if (message) {
      await this.utils.assertText(`[data-testid="${TID.formError}"]`, message);
    }
  }

  /**
   * Verifica que el formulario de login está visible
   */
  async verifyLoginFormVisible() {
    await this.utils.assertVisible(`[data-testid="${TID.loginForm}"]`);
  }

  /**
   * Verifica que el formulario de registro está visible
   */
  async verifyRegisterFormVisible() {
    await this.utils.assertVisible(`[data-testid="${TID.registerForm}"]`);
  }

  /**
   * Logout (si existe funcionalidad)
   */
  async logout() {
    const logoutBtn = this.page.getByRole('button', { name: /cerrar sesión/i });
    await this.utils.click(logoutBtn);
  }

  /**
   * Verifica que el usuario está autenticado
   */
  async verifyAuthenticated() {
    // Verificar que existe algún indicador de sesión activa
    const userMenu = this.page.getByTestId('user-menu');
    await this.utils.assertVisible('[data-testid="user-menu"]');
  }

  /**
   * Login con redes sociales (stub)
   */
  async loginWithProvider(provider: 'google' | 'facebook') {
    const providerBtn = this.page.getByRole('button', { 
      name: new RegExp(provider, 'i') 
    });
    await this.utils.clickNoWait(providerBtn);
  }

  /**
   * Recuperar contraseña
   */
  async forgotPassword(email: string) {
    const forgotLink = this.page.getByRole('link', { name: /olvidaste/i });
    await this.utils.click(forgotLink);
    
    const emailInput = this.page.getByPlaceholder(/email/i);
    await this.utils.fill(emailInput, email);
    
    const submitBtn = this.page.getByRole('button', { name: /enviar/i });
    await this.utils.click(submitBtn);
  }
}
