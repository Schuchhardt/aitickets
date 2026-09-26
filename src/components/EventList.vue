<script setup>
import { computed } from "vue";
import EventCard from "./EventCard.vue";

// Recibe los eventos (ya filtrados: publicados, públicos y próximos) desde `eventos/index.astro`
const props = defineProps({
  events: Array,
});

const eventList = computed(() => props.events || []);
</script>

<template>
  <section id="events" class="container mt-10 mx-auto px-6 py-10">
    <h1 class="text-3xl font-bold text-center font-['Unbounded'] mb-6">
      Próximos eventos
    </h1>

    <!-- Estado vacío: no mostrar eventos vencidos como "destacados" -->
    <div v-if="eventList.length === 0" class="max-w-xl mx-auto text-center font-['Prompt'] py-10">
      <p class="text-gray-600 text-lg">
        No hay eventos a la venta en este momento. ¡Vuelve pronto!
      </p>
      <div class="mt-8 bg-gray-50 border border-gray-200 rounded-xl p-6">
        <p class="text-gray-900 font-semibold font-['Unbounded']">¿Organizas eventos?</p>
        <p class="text-gray-600 mt-2">
          Publica tu evento y vende entradas con 0% de comisión para el productor.
        </p>
        <a
          href="/organizadores?utm_source=aitickets&utm_medium=eventos_empty&utm_campaign=listado"
          class="inline-block mt-4 px-5 py-2 text-base font-bold text-black bg-lime-400 rounded-full transition hover:bg-lime-500 font-['Unbounded']"
        >
          Vende tus entradas con AI Tickets
        </a>
        <a
          href="/eventos/evento-demo-aitickets?utm_source=aitickets&utm_medium=eventos_empty&utm_campaign=demo"
          class="block mt-3 text-sm text-gray-700 underline underline-offset-4 hover:text-black"
        >
          Ver un evento de demostración
        </a>
      </div>
    </div>

    <div v-else class="event-grid">
      <EventCard
        v-for="(event, index) in eventList"
        :key="event.id"
        :event="event"
        :priority="index < 3"
      />
    </div>
  </section>
</template>

<style scoped>
.event-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 24px;
  padding: 20px;
}
</style>
