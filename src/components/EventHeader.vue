<script setup>
import iconCalendarLight from "../images/icon-calendar-light.png";
import iconPinLight from "../images/icon-pin-light.png";
import iconCalendarDark from "../images/icon-calendar-dark.png";
import iconPinDark from "../images/icon-pin-dark.png";
import { formatEventDateRange } from "../utils/dateHelpers.js";

import { computed } from "vue";

const props = defineProps({
  event: Object,
});

// title y name suelen ser iguales (el dashboard guarda ambos): mostrar title solo si aporta algo
const normalize = (v) => String(v || "").trim().toLowerCase();
const showTitle = computed(() => !!normalize(props.event?.title) && normalize(props.event?.title) !== normalize(props.event?.name));
</script>

<template>
  <div v-if="event">
    <!-- Imagen con degradado en desktop y sin degradado en mobile -->
    <div class="relative w-full rounded-xl overflow-hidden">
      <img :src="event.image_url" :alt="event.name" class="w-full h-80 object-cover lg:h-[400px]" fetchpriority="high" loading="eager" decoding="async" width="1200" height="400" />
      <div class="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent hidden lg:block"></div>

      <!-- Texto sobre la imagen en desktop -->
      <div class="absolute bottom-6 left-6 text-white hidden lg:block font-['Prompt']">
        <span v-if="showTitle" class="uppercase text-xs font-medium tracking-wide opacity-80">{{ event.title }}</span>
        <h1 class="text-3xl font-bold font-['Unbounded']">{{ event.name }}</h1>
        <div class="flex flex-wrap items-center text-sm mt-2 opacity-90 gap-x-4 gap-y-1">
          <!-- Fecha -->
          <div class="flex items-start flex-wrap">
            <img :src="iconCalendarLight.src" alt="" class="w-5 h-5 mr-1.5 flex-shrink-0" />
            <span class="leading-tight">{{ formatEventDateRange(event) }}</span>
          </div>
          <!-- Ubicación -->
          <div class="flex items-center">
            <img :src="iconPinLight.src" alt="" class="w-5 h-5 mr-1.5 flex-shrink-0" />
            <span>{{ event.location }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Texto debajo de la imagen en mobile -->
    <div class="lg:hidden text-center mt-4 font-['Prompt']">
      <span v-if="showTitle" class="uppercase text-xs font-medium tracking-wide text-gray-600">{{ event.title }}</span>
      <!-- Un solo h1 por página (el de desktop); en mobile se repite el nombre como texto -->
      <p class="text-2xl font-bold text-gray-900 font-['Unbounded']">{{ event.name }}</p>
      
      <div class="flex flex-col items-center text-gray-600 text-sm mt-2 space-y-2">
        <!-- Fecha -->
        <div class="flex items-start text-center">
          <img :src="iconCalendarDark.src" alt="" class="w-5 h-5 mr-2 mt-1" />
          <span class="block">{{ formatEventDateRange(event) }}</span>
        </div>
        <!-- Ubicación -->
        <div class="flex items-start text-center">
          <img :src="iconPinDark.src" alt="" class="w-5 h-5 mr-2 mt-1" />
          <span class="block">{{ event.location }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
