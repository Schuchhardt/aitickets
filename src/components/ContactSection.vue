<script setup>
const whatsappLink = "https://wa.me/56982347140?text=Hola%2C%20quiero%20saber%20m%C3%A1s%20sobre%20AI%20Tickets";
</script>

<template>
  <section class="w-full bg-gray-950 text-white px-6 py-20 flex flex-col items-center text-center">
    <h2 class="text-3xl sm:text-4xl font-bold font-['Unbounded'] mb-6">¿Tienes preguntas? 💬📲</h2>
    <p class="max-w-2xl text-lg text-gray-300 font-['Prompt'] mb-8">
      Conversemos directamente por WhatsApp y te contamos cómo AI Tickets puede ayudarte a crecer tu comunidad y vender más entradas.
    </p>
    <a :href="whatsappLink" target="_blank" class="px-6 py-3 text-lg font-bold font-['Unbounded'] bg-lime-400 text-black border border-black rounded-lg transition hover:bg-black hover:text-white">
      Escríbenos por WhatsApp
    </a>
  </section>
</template>
