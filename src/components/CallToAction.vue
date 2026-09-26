<template>
  <section class="py-20 bg-gradient-to-br from-black to-gray-900 text-white font-[Prompt]">
    <div class="container mx-auto px-4 md:px-8 text-center">
      <FadeInSection>
        <div class="inline-flex items-center justify-center mb-6">
          <span class="bg-lime-400/10 backdrop-blur-sm rounded-full px-4 py-1 flex items-center border border-lime-400/30">
            <Shield class="h-4 w-4 text-lime-400 mr-2" />
            <span class="text-lime-400 text-sm font-medium">Sin mensualidad • Sin permanencia • Sin costos fijos</span>
          </span>
        </div>
      </FadeInSection>

      <FadeInSection :delay="100">
        <h2 class="text-3xl md:text-4xl lg:text-5xl font-bold mb-6 max-w-3xl mx-auto leading-tight font-[Unbounded]">
          ¿Listo para llenar más funciones?
        </h2>
      </FadeInSection>

      <FadeInSection :delay="200">
        <p class="text-white/80 max-w-2xl mx-auto mb-6 text-lg">
          Crea tu cuenta gratis y publica tu primera función hoy. Te ayudamos a armar el evento
          y los posts con IA, y te transferimos lo recaudado 48–72 h después de cada función.
        </p>
      </FadeInSection>

      <!-- Garantías -->
      <FadeInSection :delay="250">
        <div class="flex flex-wrap justify-center gap-6 mb-10 text-sm text-white/70">
          <div class="flex items-center gap-2">
            <Gift class="h-4 w-4 text-lime-400" />
            <span>0% de comisión para ti</span>
          </div>
          <div class="flex items-center gap-2">
            <Wrench class="h-4 w-4 text-lime-400" />
            <span>Te ayudamos a armar tu evento</span>
          </div>
          <div class="flex items-center gap-2">
            <Clock class="h-4 w-4 text-lime-400" />
            <span>Pago 48–72 h después de cada función</span>
          </div>
        </div>
      </FadeInSection>

      <FadeInSection :delay="300">
        <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
          <!-- Botón principal -->
          <a
            href="/organizadores/registro"
            class="group flex items-center justify-center gap-2 bg-lime-400 text-black font-bold py-4 px-8 rounded-full transition-all duration-300 hover:shadow-xl hover:shadow-lime-400/20 hover:-translate-y-0.5 active:scale-[0.97] font-[Unbounded]"
          >
            Crear mi cuenta gratis
            <ArrowRight class="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </a>

          <!-- Botón secundario -->
          <a
            :href="whatsappLink"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center justify-center gap-2 bg-transparent text-white border border-white/30 py-4 px-8 rounded-full font-medium transition-all duration-300 hover:bg-white/10 hover:shadow-md active:scale-[0.97]"
          >
            <MessageCircle class="h-4 w-4" />
            Hablar por WhatsApp
          </a>
        </div>
      </FadeInSection>

      <FadeInSection :delay="400">
        <p class="mt-8 text-white/50 text-sm">
          0% de comisión para el productor. El comprador paga un cargo por servicio de 10%.
          ¿Prefieres verlo antes? <a href="https://calendar.app.google/CMt97vedNjzBaoEX7" target="_blank" rel="noopener noreferrer" class="underline hover:text-lime-400">Agenda una demo de 15 min</a>.
        </p>
      </FadeInSection>
    </div>
  </section>
</template>

<script setup>
import { Shield, ArrowRight, MessageCircle, Gift, Wrench, Clock } from 'lucide-vue-next';
import FadeInSection from './Hero/FadeInSection.vue';

const whatsappLink = "https://wa.me/56982347140?text=Hola%2C%20quiero%20vender%20entradas%20con%20AI%20Tickets";
</script>
