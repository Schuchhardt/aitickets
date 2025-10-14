# Tests E2E con Playwright - aitickets-app

Tests end-to-end para aitickets-app utilizando Playwright. Estructura modular por features con Page Objects y utilidades compartidas.

## 📁 Estructura

```
e2e/
├── playwright.config.ts      # Configuración principal de Playwright
├── README.md                  # Este archivo
├── support/                   # Utilidades y helpers compartidos
│   ├── test-ids.ts           # IDs de test centralizados
│   ├── test-utils.ts         # Clase TestUtils con métodos comunes
│   └── msw/                  # Mock Service Worker (opcional)
│       ├── browser.ts        # Setup de MSW
│       └── handlers/         # Handlers de mocks de API
│           └── example.handlers.ts
└── pages/                     # Page Objects organizados por feature
    ├── home/
    │   ├── Home.page.ts
    │   └── tests/
    │       └── home.smoke.spec.ts
    └── auth/
        ├── Auth.page.ts
        └── tests/
            └── auth.login.spec.ts
```

## 🚀 Instalación

Las dependencias ya están instaladas. Si necesitas reinstalar:

```bash
npm install
npx playwright install --with-deps
```

## 🧪 Ejecución de Tests

### Comandos principales

```bash
# Ejecutar todos los tests (levanta servidor automáticamente)
npm run e2e

# Ejecutar tests directamente con Playwright
npm run test:e2e

# Ejecutar tests con UI interactiva
npm run test:e2e:ui

# Ejecutar tests en modo headed (ver el browser)
npm run test:e2e:headed

# Ejecutar solo tests con tag @smoke
npm run test:e2e:smoke

# Ejecutar tests sin levantar servidor (debe estar corriendo)
npm run test:e2e:noserver
```

### Filtrar por tags

```bash
# Solo smoke tests
npm run test:e2e -- -g "@smoke"

# Solo tests de auth
npm run test:e2e -- -g "@auth"

# Solo tests de regression
npm run test:e2e -- -g "@regression"

# Excluir tests específicos
npm run test:e2e -- --grep-invert "@skip"
```

### Filtrar por archivo o feature

```bash
# Ejecutar solo tests de home
npm run test:e2e -- e2e/pages/home

# Ejecutar un archivo específico
npm run test:e2e -- e2e/pages/home/tests/home.smoke.spec.ts

# Ejecutar en un browser específico
npm run test:e2e -- --project=chromium
```

## 📝 Convenciones

### Nomenclatura de archivos

- **Page Objects**: `<Feature>.page.ts` (PascalCase)
  - Ejemplo: `Home.page.ts`, `Auth.page.ts`, `Checkout.page.ts`

- **Tests**: `<feature>.<caso>.spec.ts` (kebab-case)
  - Ejemplo: `home.smoke.spec.ts`, `auth.login.spec.ts`, `checkout.flow.spec.ts`

- **Datos de prueba**: `<feature>.data.json`
  - Ubicación: `e2e/pages/<feature>/data/`

### Tags en tests

Usar tags en el título del test para facilitar filtrado:

```typescript
test('@smoke @home carga home correctamente', async ({ page }) => {
  // test code
});

test('@regression @auth login con credenciales válidas', async ({ page }) => {
  // test code
});
```

**Tags disponibles:**
- `@smoke` - Tests críticos que deben pasar siempre
- `@regression` - Tests de regresión completos
- `@auth` - Tests de autenticación
- `@home` - Tests de la página principal
- `@checkout` - Tests de flujo de compra
- `@accessibility` - Tests de accesibilidad
- `@performance` - Tests de performance
- `@skip` - Tests temporalmente deshabilitados (usar `test.skip()`)

### Selectores con data-testid

**Siempre** usar `data-testid` en componentes interactivos:

```vue
<!-- En el componente Vue/Astro -->
<button data-testid="login-button">Login</button>
<div data-testid="event-card">...</div>
```

```typescript
// En el test
import { TID } from '@e2e/support/test-ids';

const loginBtn = page.getByTestId(TID.loginBtn);
await loginBtn.click();
```

Los `data-testid` están centralizados en `e2e/support/test-ids.ts`.

## 🏗️ Crear un nuevo Feature de Test

### 1. Crear estructura de carpetas

```bash
mkdir -p e2e/pages/checkout/tests
mkdir -p e2e/pages/checkout/data
```

### 2. Crear Page Object

`e2e/pages/checkout/Checkout.page.ts`:

```typescript
import { Page, Locator } from '@playwright/test';
import { TID } from '@e2e/support/test-ids';
import { TestUtils } from '@e2e/support/test-utils';

export class CheckoutPage {
  private utils: TestUtils;

  readonly checkoutForm: Locator;
  readonly submitButton: Locator;

  constructor(private page: Page) {
    this.utils = new TestUtils(page);
    
    this.checkoutForm = this.page.getByTestId(TID.checkoutForm);
    this.submitButton = this.page.getByTestId(TID.submitButton);
  }

  async goto() {
    await this.page.goto('/checkout');
    await this.utils.waitReady();
  }

  async fillCheckoutForm(data: CheckoutData) {
    // Implementar lógica
  }
}
```

### 3. Crear tests

`e2e/pages/checkout/tests/checkout.flow.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { CheckoutPage } from '../Checkout.page';

test.describe('Checkout Flow', () => {
  test('@smoke @checkout debe completar compra', async ({ page }) => {
    const checkout = new CheckoutPage(page);
    await checkout.goto();
    
    // Test logic
  });
});
```

### 4. Agregar test-ids necesarios

Actualizar `e2e/support/test-ids.ts`:

```typescript
export const TID = {
  // ... existentes
  checkoutForm: 'checkout-form',
  submitButton: 'submit-button',
  // ...
};
```

### 5. Agregar data-testids en componentes

En tus componentes Vue/Astro:

```vue
<template>
  <form data-testid="checkout-form">
    <button data-testid="submit-button">Pagar</button>
  </form>
</template>
```

## 🎭 Mocks y Datos de Prueba

### Usando page.route (simple)

```typescript
test('debe mostrar eventos mockeados', async ({ page }) => {
  await page.route('**/api/events', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 1, name: 'Test Event' }])
    });
  });

  await page.goto('/');
});
```

### Usando MSW (avanzado)

Ver `e2e/support/msw/handlers/example.handlers.ts` para ejemplos.

### Datos de prueba en JSON

Crear archivos JSON en `e2e/pages/<feature>/data/`:

```json
// e2e/pages/auth/data/users.json
{
  "validUser": {
    "email": "test@example.com",
    "password": "password123"
  },
  "invalidUser": {
    "email": "invalid@example.com",
    "password": "wrongpass"
  }
}
```

Importar en tests:

```typescript
import userData from '../data/users.json';

test('login', async ({ page }) => {
  await authPage.login(userData.validUser.email, userData.validUser.password);
});
```

## 🔧 TestUtils

La clase `TestUtils` proporciona métodos útiles:

```typescript
const utils = new TestUtils(page);

// Esperar carga completa
await utils.waitReady();

// Click con espera
await utils.click(locator);

// Assertions comunes
await utils.assertVisible('selector');
await utils.assertText('selector', 'expected text');

// Mock de APIs
await utils.mockApiResponse('/api/endpoint', { data: 'mock' });

// Screenshot
await utils.screenshot('test-name');

// LocalStorage
await utils.setLocalStorage('key', 'value');
const value = await utils.getLocalStorage('key');
```

## 🌐 Variables de Entorno

Crear `.env.test` en la raíz:

```env
BASE_URL=http://localhost:4321
API_URL=http://localhost:3000
SUPABASE_URL=http://localhost:54321
SUPABASE_KEY=test-key
```

Usar en tests:

```typescript
test('debe usar env vars', async ({ page }) => {
  await page.goto(process.env.BASE_URL || 'http://localhost:4321');
});
```

## 📊 Reportes

### HTML Report

Después de ejecutar tests, el reporte se genera en `e2e/report/`:

```bash
npm run test:e2e
npx playwright show-report e2e/report
```

### Screenshots y Videos

- **Screenshots**: Solo en fallos (`screenshot: 'only-on-failure'`)
- **Videos**: Solo en fallos (`video: 'retain-on-failure'`)
- **Traces**: En primer retry (`trace: 'on-first-retry'`)

Ver en el reporte HTML.

## 🔄 CI/CD

### Ejemplo GitHub Actions

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: 18
          
      - name: Install dependencies
        run: npm ci
        
      - name: Install Playwright
        run: npx playwright install --with-deps
        
      - name: Run E2E tests
        run: npm run e2e
        
      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report
          path: e2e/report/
```

## 🐛 Debugging

### Modo UI

```bash
npm run test:e2e:ui
```

### Modo Headed

```bash
npm run test:e2e:headed
```

### Debug específico

```bash
npx playwright test --debug e2e/pages/home/tests/home.smoke.spec.ts
```

### Inspector de Playwright

```typescript
test('debug test', async ({ page }) => {
  await page.pause(); // Abre el inspector
  // ... resto del test
});
```

## 📋 Checklist para PRs

Antes de crear un PR con tests:

- [ ] Tests pasan localmente: `npm run test:e2e`
- [ ] Tests pasan en modo smoke: `npm run test:e2e:smoke`
- [ ] Todos los elementos interactivos tienen `data-testid`
- [ ] Page Objects siguen convenciones de nomenclatura
- [ ] Tests tienen tags apropiados (`@smoke`, `@regression`, etc.)
- [ ] No hay `test.only()` o `test.skip()` sin justificación
- [ ] Tests son independientes (no dependen de orden)
- [ ] Se limpiaron console.logs de debugging

## 🆘 Troubleshooting

### "Server already running"

```bash
# Matar proceso en puerto 4321
lsof -ti:4321 | xargs kill -9

# O ejecutar sin server
npm run test:e2e:noserver
```

### "Browser not found"

```bash
npx playwright install --with-deps
```

### Tests timeout

Aumentar timeout en `playwright.config.ts`:

```typescript
export default defineConfig({
  timeout: 90_000, // 90 segundos
});
```

### Tests flaky

- Usar `waitForLoadState('networkidle')`
- Evitar `page.waitForTimeout()` cuando sea posible
- Usar selectores estables (data-testid)
- Agregar `retries` en config

## 📚 Recursos

- [Playwright Docs](https://playwright.dev)
- [Best Practices](https://playwright.dev/docs/best-practices)
- [Astro Docs](https://docs.astro.build)

---

**¿Preguntas?** Abre un issue o contacta al equipo de QA.
