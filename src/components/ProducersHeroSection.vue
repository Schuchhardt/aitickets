<script setup>
import { ArrowRight, Users, Sparkles, Calendar, BarChart3 } from 'lucide-vue-next';
import summitHero from '../images/summit.jpg';
import FadeInSection from './Hero/FadeInSection.vue';
import FeatureCard from './Hero/FeatureCard.vue';
</script>

<template>
  <section class="relative min-h-screen flex items-center justify-center text-white text-center px-6 overflow-hidden main-section">
    <!-- Fondo borroso con imagen -->
    <div class="absolute inset-0 bg-cover bg-center blur-background" :style="{ backgroundImage: `url(${summitHero.src})` }"></div>

    <div class="container mx-auto px-4 md:px-8 pt-2 relative z-10">
      <div class="flex flex-col lg:flex-row items-center justify-between gap-12">
        <div class="w-full text-center lg:text-left">
          <FadeInSection direction="up">
            <span class="inline-flex border items-center gap-2 text-lime-400 font-semibold sm:text-xs text-sm md:text-base mb-4 bg-lime-400/10 px-4 py-1.5 rounded-full font-[Prompt]">
              <Sparkles class="h-4 w-4" />
              Pensado para productores de eventos
            </span>
          </FadeInSection>

          <FadeInSection direction="up" :delay="100">
            <h1 class="text-3xl md:text-2xl lg:text-4xl font-bold text-white leading-tight mb-6 font-[Unbounded]">
              La plataforma que vende
              <span class="relative inline-block">
                por ti
                <span class="absolute bottom-2 left-0 w-full h-3 bg-lime-400/30 -z-10 rounded"></span>
              </span>
            </h1>
          </FadeInSection>

          <FadeInSection direction="up" :delay="200">
            <p class="text-lg text-white/80 mb-8 max-w-2xl mx-auto lg:mx-0 font-[Prompt]">
              Conecta con tu público ideal, vende entradas automáticamente y obtén métricas clave en tiempo real. Todo desde un solo lugar.
            </p>
          </FadeInSection>

          <FadeInSection direction="up" :delay="300">
            <div class="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 mb-12">
              <a href="/register" class="px-6 py-3 text-lg font-bold font-[Unbounded] border border-white rounded-lg hover:bg-white hover:text-black transition w-full sm:w-auto group">
                Comienza ahora
                <ArrowRight class="ml-2 inline-block h-4 w-4 transition-transform group-hover:translate-x-1" />
              </a>
            </div>
          </FadeInSection>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 pb-8">
            <FadeInSection direction="up" :delay="400">
              <FeatureCard :icon="Calendar" title="Gestión inteligente" text="Crea y administra eventos fácilmente desde tu panel de control." />
            </FadeInSection>
            <FadeInSection direction="up" :delay="500">
              <FeatureCard :icon="Users" title="Marketing automático" text="Llega al público correcto con campañas optimizadas por IA." />
            </FadeInSection>
            <FadeInSection direction="up" :delay="600">
              <FeatureCard :icon="BarChart3" title="Análisis en tiempo real" text="Visualiza ventas, conversiones y tráfico sin esfuerzo." />
            </FadeInSection>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.blur-background {
  filter: blur(30px);
  position: absolute;
  width: 100%;
  height: 100%;
}

@media (max-width: 640px) {
  .main-section {
    padding-top: 80px;
  }
}

@media (max-width: 768px) {
  .main-section {
    padding-top: 100px;
  }
}
</style>
