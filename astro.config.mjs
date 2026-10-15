import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';
import vue from '@astrojs/vue';
import partytown from '@astrojs/partytown';
import tailwindcss from "@tailwindcss/vite";
import svgLoader from 'vite-svg-loader';

import sentry from '@sentry/astro';

export default defineConfig({
  output: 'server',
  adapter: netlify(),
  // Páginas estáticas como /precios.html (no /precios/index.html): Netlify las sirve en /precios con 200,
  // igual que el canonical y el sitemap. Con el formato por carpeta redirigía /precios → /precios/ (301).
  build: { format: 'file' },
  integrations: [vue(), partytown({
    config: {
      forward: ["dataLayer.push", "gtag"]
    }
  }), sentry()
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