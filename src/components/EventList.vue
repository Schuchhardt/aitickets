<script setup>
import { defineProps } from "vue";
import EventCard from "./EventCard.vue";

// Recibe los eventos como `props` desde `index.astro`
const props = defineProps({
  events: Array
});
</script>

<template>
  <section id="events" class="container mt-10 mx-auto px-6 py-10">
    <h2 class="text-3xl font-bold text-center font-['Unbounded'] mb-6">
      Eventos Destacados
    </h2>
    
    <p v-if="props.events.length === 0" data-testid="event-list-empty" class="text-center text-gray-500">
      No hay eventos disponibles en este momento.
    </p>

    <div v-else data-testid="event-list" class="event-grid">
      <EventCard v-for="event in props.events" :key="event.id" :event="event" />
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
