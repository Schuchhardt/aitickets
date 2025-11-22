import { test, expect } from '@playwright/test';
import { AuthPage } from '../Auth.page';

// NOTA: La mayoría de los tests están desactivados porque actualmente
// solo existe la página de registro (/register), no hay página de login (/login)
// Los tests se reactivarán cuando se implemente la funcionalidad de login

test.describe('Auth - Login Tests', () => {
  let authPage: AuthPage;

  test.beforeEach(async ({ page }) => {
    authPage = new AuthPage(page);
  });

  test.skip('@smoke @auth página de login debe cargar correctamente', async ({ page }) => {
    // TODO: Implementar cuando exista página de login (/login)
    await authPage.gotoLogin();
    
    // Verificar que el formulario de login está visible
    await authPage.verifyLoginFormVisible();
    await expect(authPage.loginEmail).toBeVisible();
    await expect(authPage.loginPassword).toBeVisible();
    await expect(authPage.loginSubmit).toBeVisible();
  });

  test.skip('@auth login con credenciales válidas debe autenticar usuario', async ({ page }) => {
    // TODO: Implementar cuando se tenga backend de autenticación
    await authPage.gotoLogin();
    
    await authPage.login('test@example.com', 'password123');
    
    // Verificar redirección o mensaje de éxito
    await page.waitForURL(/dashboard|home/, { timeout: 5000 });
    await authPage.verifyAuthenticated();
  });

  test.skip('@auth login con credenciales inválidas debe mostrar error', async ({ page }) => {
    // TODO: Implementar cuando se tenga backend de autenticación
    await authPage.gotoLogin();
    
    await authPage.login('invalid@example.com', 'wrongpassword');
    
    // Verificar mensaje de error
    await authPage.verifyValidationError(/credenciales|incorrectas/i);
  });

  test.skip('@regression @auth validación de email debe funcionar', async ({ page }) => {
    // TODO: Reactivar cuando exista página de login
    await authPage.gotoLogin();
    
    // Intentar con email inválido
    await authPage.loginEmail.fill('not-an-email');
    await authPage.loginPassword.fill('password123');
    await authPage.loginSubmit.click();
    
    // Debería mostrar error de validación (HTML5 o custom)
    const emailInput = authPage.loginEmail;
    const validationMessage = await emailInput.evaluate((el: HTMLInputElement) => 
      el.validationMessage
    );
    
    expect(validationMessage).toBeTruthy();
  });

  test.skip('@regression @auth campos requeridos deben validarse', async ({ page }) => {
    // TODO: Reactivar cuando exista página de login
    await authPage.gotoLogin();
    
    // Intentar submit sin llenar campos
    await authPage.loginSubmit.click();
    
    // Verificar que los campos tienen validación required
    const emailRequired = await authPage.loginEmail.getAttribute('required');
    const passwordRequired = await authPage.loginPassword.getAttribute('required');
    
    expect(emailRequired).not.toBeNull();
    expect(passwordRequired).not.toBeNull();
  });

  test.skip('@auth debe permitir recuperar contraseña', async ({ page }) => {
    // TODO: Implementar cuando exista funcionalidad
    await authPage.gotoLogin();
    
    await authPage.forgotPassword('test@example.com');
    
    // Verificar mensaje de confirmación
    const successMessage = page.getByText(/correo enviado|email sent/i);
    await expect(successMessage).toBeVisible();
  });

  test('@smoke @auth página de registro debe cargar correctamente', async ({ page }) => {
    await authPage.gotoRegister();
    
    // Verificar que la página de registro cargó (con cualquier formulario visible)
    // Buscar por elementos comunes en un formulario de registro
    const hasForm = await page.locator('form').count() > 0;
    const hasEmailInput = await page.getByPlaceholder(/email|correo/i).count() > 0;
    const hasNameInput = await page.getByPlaceholder(/nombre|name/i).count() > 0;
    
    // Al menos debe tener un formulario O campos de entrada
    expect(hasForm || hasEmailInput || hasNameInput).toBeTruthy();
  });

  test.skip('@auth registro de nuevo usuario debe funcionar', async ({ page }) => {
    // TODO: Implementar cuando se tenga backend
    await authPage.gotoRegister();
    
    await authPage.register({
      name: 'Test User',
      email: 'newuser@example.com',
      password: 'SecurePass123!',
      confirmPassword: 'SecurePass123!'
    });
    
    // Verificar redirección o confirmación
    await page.waitForURL(/confirm|dashboard/, { timeout: 5000 });
  });

  test.skip('@regression @auth contraseñas deben coincidir en registro', async ({ page }) => {
    // TODO: Implementar validación
    await authPage.gotoRegister();
    
    await authPage.register({
      name: 'Test User',
      email: 'test@example.com',
      password: 'Password123!',
      confirmPassword: 'DifferentPass123!'
    });
    
    // Debe mostrar error de validación
    await authPage.verifyValidationError(/contraseñas no coinciden/i);
  });

  test.skip('@auth login con redes sociales debe estar disponible', async ({ page }) => {
    // TODO: Implementar cuando existan providers
    await authPage.gotoLogin();
    
    // Verificar que existen botones de login social
    const googleBtn = page.getByRole('button', { name: /google/i });
    const facebookBtn = page.getByRole('button', { name: /facebook/i });
    
    const socialLoginAvailable = 
      (await googleBtn.count()) > 0 || (await facebookBtn.count()) > 0;
    
    expect(socialLoginAvailable).toBeTruthy();
  });

  test.skip('@accessibility @auth formulario debe ser accesible', async ({ page }) => {
    // TODO: Reactivar cuando exista página de login
    await authPage.gotoLogin();
    
    // Verificar labels asociados a inputs
    const emailLabel = page.locator('label[for*="email"]');
    const passwordLabel = page.locator('label[for*="password"]');
    
    // Debe haber labels o aria-labels
    const hasEmailLabel = (await emailLabel.count()) > 0 || 
      (await authPage.loginEmail.getAttribute('aria-label')) !== null;
    const hasPasswordLabel = (await passwordLabel.count()) > 0 || 
      (await authPage.loginPassword.getAttribute('aria-label')) !== null;
    
    expect(hasEmailLabel || hasPasswordLabel).toBeTruthy();
  });
});
