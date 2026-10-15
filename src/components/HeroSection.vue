<script setup>
import { ArrowRight, Wallet, Users, CalendarDays, Sparkles } from 'lucide-vue-next';
import FadeInSection from './Hero/FadeInSection.vue';
import FeatureCard from './Hero/FeatureCard.vue';
import GradientBackground from './Hero/GradientBackground.vue';
import { publishUrl, whatsappUrl } from './landing/links.js';
import { PAYOUT_RELEASE_HOURS, PAYOUT_BUSINESS_DAYS } from '../../netlify/lib/legal.mjs';
import { SERVICE_FEE_PERCENT_LABEL } from '../../netlify/lib/fees.mjs';

// Cada promesa de esta sección está verificada contra el producto (ver docs/slide.txt: solo lo que hace HOY).
const advantages = [
  {
    icon: Wallet,
    title: 'Cobras por función',
    text: `Lo de cada show queda disponible ${PAYOUT_RELEASE_HOURS} h después de que termina. Lo retiras desde el panel y llega en hasta ${PAYOUT_BUSINESS_DAYS} días hábiles.`,
  },
  {
    icon: Users,
    title: 'Sabes quién vende',
    text: 'Un link para cada comediante, promotor o campaña: ve cuántas entradas y cuánta plata trae cada uno.',
  },
  {
    icon: CalendarDays,
    title: 'Todas tus funciones juntas',
    text: 'Fechas, entradas por función, cortesías y check-in con QR. Duplica el evento para la próxima semana.',
  },
];
</script>
<template>
  <section class="relative w-full overflow-hidden text-white px-6 pt-24 pb-12 min-h-screen">
    <GradientBackground variant="alt" />
    <div class="container mx-auto px-4 md:px-8 relative pt-16 z-10">
      <div class="w-full text-center lg:text-left">
        <FadeInSection direction="up">
          <p class="inline-flex border items-center gap-2 text-lime-400 font-semibold text-sm mb-4 bg-lime-400/10 px-4 py-1.5 rounded-full font-[Prompt]">
            Para productores · Sin mensualidad · 0% de comisión para ti
          </p>
        </FadeInSection>

        <FadeInSection direction="up" :delay="100">
          <h1 class="text-3xl md:text-4xl lg:text-5xl font-bold text-white leading-tight mb-6 font-[Unbounded] max-w-4xl">
            Tu próxima función
            <span class="relative inline-block">
              merece vender más.
              <span class="absolute bottom-2 left-0 w-full h-3 bg-lime-400/30 -z-10 rounded"></span>
            </span>
          </h1>
        </FadeInSection>

        <FadeInSection direction="up" :delay="200">
          <p class="text-lg text-white/80 mb-8 max-w-2xl mx-auto lg:mx-0 font-[Prompt]">
            La ticketera para quienes hacen funciones todas las semanas: publica tus fechas, mide qué link o promotor vende,
            organiza a tu equipo y cobra lo de cada función. Todo desde un solo lugar.
          </p>
        </FadeInSection>

        <FadeInSection direction="up" :delay="300">
          <div class="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 mb-4">
            <a :href="publishUrl('hero')" data-cta="publish" data-section="hero" class="px-6 py-3 text-lg font-bold font-[Unbounded] bg-lime-400 text-black border border-lime-400 rounded-lg transition hover:bg-black hover:text-lime-400 w-full sm:w-auto group text-center">
              Publicar mi próxima función
              <ArrowRight class="ml-2 inline-block h-4 w-4 transition-transform group-hover:translate-x-1" />
            </a>
            <a :href="whatsappUrl()" data-cta="whatsapp" data-section="hero" target="_blank" rel="noopener noreferrer" class="px-6 py-3 text-lg font-bold font-[Unbounded] border border-white rounded-lg hover:bg-white hover:text-black transition w-full sm:w-auto text-center">
              Hablar por WhatsApp
            </a>
          </div>
          <p class="text-sm text-white/60 mb-10 font-[Prompt]">
            Crear tu cuenta y publicar es gratis. El comprador paga un cargo por servicio de {{ SERVICE_FEE_PERCENT_LABEL }} + IVA
            (o lo absorbes tú). <a href="#ia" class="inline-flex items-center gap-1 underline hover:text-lime-400"><Sparkles class="h-3.5 w-3.5" />También desde Claude o ChatGPT</a>
          </p>
        </FadeInSection>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 pb-8 text-left">
          <FadeInSection v-for="(a, i) in advantages" :key="a.title" direction="up" :delay="400 + i * 100">
            <FeatureCard :icon="a.icon" :title="a.title" :text="a.text" />
          </FadeInSection>
        </div>
      </div>
    </div>
  </section>
</template>
