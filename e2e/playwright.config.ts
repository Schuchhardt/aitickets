import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './pages',
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { outputFolder: './report' }]],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:4321',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
    // WebKit deshabilitado temporalmente debido a:
    // - Bug de protocolo en macOS 12 ARM64: "FixedBackgroundsPaintRelativeToDocument"
    // - La versión de WebKit está congelada y no recibe actualizaciones
    // - Los tests funcionan correctamente en Chromium y Firefox
    // Para habilitar: descomentar la siguiente línea y actualizar macOS
    // { name: 'webkit',   use: { ...devices['Desktop Safari'] } }
  ],
  webServer: process.env.NO_SERVER
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:4321',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000
      }
});
