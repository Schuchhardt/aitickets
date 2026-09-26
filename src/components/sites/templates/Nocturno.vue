<script setup>
// Plantilla "Nocturno": fondo oscuro, héroe a pantalla completa con degradado, tarjetas con brillo.
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
const heroBanner = (props.banners || []).find((b) => b.placement === "hero");
const heroImage = heroBanner?.image_url || props.site.theme.hero_image_url || (props.events || [])[0]?.image_url || null;
</script>

<template>
  <div class="site-font min-h-screen bg-[var(--site-bg)] text-[var(--site-text)]">
    <BannerStrip :banners="banners" placement="top_bar" />
    <section class="relative min-h-[70vh] flex items-end overflow-hidden">
      <SiteHeader :site="site" :base="base" variant="transparent" />
      <img v-if="heroImage" :src="heroImage" :alt="heroBanner?.alt || site.name" class="absolute inset-0 w-full h-full object-cover" fetchpriority="high" />
      <div class="absolute inset-0 bg-gradient-to-t from-[var(--site-bg)] via-black/60 to-black/30"></div>
      <div class="relative max-w-6xl mx-auto w-full px-5 lg:px-8 pb-14 pt-32">
        <h1 class="text-4xl sm:text-6xl font-bold leading-none text-white drop-shadow">{{ site.name }}</h1>
        <p v-if="site.content.tagline" class="mt-4 text-lg text-white/80 max-w-2xl">{{ site.content.tagline }}</p>
        <div class="mt-8 flex flex-wrap gap-3">
          <a :href="`${base || '/'}#eventos`" class="rounded-full bg-[var(--site-primary)] text-black px-6 py-3 font-bold">Ver eventos</a>
          <a v-if="heroBanner?.link_url" :href="heroBanner.link_url" rel="noopener" class="rounded-full border border-white/40 text-white px-6 py-3 font-bold">Destacado</a>
        </div>
      </div>
    </section>

    <main class="max-w-6xl mx-auto px-5 lg:px-8">
      <section id="eventos" class="pt-12">
        <h2 class="text-sm uppercase tracking-[0.3em] text-[var(--site-accent)] mb-2">Agenda</h2>
        <p class="text-3xl font-bold mb-8">Próximos eventos</p>
        <EventGrid :events="events" :base="base" variant="card" />
      </section>

      <BannerStrip :banners="banners" placement="inline" />

      <section v-if="aboutHtml" class="pt-16 grid gap-6 md:grid-cols-3">
        <h2 class="text-sm uppercase tracking-[0.3em] text-[var(--site-accent)]">Nosotros</h2>
        <div class="md:col-span-2 leading-relaxed opacity-90" v-html="aboutHtml"></div>
      </section>

      <section v-if="site.contact_form_enabled" class="mt-16 rounded-3xl border border-white/10 bg-white/5 p-8 text-center">
        <h2 class="text-2xl font-bold">Hablemos</h2>
        <p class="opacity-75 mt-2">Reservas, prensa o colaboraciones: escríbenos.</p>
        <a :href="`${base}/contacto`" class="inline-block mt-6 rounded-full bg-[var(--site-accent)] text-black px-6 py-3 font-bold">Contacto</a>
      </section>
    </main>

    <SiteFooter :site="site" :base="base" />
  </div>
</template>
