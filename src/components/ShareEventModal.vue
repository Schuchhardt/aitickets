<script setup>
import { defineProps, defineEmits, computed, ref } from "vue";
import { useGoogleAnalytics } from "../composables/useGoogleAnalytics.js";
import { showSuccess, showError } from "../lib/toastBus.js";

const props = defineProps({
  show: Boolean,
  event: Object,
  customUrl: String, // URL personalizada para compartir (nunca la del ticket/QR)
  customTitle: String, // Título personalizado para compartir
  customText: String // Texto personalizado para compartir
});

const emit = defineEmits(["close"]);
const { trackShare } = useGoogleAnalytics();

// 📌 URL para compartir: SIEMPRE la página pública del evento con ?ref=share.
// Nunca compartir /ticket/ ni /qr/ (cualquiera con el link podría usar la entrada).
const eventUrl = computed(() => {
  if (props.customUrl && !/\/(ticket|qr|order)\//.test(props.customUrl)) return props.customUrl;
  const origin = typeof window !== "undefined" ? window.location.origin : "https://aitickets.cl";
  if (!props.event?.slug) return `${origin}/eventos`;
  return `${origin}/eventos/${encodeURIComponent(props.event.slug)}?ref=share`;
});

// 📌 Título para compartir
const shareTitle = computed(() => {
  if (props.customTitle) return props.customTitle;
  return props.event?.name || 'Evento';
});

// 📌 Texto para compartir
const shareText = computed(() => {
  if (props.customText) return props.customText;
  return `¡Mira este evento! ${props.event?.name}`;
});

// 📌 Verificar si el navegador soporta Web Share API
const canShare = computed(() => typeof navigator !== "undefined" && !!navigator.share);

// 📌 Función para compartir nativo
const shareNative = async () => {
  if (navigator.share) {
    try {
      await navigator.share({
        title: shareTitle.value,
        text: shareText.value,
        url: eventUrl.value,
      });
      trackShare(props.event?.id, 'native');
    } catch (err) {
      console.error('Error al compartir:', err);
    }
  }
};

// 📌 Función para copiar al portapapeles
const copyToClipboard = async () => {
  try {
    await navigator.clipboard.writeText(eventUrl.value);
    trackShare(props.event?.id, 'copy_link');
    showSuccess("Enlace copiado al portapapeles");
  } catch (err) {
    console.error("Error al copiar el enlace:", err);
    showError("No se pudo copiar el enlace");
  }
};

// 📌 Funciones para tracking de compartir
const trackShare_ = (platform) => {
  trackShare(props.event?.id, platform);
};
</script>

<template>
  <div v-if="show" class="fixed inset-0 bg-black/50 flex justify-center items-center z-50" @click.self="emit('close')">
    <div class="bg-white p-6 rounded-lg shadow-lg w-80">
      <!-- 🔹 Título -->
      <h2 class="text-lg font-bold mb-4 font-['Unbounded']">Compartir {{ customTitle ? '' : 'evento' }}</h2>

      <!-- 🔹 Botones de compartir -->
      <div class="space-y-3">
        <!-- WhatsApp -->
        <a :href="`https://wa.me/?text=${encodeURIComponent(`${shareText} ${eventUrl}`)}`" 
          target="_blank" rel="noopener noreferrer" 
          @click="trackShare_('whatsapp')"
          class="flex items-center gap-2 w-full px-4 py-2 rounded-lg text-sm justify-center bg-green-500 text-white hover:bg-green-600 font-semibold">
          <img src="https://cdn.simpleicons.org/whatsapp/ffffff" alt="" loading="lazy" class="w-5 h-5" />
          WhatsApp
        </a>

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
        <a :href="`mailto:?subject=${encodeURIComponent(`Mira este evento: ${shareTitle}`)}&body=${encodeURIComponent(`${shareText}: ${eventUrl}`)}`" 
          @click="trackShare_('email')"
          class="flex items-center gap-2 w-full border px-4 py-2 rounded-lg text-sm hover:bg-gray-50 justify-center">
          <img src="https://cdn.simpleicons.org/gmail" alt="email" class="w-5 h-5" />
          Correo electrónico
        </a>

        <!-- SMS -->
        <a :href="`sms:?&body=${encodeURIComponent(`${shareText}: ${eventUrl}`)}`" 
          @click="trackShare_('sms')"
          class="flex items-center gap-2 w-full border px-4 py-2 rounded-lg text-sm hover:bg-gray-50 justify-center">
          <img src="https://cdn.simpleicons.org/googlemessages" alt="sms" class="w-5 h-5" />
          Mensajes
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
        <a :href="`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(eventUrl)}`" 
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
