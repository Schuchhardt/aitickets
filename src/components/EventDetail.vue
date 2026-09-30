<script setup>
import { onMounted, computed } from "vue";
import { trackViewItem } from "../composables/useGoogleAnalytics.js";
import { eventBus } from "../utils/eventbus.js";
import EventHeader from "./EventHeader.vue";
import EventTabs from "./EventTabs.vue";
import EventActions from "./EventActions.vue";

const props = defineProps({
  event: Object,
  // Sitio de productor (/o/<slug> o dominio propio): sin el banner de adquisición de AI Tickets
  siteMode: { type: Boolean, default: false },
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
  autoOpenReservation();
});

// ?comprar=1 abre el modal de compra al cargar (lo usa el botón "Comprar" de los sitios con dominio
// propio, que envía al checkout en aitickets.cl). Solo si el evento está a la venta.
function autoOpenReservation() {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("comprar") !== "1") return;
    url.searchParams.delete("comprar");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    if (props.event?.sale_state !== "on_sale" || !(props.event?.tickets || []).length) return;
    eventBus.emit("assistant-hide");
    eventBus.emit("open-modal");
  } catch {
    /* URL no disponible */
  }
}
</script>

<template>
  <div class="max-w-6xl mx-auto px-6 lg:px-12 py-8 relative">
    <!-- Aviso de evento de demostración -->
    <div
      v-if="event.is_demo"
      class="mb-6 rounded-xl border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-900 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
      role="note"
    >
      <p>
        <strong>Evento de demostración.</strong>
        Puedes recorrer todo el flujo de compra, pero no se venden entradas reales ni se cobra nada.
      </p>
      <a
        href="/organizadores/registro?utm_source=aitickets&utm_medium=demo_event&utm_campaign=banner"
        class="shrink-0 font-semibold underline hover:no-underline"
      >Crea tu evento gratis →</a>
    </div>

    <!-- Header -->
    <EventHeader :event="event" />

    <!-- Contenedor de Tabs + Tarjeta de Reserva -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8 relative">
      <!-- Columna Derecha en Mobile (Botones arriba) -->
      <div class="lg:hidden relative z-10">
        <EventActions :event="event" :siteMode="siteMode" />
      </div>

      <!-- Columna Izquierda (Tabs) -->
      <EventTabs :event="event" />

      <!-- Columna Derecha (Botones en Desktop) -->
      <div class="hidden lg:block relative z-10">
        <EventActions :event="event" :siteMode="siteMode" />
      </div>
    </div>

    <!-- Banner de adquisición de productores (no en los sitios de productor) -->
    <div v-if="siteMode" class="mb-32 lg:mb-8"></div>
    <aside v-else class="mt-12 mb-32 lg:mb-8 border-t border-gray-200 pt-6 text-center font-['Prompt']">
      <a
        :href="producerBannerUrl"
        class="inline-flex flex-col sm:flex-row items-center gap-1 sm:gap-2 py-2 text-sm text-gray-600 hover:text-black transition-colors"
      >
        ¿Organizas eventos?
        <span class="font-semibold underline decoration-lime-400 decoration-2 underline-offset-4">
          Vende tus entradas con AI Tickets →
        </span>
      </a>
    </aside>
  </div>
</template>
