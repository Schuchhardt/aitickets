<script setup>
// Plantilla "Festival": colores intensos, títulos grandes en mayúsculas, eventos como pósters.
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

    <section class="bg-[var(--site-primary)] text-white overflow-hidden">
      <div class="max-w-6xl mx-auto px-5 lg:px-8 py-14 sm:py-20 grid gap-8 md:grid-cols-2 md:items-center">
        <div>
          <h1 class="text-5xl sm:text-7xl font-bold uppercase leading-[0.9]">{{ site.name }}</h1>
          <p v-if="site.content.tagline" class="mt-5 text-lg text-white/90 max-w-xl">{{ site.content.tagline }}</p>
          <a :href="`${base || '/'}#eventos`" class="inline-block mt-8 bg-[var(--site-accent)] text-black px-7 py-3 font-bold uppercase tracking-wide -rotate-1">Ver line-up</a>
        </div>
        <img
          v-if="!hasHeroBanner && site.theme.hero_image_url"
          :src="site.theme.hero_image_url"
          :alt="site.name"
          class="w-full h-72 object-cover rotate-2 shadow-2xl"
          fetchpriority="high"
        />
      </div>
    </section>

    <BannerStrip :banners="banners" placement="hero" />

    <main class="max-w-6xl mx-auto px-5 lg:px-8">
      <section id="eventos" class="pt-12">
        <h2 class="text-4xl font-bold uppercase mb-8">Próximos eventos</h2>
        <EventGrid :events="events" :base="base" variant="poster" />
      </section>

      <BannerStrip :banners="banners" placement="inline" />

      <section v-if="aboutHtml" class="pt-16 max-w-3xl">
        <h2 class="text-4xl font-bold uppercase mb-4">Quiénes somos</h2>
        <div class="leading-relaxed text-lg" v-html="aboutHtml"></div>
      </section>

      <section v-if="site.contact_form_enabled" class="mt-16 bg-[var(--site-accent)] text-black p-8 -rotate-1">
        <h2 class="text-3xl font-bold uppercase">Contacto</h2>
        <p class="mt-2">Auspicios, prensa y consultas.</p>
        <a :href="`${base}/contacto`" class="inline-block mt-5 bg-black text-white px-6 py-3 font-bold uppercase">Escríbenos</a>
      </section>
    </main>

    <SiteFooter :site="site" :base="base" />
  </div>
</template>
