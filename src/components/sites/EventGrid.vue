<script setup>
// Grilla de próximos eventos del sitio. Los enlaces usan la base del sitio ("" o "/o/<slug>").
import { formatEventDateRange } from "../../utils/dateHelpers.js";

defineProps({
  events: { type: Array, required: false }, // SiteEventCard[]
  base: { type: String, default: "" },
  variant: { type: String, default: "card" }, // card | list | poster
  emptyText: { type: String, default: "Pronto anunciaremos nuevos eventos." },
});
</script>

<template>
  <div data-testid="site-event-grid">
    <p v-if="!events || !events.length" class="opacity-70 py-8">{{ emptyText }}</p>

    <!-- Lista (minimal) -->
    <ul v-else-if="variant === 'list'" class="divide-y divide-current/10 border-y border-current/10">
      <li v-for="event in events" :key="event.id">
        <a :href="`${base}/eventos/${event.slug}`" class="flex items-center gap-4 py-5 group">
          <img
            v-if="event.image_url"
            :src="event.image_url"
            :alt="event.name"
            class="w-20 h-20 rounded-lg object-cover shrink-0"
            loading="lazy"
            decoding="async"
            width="80"
            height="80"
          />
          <div class="min-w-0 flex-1">
            <p class="text-sm opacity-70">{{ formatEventDateRange(event) }}</p>
            <h3 class="text-lg font-semibold group-hover:underline truncate">{{ event.name }}</h3>
            <p v-if="event.location" class="text-sm opacity-70 truncate">{{ event.location }}</p>
          </div>
          <span class="shrink-0 text-sm font-semibold underline underline-offset-4">Entradas</span>
        </a>
      </li>
    </ul>

    <!-- Tarjetas / pósters -->
    <div v-else class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      <a
        v-for="(event, i) in events"
        :key="event.id"
        :href="`${base}/eventos/${event.slug}`"
        class="group block overflow-hidden transition-transform duration-200 hover:-translate-y-1"
        :class="variant === 'poster' ? 'rounded-none' : 'rounded-2xl shadow-md bg-white/5'"
      >
        <div class="relative">
          <img
            v-if="event.image_url"
            :src="event.image_url"
            :alt="event.name"
            class="w-full object-cover"
            :class="variant === 'poster' ? 'aspect-[3/4]' : 'h-52'"
            :loading="i < 3 ? 'eager' : 'lazy'"
            decoding="async"
          />
          <div v-else class="w-full h-52 bg-[var(--site-primary)] opacity-80"></div>
          <span
            v-if="variant === 'poster'"
            class="absolute bottom-3 left-3 bg-[var(--site-accent)] text-black text-xs font-bold px-2 py-1 uppercase"
          >{{ formatEventDateRange(event) }}</span>
        </div>
        <div class="p-4">
          <h3 class="text-lg font-bold leading-tight group-hover:underline">{{ event.name }}</h3>
          <p v-if="variant !== 'poster'" class="text-sm opacity-75 mt-2">{{ formatEventDateRange(event) }}</p>
          <p v-if="event.location" class="text-sm opacity-75 mt-1">{{ event.location }}</p>
          <span
            class="inline-block mt-4 px-4 py-2 text-sm font-bold rounded-full bg-[var(--site-accent)] text-black"
          >Comprar entradas</span>
        </div>
      </a>
    </div>
  </div>
</template>
