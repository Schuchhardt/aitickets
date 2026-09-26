<script setup>
// Pie de un sitio de productor: redes del productor + aviso de quién vende las entradas.
import { LEGAL } from "../../lib/legal";

defineProps({
  site: { type: Object, required: true }, // PublicSiteProps
  base: { type: String, default: "" },
});

const SOCIAL_LABELS = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  x: "X",
  youtube: "YouTube",
  whatsapp: "WhatsApp",
  website: "Sitio web",
};
const year = new Date().getFullYear();
</script>

<template>
  <footer class="site-font border-t border-current/10 mt-16">
    <div class="max-w-6xl mx-auto px-5 lg:px-8 py-10 flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
      <div>
        <p class="font-bold text-lg">{{ site.name }}</p>
        <p v-if="site.content?.tagline" class="text-sm opacity-70 mt-1 max-w-md">{{ site.content.tagline }}</p>
        <ul v-if="Object.keys(site.socials || {}).length" class="flex flex-wrap gap-4 mt-4 text-sm">
          <li v-for="(url, key) in site.socials" :key="key">
            <a :href="url" target="_blank" rel="noopener noreferrer nofollow" class="underline underline-offset-4 hover:opacity-70">
              {{ SOCIAL_LABELS[key] || key }}
            </a>
          </li>
        </ul>
      </div>
      <nav class="flex flex-col gap-2 text-sm">
        <a :href="`${base || '/'}#eventos`" class="hover:opacity-70">Próximos eventos</a>
        <a v-if="site.contact_form_enabled" :href="`${base}/contacto`" class="hover:opacity-70">Contacto</a>
      </nav>
    </div>
    <div class="border-t border-current/10">
      <div class="max-w-6xl mx-auto px-5 lg:px-8 py-4 text-xs opacity-70 flex flex-col gap-1 md:flex-row md:justify-between">
        <p>© {{ year }} {{ site.name }}</p>
        <p>
          Entradas vendidas por
          <a :href="`${LEGAL.siteUrl}/?utm_source=sitio_productor&utm_medium=footer&utm_campaign=${site.slug}`" class="underline" rel="noopener">{{ LEGAL.brand }}</a>
          · operado por {{ LEGAL.entity }} ·
          <a :href="`${LEGAL.siteUrl}/terms`" class="underline" rel="noopener">Términos</a> ·
          <a :href="`${LEGAL.siteUrl}/privacy`" class="underline" rel="noopener">Privacidad</a>
        </p>
      </div>
    </div>
  </footer>
</template>
