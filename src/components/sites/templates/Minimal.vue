<script setup>
// Plantilla "Minimal": tipografía protagonista, lista de eventos, sin adornos.
import SiteHeader from "../SiteHeader.vue";
import SiteFooter from "../SiteFooter.vue";
import BannerStrip from "../BannerStrip.vue";
import EventGrid from "../EventGrid.vue";

defineProps({
  site: { type: Object, required: true },
  events: { type: Array, required: false },
  banners: { type: Array, required: false },
  aboutHtml: { type: String, default: "" },
  base: { type: String, default: "" },
});
</script>

<template>
  <div class="site-font min-h-screen bg-[var(--site-bg)] text-[var(--site-text)]">
    <BannerStrip :banners="banners" placement="top_bar" />
    <SiteHeader :site="site" :base="base" />

    <main class="max-w-3xl mx-auto px-5 lg:px-8">
      <section class="pt-16 pb-10">
        <h1 class="text-4xl sm:text-5xl font-semibold tracking-tight break-words">{{ site.name }}</h1>
        <p v-if="site.content.tagline" class="mt-4 text-lg opacity-70">{{ site.content.tagline }}</p>
      </section>

      <BannerStrip :banners="banners" placement="hero" />

      <section id="eventos" class="pt-10">
        <h2 class="text-xs uppercase tracking-widest opacity-60 mb-4">Próximos eventos</h2>
        <EventGrid :events="events" :base="base" variant="list" />
      </section>

      <BannerStrip :banners="banners" placement="inline" />

      <section v-if="aboutHtml" class="pt-14">
        <h2 class="text-xs uppercase tracking-widest opacity-60 mb-4">Sobre nosotros</h2>
        <div class="leading-relaxed text-lg" v-html="aboutHtml"></div>
      </section>

      <p v-if="site.contact_form_enabled" class="pt-12 text-lg">
        ¿Preguntas? <a :href="`${base}/contacto`" class="underline underline-offset-4 decoration-2 decoration-[var(--site-accent)]">Escríbenos</a>.
      </p>
    </main>

    <SiteFooter :site="site" :base="base" />
  </div>
</template>
