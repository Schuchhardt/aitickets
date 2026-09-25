<script setup>
import { PlayCircle } from 'lucide-vue-next';
import FadeInSection from './Hero/FadeInSection.vue';
</script>

<template>
  <section class="py-20 bg-gradient-to-b from-[#0a051e] to-black text-white font-[Prompt]">
    <div class="container mx-auto px-4 md:px-8">
      <div class="text-center mb-10">
        <FadeInSection>
          <span class="inline-flex items-center gap-2 text-lime-400 font-medium text-sm bg-lime-400/10 border border-lime-400/30 px-4 py-1 rounded-full">
            <PlayCircle class="h-4 w-4" />
            Míralo en acción
          </span>
        </FadeInSection>
        <FadeInSection :delay="100">
          <h2 class="text-3xl md:text-4xl font-bold mt-4 mb-4 font-[Unbounded]">
            De función floja a función agotada
          </h2>
        </FadeInSection>
        <FadeInSection :delay="200">
          <p class="text-white/70 max-w-2xl mx-auto">
            Asistente con IA que vende por chat, check-in QR en 2 segundos y un click para avisar a todos tus asistentes.
          </p>
        </FadeInSection>
      </div>

      <FadeInSection :delay="300">
        <div class="max-w-5xl mx-auto rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-lime-400/10 bg-black">
          <video
            class="w-full h-auto block aspect-video"
            src="/videos/aitickets-demo.mp4"
            poster="/videos/aitickets-demo-poster.jpg"
            controls
            autoplay
            muted
            loop
            playsinline
            preload="metadata"
            aria-label="Video de demostración de AI Tickets"
          ></video>
        </div>
      </FadeInSection>
    </div>
  </section>
</template>
