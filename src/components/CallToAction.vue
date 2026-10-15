<template>
  <section class="py-20 bg-gradient-to-br from-black to-gray-900 text-white font-[Prompt]">
    <div class="container mx-auto px-4 md:px-8 text-center">
      <FadeInSection>
        <div class="inline-flex items-center justify-center mb-6">
          <span class="bg-lime-400/10 rounded-2xl sm:rounded-full px-4 py-1 flex items-center border border-lime-400/30">
            <Shield class="h-4 w-4 shrink-0 text-lime-400 mr-2" />
            <span class="text-lime-400 text-xs sm:text-sm font-medium">Sin mensualidad • Sin permanencia • Sin costos fijos</span>
          </span>
        </div>
      </FadeInSection>

      <FadeInSection :delay="100">
        <h2 class="text-3xl md:text-4xl lg:text-5xl font-bold mb-6 max-w-3xl mx-auto leading-tight font-[Unbounded]">
          ¿Cuándo es tu próxima función?
        </h2>
      </FadeInSection>

      <FadeInSection :delay="200">
        <p class="text-white/80 max-w-2xl mx-auto mb-10 text-lg">
          Publícala en AI Tickets, comparte un link por cada promotor y prepara el siguiente show sabiendo qué funcionó.
        </p>
      </FadeInSection>

      <FadeInSection :delay="300">
        <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            :href="publishUrl(campaign)"
            data-cta="publish"
            data-section="final_cta"
            class="group flex items-center justify-center gap-2 bg-lime-400 text-black font-bold py-4 px-8 rounded-full transition-all duration-300 hover:shadow-xl hover:shadow-lime-400/20 hover:-translate-y-0.5 font-[Unbounded]"
          >
            Publicar mi próxima función
            <ArrowRight class="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </a>
          <a
            :href="whatsappUrl()"
            data-cta="whatsapp"
            data-section="final_cta"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center justify-center gap-2 text-white border border-white/30 py-4 px-8 rounded-full font-medium transition-all duration-300 hover:bg-white/10"
          >
            <MessageCircle class="h-4 w-4" />
            Hablar por WhatsApp
          </a>
        </div>
      </FadeInSection>

      <FadeInSection :delay="400">
        <p class="mt-8 text-white/50 text-sm">
          ¿Prefieres verlo antes?
          <a :href="DEMO_CALL_URL" data-cta="demo_call" data-section="final_cta" target="_blank" rel="noopener noreferrer" class="underline hover:text-lime-400">Agenda una demo de 15 min</a>
          o <a :href="DEMO_EVENT_URL" data-cta="demo_event" data-section="final_cta" class="underline hover:text-lime-400">mira un evento de ejemplo</a>.
        </p>
      </FadeInSection>
    </div>
  </section>
</template>

<script setup>
import { Shield, ArrowRight, MessageCircle } from 'lucide-vue-next';
import FadeInSection from './Hero/FadeInSection.vue';
import { publishUrl, whatsappUrl, DEMO_CALL_URL, DEMO_EVENT_URL } from './landing/links.js';

defineProps({ campaign: { type: String, default: 'final_cta' } });
</script>
