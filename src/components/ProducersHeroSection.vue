<script setup>
import { ArrowRight, Sparkles, Calendar, BarChart3 } from 'lucide-vue-next';
import FadeInSection from './Hero/FadeInSection.vue';
import FeatureCard from './Hero/FeatureCard.vue';
import GradientBackground from './Hero/GradientBackground.vue';
</script>

<template>
    <section class="relative w-full overflow-hidden text-white px-6 pt-24 pb-12 min-h-screen">
        
      <GradientBackground />
      <!-- Contenido encima -->
      <div class="relative z-10 container mx-auto px-4 md:px-8 pt-16">
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
                La ticketera que
                <span class="relative inline-block">
                  llena tus funciones
                  <span class="absolute bottom-2 left-0 w-full h-3 bg-lime-400/30 -z-10 rounded"></span>
                </span>
              </h1>
            </FadeInSection>
  
            <FadeInSection direction="up" :delay="200">
              <p class="text-lg text-white/90 mb-8 max-w-2xl mx-auto lg:mx-0 font-[Prompt]">
                0% de comisión para ti: el comprador paga un cargo por servicio de 10% + IVA. Te transferimos lo recaudado 48–72 h después de cada función, y te ayudamos a armar el evento y los posts con IA.
              </p>
            </FadeInSection>
  
            <FadeInSection direction="up" :delay="300">
              <div class="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 mb-12">
                <a href="/organizadores/registro" class="px-6 py-3 text-lg font-bold font-[Unbounded] border border-white rounded-lg hover:bg-white hover:text-black transition w-full sm:w-auto group">
                  Crear mi cuenta gratis
                  <ArrowRight class="ml-2 inline-block h-4 w-4 transition-transform group-hover:translate-x-1" />
                </a>
                <a href="https://wa.me/56982347140?text=Hola%2C%20quiero%20vender%20entradas%20con%20AI%20Tickets" target="_blank" rel="noopener noreferrer" class="px-6 py-3 text-lg font-[Prompt] text-white/90 underline underline-offset-4 hover:text-lime-400 transition w-full sm:w-auto">
                  Hablar por WhatsApp
                </a>
                <a href="/eventos/evento-demo-aitickets?utm_source=aitickets&utm_medium=organizadores&utm_campaign=demo" class="px-6 py-3 text-lg font-[Prompt] text-white/90 underline underline-offset-4 hover:text-lime-400 transition w-full sm:w-auto">
                  Ver evento demo
                </a>
              </div>
            </FadeInSection>
  
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
              <FadeInSection direction="up" :delay="400">
                <FeatureCard :icon="Calendar" title="Funciones múltiples" text="Una página de evento con todas tus fechas. Ideal para stand-up y teatro con temporada." />
              </FadeInSection>
              <FadeInSection direction="up" :delay="500">
                <FeatureCard :icon="Sparkles" title="Posts con IA" text="Genera publicaciones para Instagram y Facebook a partir de la info de tu evento." />
              </FadeInSection>
              <FadeInSection direction="up" :delay="600">
                <FeatureCard :icon="BarChart3" title="Sabe qué canal vende" text="Visitas, ventas y canal de origen (UTM) de cada evento en tu panel." />
              </FadeInSection>
            </div>
          </div>
        </div>
      </div>
    </section>
  </template>
  