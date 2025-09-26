<script setup>
import { defineProps, defineEmits, computed, ref } from "vue";
import { useGoogleAnalytics } from "../composables/useGoogleAnalytics.js";

const props = defineProps({
  show: Boolean,
  event: Object
});

const emit = defineEmits(["close"]);
const { trackShare } = useGoogleAnalytics();

// 📌 URL del evento (Asegúrate de cambiarlo según la URL real de tu sitio)
const eventUrl = computed(() => `${window.location.origin}/eventos/${props.event.slug}`);

// 📌 Verificar si el navegador soporta Web Share API
const canShare = computed(() => navigator.share);

// 📌 Función para compartir nativo
const shareNative = async () => {
  if (navigator.share) {
    try {
      await navigator.share({
        title: props.event.name,
        text: `¡Mira este evento! ${props.event.name}`,
        url: eventUrl.value,
      });
      trackShare(props.event.id, 'native');
    } catch (err) {
      console.error('Error al compartir:', err);
    }
  }
};

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
const trackShare_ = (platform) => {
  trackShare(props.event.id, platform);
};
</script>

<template>
  <div v-if="show" class="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
    <div class="bg-white p-6 rounded-lg shadow-lg w-80">
      <!-- 🔹 Título -->
      <h2 class="text-lg font-bold mb-4 font-['Unbounded']">Compartir evento</h2>

      <!-- 🔹 Botones de compartir -->
      <div class="space-y-3">
        <!-- Native Share (si está disponible) -->
        <button v-if="canShare" @click="shareNative" 
          class="flex items-center gap-2 w-full border px-4 py-2 rounded-lg text-sm hover:bg-gray-50 justify-center">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
          </svg>
          Compartir
        </button>

        <!-- Copiar enlace -->
        <button @click="copyToClipboard" 
          class="flex items-center gap-2 w-full border px-4 py-2 rounded-lg text-sm hover:bg-gray-50 justify-center">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copiar enlace
        </button>

        <!-- Email -->
        <a :href="`mailto:?subject=Mira este evento: ${event.name}&body=¡Hola! Te comparto este evento que me parece interesante: ${eventUrl}`" 
          @click="trackShare_('email')"
          class="flex items-center gap-2 w-full border px-4 py-2 rounded-lg text-sm hover:bg-gray-50 justify-center">
          <img src="https://cdn.simpleicons.org/gmail" alt="email" class="w-5 h-5" />
          Correo electrónico
        </a>

        <!-- SMS -->
        <a :href="`sms:&body=¡Hola! Te comparto este evento: ${eventUrl}`" 
          @click="trackShare_('sms')"
          class="flex items-center gap-2 w-full border px-4 py-2 rounded-lg text-sm hover:bg-gray-50 justify-center">
          <img src="https://cdn.simpleicons.org/googlemessages" alt="sms" class="w-5 h-5" />
          Mensajes
        </a>

        <!-- WhatsApp -->
        <a :href="`https://wa.me/?text=${encodeURIComponent(`¡Hola! Te comparto este evento: ${event.name} ${eventUrl}`)}`" 
          target="_blank" rel="noopener noreferrer" 
          @click="trackShare_('whatsapp')"
          class="flex items-center gap-2 w-full border px-4 py-2 rounded-lg text-sm hover:bg-gray-50 justify-center">
          <img src="https://cdn.simpleicons.org/whatsapp" alt="whatsapp" class="w-5 h-5" />
          WhatsApp
        </a>

        <!-- Facebook -->
        <a :href="`https://facebook.com/sharer/sharer.php?u=${encodeURIComponent(eventUrl)}`" 
          target="_blank" rel="noopener noreferrer" 
          @click="trackShare_('facebook')"
          class="flex items-center gap-2 w-full border px-4 py-2 rounded-lg text-sm hover:bg-gray-50 justify-center">
          <img src="https://cdn.simpleicons.org/facebook" alt="facebook" class="w-5 h-5" />
          Facebook
        </a>

        <!-- X (Twitter) -->
        <a :href="`https://twitter.com/intent/tweet?text=${encodeURIComponent(`¡Mira este evento! ${event.name}`)}&url=${encodeURIComponent(eventUrl)}`" 
          target="_blank" rel="noopener noreferrer" 
          @click="trackShare_('twitter')"
          class="flex items-center gap-2 w-full border px-4 py-2 rounded-lg text-sm hover:bg-gray-50 justify-center">
          <img src="https://cdn.simpleicons.org/x" alt="twitter" class="w-5 h-5" />
          (X) Twitter
        </a>
      </div>

      <!-- 🔹 Botón de cerrar -->
      <button aria-label="Cerrar" @click="emit('close')" class="mt-4 block w-full bg-red-500 text-white py-2 rounded-lg hover:bg-red-600 transition cursor-pointer">
        Cerrar
      </button>
    </div>
  </div>
</template>
