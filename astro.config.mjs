import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';
import vue from '@astrojs/vue';
import partytown from '@astrojs/partytown';
import tailwindcss from "@tailwindcss/vite";
import svgLoader from 'vite-svg-loader';

import sentry from '@sentry/astro';

// Páginas con datos fijos para los e2e sin BD (tests/e2e/fixtures/event-fixture-page.astro): solo en
// `astro dev` con E2E_FIXTURES=1 (playwright.config.ts). Nunca en el build de producción.
const e2eFixtures = {
  name: 'aitickets-e2e-fixtures',
  hooks: {
    'astro:config:setup': ({ command, injectRoute }) => {
      if (command !== 'dev' || process.env.E2E_FIXTURES !== '1') return;
      injectRoute({ pattern: '/__e2e/eventos/[escenario]', entrypoint: './tests/e2e/fixtures/event-fixture-page.astro', prerender: false });
    },
  },
};

export default defineConfig({
  output: 'server',
  adapter: netlify(),
  // Páginas estáticas como /precios.html (no /precios/index.html): Netlify las sirve en /precios con 200,
  // igual que el canonical y el sitemap. Con el formato por carpeta redirigía /precios → /precios/ (301).
  build: { format: 'file' },
  // Landing de clubs (SPEC_landing_clubs §9): la URL principal es /ticketera-discotecas (la búsqueda dominante en Chile);
  // las variantes con "clubs" llegan con 301. En Netlify el adaptador las pasa a _redirects.
  redirects: {
    '/ticketera-clubs': { status: 301, destination: '/ticketera-discotecas' },
    '/ticketera-clubes': { status: 301, destination: '/ticketera-discotecas' },
  },
  integrations: [vue(), partytown({
    config: {
      forward: ["dataLayer.push", "gtag"]
    }
  }), sentry(), e2eFixtures
  ],
  vite: {
    plugins: [tailwindcss(), svgLoader()],
    envPrefix: ['PUBLIC_'],
    server: {
      host: true,
      port: 4321,
      allowedHosts: 'd79e-186-106-209-178.ngrok-free.app'
    }
  },
  security: {
    checkOrigin: false
  }
});