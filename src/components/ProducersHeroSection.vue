<script setup>
import { ArrowRight } from 'lucide-vue-next';
import FadeInSection from './Hero/FadeInSection.vue';
import GradientBackground from './Hero/GradientBackground.vue';
import { publishUrl, whatsappUrl, DEMO_EVENT_URL } from './landing/links.js';
import { SERVICE_FEE_PERCENT_LABEL } from '../../netlify/lib/fees.mjs';
import { PAYOUT_RELEASE_HOURS } from '../../netlify/lib/legal.mjs';
</script>

<template>
  <section class="relative w-full overflow-hidden text-white px-6 pt-24 pb-16">
    <GradientBackground />
    <div class="relative z-10 container mx-auto px-4 md:px-8 pt-16 text-center lg:text-left">
      <FadeInSection direction="up">
        <p class="inline-flex border items-center gap-2 text-lime-400 font-semibold text-sm mb-4 bg-lime-400/10 px-4 py-1.5 rounded-full font-[Prompt]">
          Para organizadores
        </p>
      </FadeInSection>
      <FadeInSection direction="up" :delay="100">
        <h1 class="text-3xl md:text-4xl lg:text-5xl font-bold leading-tight mb-6 font-[Unbounded] max-w-4xl">
          La ticketera para los que hacen funciones todas las semanas
        </h1>
      </FadeInSection>
      <FadeInSection direction="up" :delay="200">
        <p class="text-lg text-white/85 mb-8 max-w-2xl mx-auto lg:mx-0 font-[Prompt]">
          Vende entradas para tus funciones, gestiona promotores, controla el check-in y revisa tus ventas desde una sola plataforma.
          Sin mensualidad, 0% de comisión para ti (el comprador paga {{ SERVICE_FEE_PERCENT_LABEL }} + IVA) y lo de cada función disponible {{ PAYOUT_RELEASE_HOURS }} h después del show.
        </p>
      </FadeInSection>
      <FadeInSection direction="up" :delay="300">
        <div class="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4">
          <a :href="publishUrl('organizadores_hero')" data-cta="publish" data-section="hero" class="px-6 py-3 text-lg font-bold font-[Unbounded] bg-lime-400 text-black rounded-lg hover:bg-lime-300 transition w-full sm:w-auto group text-center">
            Publicar mi próxima función
            <ArrowRight class="ml-2 inline-block h-4 w-4 transition-transform group-hover:translate-x-1" />
          </a>
          <a :href="whatsappUrl()" data-cta="whatsapp" data-section="hero" target="_blank" rel="noopener noreferrer" class="px-6 py-3 text-lg font-[Prompt] text-white/90 underline underline-offset-4 hover:text-lime-400 transition">
            Hablar por WhatsApp
          </a>
          <a :href="DEMO_EVENT_URL" data-cta="demo_event" data-section="hero" class="px-6 py-3 text-lg font-[Prompt] text-white/90 underline underline-offset-4 hover:text-lime-400 transition">
            Ver evento de ejemplo
          </a>
        </div>
      </FadeInSection>
    </div>
  </section>
</template>
