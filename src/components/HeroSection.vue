<script setup>
import summitHero from "../images/summit.jpg";
</script>

<template>
  <section class="relative w-full min-h-screen flex items-center justify-center text-white text-center px-6 overflow-hidden">
    
    <!-- 🎨 Fondo difuminado SOLO en Hero -->
    <div class="absolute inset-0 bg-cover bg-center blur-background" :style="{ backgroundImage: `url(${summitHero.src})` }"></div>

    <div class="relative z-10 max-w-2xl">
      <h1 class="text-4xl font-bold sm:text-5xl font-['Unbounded']">
        La plataforma ideal para eventos de IA y tecnología
      </h1>
      <p class="mt-4 text-lg text-gray-300 font-['Prompt']">
        Conecta con la audiencia correcta y lleva tu evento tech al siguiente nivel con AI Tickets.
      </p>

      <!-- 🎟 Botones de acción -->
      <div class="mt-6 flex flex-col sm:flex-row justify-center gap-4">
        <!-- <a href="/register" class="px-6 py-3 text-lg font-bold font-['Unbounded'] bg-lime-400 text-black border border-black rounded-lg transition hover:bg-black hover:text-white">
          Crea tu Evento
        </a> -->
        <a href="/eventos" class="px-6 py-3 text-lg font-bold font-['Unbounded'] border border-white rounded-lg hover:bg-white hover:text-black transition">
          Descubrir Eventos
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 🎨 Ahora el fondo solo afecta al Hero */
.blur-background {
  filter: blur(10px);
  position: absolute;
  width: 100%;
  height: 100%;
}
</style>
