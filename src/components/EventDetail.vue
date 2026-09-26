<script setup>
import { onMounted, computed } from "vue";
import { trackViewItem } from "../composables/useGoogleAnalytics.js";
import EventHeader from "./EventHeader.vue";
import EventTabs from "./EventTabs.vue";
import EventActions from "./EventActions.vue";

const props = defineProps({
  event: Object,
});

const producerBannerUrl = computed(() => {
  const campaign = encodeURIComponent(props.event?.slug || "evento");
  return `/organizadores?utm_source=aitickets&utm_medium=event_footer&utm_campaign=${campaign}`;
});

onMounted(() => {
  if (props.event) {
    // Rastrear cuando alguien ve un evento (precio más bajo a la venta)
    const prices = (props.event.tickets || []).map((t) => Number(t.price) || 0);
    const minPrice = prices.length ? Math.min(...prices) : 0;
    trackViewItem(props.event.id, props.event.name, minPrice);
  }
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

    <!-- Banner de adquisición de productores -->
    <aside class="mt-12 mb-24 lg:mb-8 border-t border-gray-200 pt-6 text-center font-['Prompt']">
      <a
        :href="producerBannerUrl"
        class="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-black transition-colors"
      >
        ¿Organizas eventos?
        <span class="font-semibold underline decoration-lime-400 decoration-2 underline-offset-4">
          Vende tus entradas con AI Tickets →
        </span>
      </a>
    </aside>
  </div>
</template>
