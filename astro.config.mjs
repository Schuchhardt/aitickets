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
  integrations: [vue(), partytown({
    config: {
      forward: ["dataLayer.push"]
    }
  }), sentry()
  ],
  vite: {
    plugins: [tailwindcss(), svgLoader()],
    envPrefix: ['PUBLIC_', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'],
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