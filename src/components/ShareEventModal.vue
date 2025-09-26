<script setup>
import { defineProps, defineEmits, computed } from "vue";
import { useGoogleAnalytics } from "../composables/useGoogleAnalytics.js";

const props = defineProps({
  show: Boolean,
  event: Object
});

const emit = defineEmits(["close"]);
const { trackShare } = useGoogleAnalytics();

// 📌 URL del evento (Asegúrate de cambiarlo según la URL real de tu sitio)
const eventUrl = computed(() => `${window.location.origin}/e-${props.event.slug}`);

// 📌 Función para copiar al portapapeles
const copyToClipboard = async () => {
  try {
    await navigator.clipboard.writeText(eventUrl.value);
    trackShare(props.event.id, 'copy_link');
    alert("Enlace copiado al portapapeles");
  } catch (err) {
    console.error("Error al copiar el enlace:", err);
  }
};

// 📌 Funciones para tracking de compartir
const trackWhatsAppShare = () => {
  trackShare(props.event.id, 'whatsapp');
};

const trackTwitterShare = () => {
  trackShare(props.event.id, 'twitter');
};
</script>

<template>
  <div v-if="show" class="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
    <div class="bg-white p-6 rounded-lg shadow-lg w-80">
      <!-- 🔹 Título -->
      <h2 class="text-lg font-bold mb-4 font-['Unbounded']">Compartir evento</h2>

      <!-- 🔹 Botones de compartir -->
      <div class="space-y-3">
        <a :href="`https://wa.me/?text=${encodeURIComponent(eventUrl)}`" target="_blank" @click="trackWhatsAppShare"
          class="block bg-green-500 text-white text-center py-2 rounded-lg hover:bg-green-600 transition">
          Compartir en WhatsApp
        </a>
        <a :href="`https://twitter.com/intent/tweet?text=${encodeURIComponent(event.name)}&url=${encodeURIComponent(eventUrl)}`"
          target="_blank" @click="trackTwitterShare"
          class="block bg-blue-500 text-white text-center py-2 rounded-lg hover:bg-blue-600 transition">
          Compartir en Twitter
        </a>
        <button aria-label="Copiar enlace" @click="copyToClipboard" class="block w-full bg-gray-200 text-gray-800 text-center py-2 rounded-lg hover:bg-gray-300 transition">
          Copiar enlace
        </button>
      </div>

      <!-- 🔹 Botón de cerrar -->
      <button aria-label="Cerrar" @click="emit('close')" class="mt-4 block w-full bg-red-500 text-white py-2 rounded-lg hover:bg-red-600 transition cursor-pointer">
        Cerrar
      </button>
    </div>
  </div>
</template>
