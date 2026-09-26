// Tests unitarios (lógica pura). Sin red, sin BD y sin secretos: tests/unit/setup.mjs limpia las
// variables de entorno sensibles y bloquea fetch. Los e2e (Playwright) viven en tests/e2e.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.{ts,mjs}"],
    setupFiles: ["tests/unit/setup.mjs"],
    restoreMocks: true,
    unstubEnvs: true,
    testTimeout: 15_000,
  },
  // Vite expone en import.meta.env las variables del .env con estos prefijos. Se usa un prefijo que no
  // existe para que el .env local (con claves reales) nunca llegue a los tests.
  envPrefix: "AITICKETS_TEST_ONLY_",
});
