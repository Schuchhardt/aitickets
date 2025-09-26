<script setup>
import EventHeader from "./EventHeader.vue";
import EventTabs from "./EventTabs.vue";
import EventActions from "./EventActions.vue";

defineProps({
  event: Object,
});
</script>

<template>
  <div class="max-w-6xl mx-auto px-6 lg:px-12 py-8 relative">
    <!-- Header -->
    <EventHeader :event="event" />

    <!-- Contenedor de Tabs + Tarjeta de Reserva -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8 relative">
      <!-- Columna Derecha en Mobile (Botones arriba) -->
      <div class="lg:hidden relative z-10">
        <EventActions :event="event" />
      </div>

      <!-- Columna Izquierda (Tabs) -->
      <EventTabs :event="event" />

      <!-- Columna Derecha (Botones en Desktop) -->
      <div class="hidden lg:block relative z-10">
        <EventActions :event="event" />
      </div>
    </div>
  </div>
</template>
