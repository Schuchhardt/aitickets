

<script setup>
import { ArrowRight, Users, Sparkles, Calendar, BarChart3 } from 'lucide-vue-next';
import FadeInSection from './Hero/FadeInSection.vue';
import FeatureCard from './Hero/FeatureCard.vue';
import GradientBackground from './Hero/GradientBackground.vue';

</script>
<template>
  <section class="relative w-full overflow-hidden text-white px-6 pt-24 pb-12 min-h-screen">
    <!-- Fondo animado tipo morphing -->
    <GradientBackground  variant="alt"/>
    <!-- Contenido encima -->
    <div class="container mx-auto px-4 md:px-8 relative pt-16 z-10">
      <div class="flex flex-col lg:flex-row items-center justify-between gap-12">
        <div class="w-full text-center lg:text-left">
          <FadeInSection direction="up">
            <span class="inline-flex border items-center gap-2 text-lime-400 font-semibold sm:text-xs text-sm md:text-base mb-4 bg-lime-400/10 px-4 py-1.5 rounded-full font-[Prompt]">
              <Sparkles class="h-4 w-4" />
              Revolucionando el mundo de los eventos
            </span>
          </FadeInSection>

          <FadeInSection direction="up" :delay="100">
            <h1 class="text-3xl md:text-2xl lg:text-4xl font-bold text-white leading-tight mb-6 font-[Unbounded]">
              Donde la comunidad encuentra su
              <span class="relative inline-block">
                evento ideal
                <span class="absolute bottom-2 left-0 w-full h-3 bg-lime-400/30 -z-10 rounded"></span>
              </span>
            </h1>
          </FadeInSection>

          <FadeInSection direction="up" :delay="200">
            <p class="text-lg text-white/80 mb-8 max-w-2xl mx-auto lg:mx-0 font-[Prompt]">
              AI Tickets conecta a las personas con sus eventos ideales y ayuda a los productores a vender más, de forma automática.
            </p>
          </FadeInSection>

          <FadeInSection direction="up" :delay="300">
            <div class="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 mb-12">
              <a href="/register" class="px-6 py-3 text-lg font-bold font-[Unbounded] border border-white rounded-lg hover:bg-white hover:text-black transition w-full sm:w-auto group">
                Comienza Ahora
                <ArrowRight class="ml-2 inline-block h-4 w-4 transition-transform group-hover:translate-x-1" />
              </a>
              <a href="/eventos" class="px-6 py-3 text-lg font-bold font-[Unbounded] bg-lime-400 text-black border border-black rounded-lg transition hover:bg-black hover:text-white w-full sm:w-auto">
                Explorar Eventos
              </a>
            </div>
          </FadeInSection>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 pb-8">
            <FadeInSection direction="up" :delay="400">
              <FeatureCard :icon="Calendar" title="Gestión Inteligente" text="Crea y administra eventos desde un solo lugar con herramientas intuitivas" />
            </FadeInSection>
            <FadeInSection direction="up" :delay="500">
              <FeatureCard :icon="Users" title="Marketing IA" text="Promociona tus eventos al público perfecto con nuestros algoritmos inteligentes" />
            </FadeInSection>
            <FadeInSection direction="up" :delay="600">
              <FeatureCard :icon="BarChart3" title="Analítica Avanzada" text="Métricas en tiempo real para maximizar ventas y optimizar tu estrategia" />
            </FadeInSection>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
