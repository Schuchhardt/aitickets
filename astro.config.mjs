import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';
import vue from '@astrojs/vue';
import tailwindcss from "@tailwindcss/vite";


export default defineConfig({
  output: 'server',
  adapter: netlify(),
  integrations: [vue()],
  vite: {
    plugins: [tailwindcss()],
  },
});
