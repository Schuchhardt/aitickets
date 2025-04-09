<template>
  <section class="py-20 bg-gradient-to-br from-black to-gray-900 text-white font-[Prompt]">
    <div class="container mx-auto px-4 md:px-8 text-center">
      <FadeInSection>
        <div class="inline-flex items-center justify-center mb-6">
          <span class="bg-white/10 backdrop-blur-sm rounded-full px-4 py-1 flex items-center">
            <Sparkles class="h-4 w-4 text-lime-400 mr-2" />
            <span class="text-white/90 text-sm font-medium">Tecnología de vanguardia</span>
          </span>
        </div>
      </FadeInSection>

      <FadeInSection :delay="100">
        <h2 class="text-3xl md:text-4xl lg:text-5xl font-bold mb-6 max-w-3xl mx-auto leading-tight font-[Unbounded]">
          Impulsa tus eventos con el poder de la inteligencia artificial
        </h2>
      </FadeInSection>

      <FadeInSection :delay="200">
        <p class="text-white/80 max-w-2xl mx-auto mb-10 text-lg">
          Únete a AI Tickets hoy y comienza a vender más entradas con menos esfuerzo. 
          Nuestra tecnología revolucionaria está cambiando la forma en que se gestionan los eventos.
        </p>
      </FadeInSection>

      <FadeInSection :delay="300">
        <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
          <!-- Botón principal -->
          <a
            href="/register"
            class="flex items-center justify-center gap-2 bg-white text-black font-bold py-3 px-6 rounded-full transition-all duration-300 hover:shadow-xl hover:-translate-y-0.5 active:scale-[0.97] font-[Unbounded]"
          >
            Comenzar ahora
            <ArrowRight class="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </a>

          <!-- Botón secundario -->
          <a
            :href="whatsappLink"
            target="_blank"
            class="flex items-center justify-center gap-2 bg-transparent text-white border border-white/30 py-3 px-6 rounded-full font-medium transition-all duration-300 hover:bg-white/10 hover:shadow-md active:scale-[0.97]"
          >
            <MessageCircle class="h-4 w-4" />
            Contactar a ventas
          </a>
        </div>
      </FadeInSection>
    </div>
  </section>
</template>

<script setup>
import { Sparkles, ArrowRight, MessageCircle } from 'lucide-vue-next';
import FadeInSection from './Hero/FadeInSection.vue';

const whatsappLink = "https://wa.me/56982347140?text=Hola%2C%20quiero%20saber%20m%C3%A1s%20sobre%20AI%20Tickets";
</script>
