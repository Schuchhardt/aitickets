<script setup>
// Plantilla "Clásico": fondo claro, héroe con banner o imagen, grilla de tarjetas.
import SiteHeader from "../SiteHeader.vue";
import SiteFooter from "../SiteFooter.vue";
import BannerStrip from "../BannerStrip.vue";
import EventGrid from "../EventGrid.vue";

const props = defineProps({
  site: { type: Object, required: true },
  events: { type: Array, required: false },
  banners: { type: Array, required: false },
  aboutHtml: { type: String, default: "" },
  base: { type: String, default: "" },
});
const hasHeroBanner = (props.banners || []).some((b) => b.placement === "hero");
</script>

<template>
  <div class="site-font min-h-screen bg-[var(--site-bg)] text-[var(--site-text)]">
    <BannerStrip :banners="banners" placement="top_bar" />
    <SiteHeader :site="site" :base="base" />

    <BannerStrip v-if="hasHeroBanner" :banners="banners" placement="hero" />
    <section v-else class="relative">
      <img
        v-if="site.theme.hero_image_url"
        :src="site.theme.hero_image_url"
        :alt="site.name"
        class="w-full h-[260px] sm:h-[380px] object-cover"
        fetchpriority="high"
      />
      <div v-else class="max-w-6xl mx-auto px-5 lg:px-8 pt-14 pb-6">
        <h1 class="text-3xl sm:text-5xl font-bold leading-tight">{{ site.name }}</h1>
        <p v-if="site.content.tagline" class="mt-4 text-lg opacity-75 max-w-2xl">{{ site.content.tagline }}</p>
      </div>
    </section>

    <main class="max-w-6xl mx-auto px-5 lg:px-8">
      <div v-if="hasHeroBanner || site.theme.hero_image_url" class="pt-10">
        <h1 class="text-3xl sm:text-4xl font-bold">{{ site.name }}</h1>
        <p v-if="site.content.tagline" class="mt-3 text-lg opacity-75 max-w-2xl">{{ site.content.tagline }}</p>
      </div>

      <section id="eventos" class="pt-10">
        <h2 class="text-2xl font-bold mb-6 border-b-4 border-[var(--site-accent)] inline-block pb-1">Próximos eventos</h2>
        <EventGrid :events="events" :base="base" variant="card" />
      </section>

      <BannerStrip :banners="banners" placement="inline" />

      <section v-if="aboutHtml" class="pt-14 max-w-3xl">
        <h2 class="text-2xl font-bold mb-4">Sobre nosotros</h2>
        <div class="prose-site leading-relaxed opacity-90" v-html="aboutHtml"></div>
      </section>

      <section v-if="site.contact_form_enabled" class="mt-14 rounded-2xl bg-[var(--site-primary)] text-[var(--site-bg)] p-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 class="text-xl font-bold">¿Quieres contactarnos?</h2>
          <p class="opacity-80 mt-1">Escríbenos y te responderemos a tu correo.</p>
        </div>
        <a :href="`${base}/contacto`" class="rounded-full bg-[var(--site-accent)] text-black px-6 py-3 font-bold text-center">Contacto</a>
      </section>
    </main>

    <SiteFooter :site="site" :base="base" />
  </div>
</template>
