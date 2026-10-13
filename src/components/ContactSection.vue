<script setup>
import { SALES_WHATSAPP_NUMBER, whatsappUrl } from "../lib/whatsapp.js";

const whatsappLink = whatsappUrl(SALES_WHATSAPP_NUMBER, "Hola, soy productor y quiero saber más sobre AI Tickets");
</script>

<template>
  <section class="w-full bg-gray-950 text-white px-6 py-20 flex flex-col items-center text-center">
    <h2 class="text-3xl sm:text-4xl font-bold font-['Unbounded'] mb-6">¿Tienes preguntas? 💬📲</h2>
    <p class="max-w-2xl text-lg text-gray-300 font-['Prompt'] mb-8">
      Escríbenos por WhatsApp y te ayudamos a armar tu primer evento. 0% de comisión para ti; el comprador paga un cargo por servicio de 8% + IVA.
    </p>
    <a :href="whatsappLink" target="_blank" rel="noopener noreferrer" class="px-6 py-3 text-lg font-bold font-['Unbounded'] bg-lime-400 text-black border border-black rounded-lg transition hover:bg-black hover:text-white">
      Escríbenos por WhatsApp
    </a>
  </section>
</template>
