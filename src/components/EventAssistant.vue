<script setup>
import { ref, onMounted, nextTick, defineProps} from "vue";
import { marked } from "marked"; 
import DOMPurify from "dompurify";
import { eventBus } from '../utils/eventbus.js';
import { useGoogleAnalytics } from "../composables/useGoogleAnalytics.js";
import { formatLocalTime, formatLocalDate } from "../utils/dateHelpers.js";
import IconChat from "../images/icon-chat.png"; 
import IconArrowGreen from "../images/icon-arrow-green.png"; 

const props = defineProps({
  event: Object,
});
const assistantURL = import.meta.env.PUBLIC_SERVERLESS_URL;
const apiSecret = import.meta.env.PUBLIC_API_SECRET;
const { trackAIAssistant } = useGoogleAnalytics();

const isOpen = ref(false);
const messages = ref([
  { role: "assistant", text: "¿Te ayudo a conseguir tu ticket en segundos? 😎", time: formatLocalTime(new Date()) }
]);
const userMessage = ref("");
const showSuggestedReplies = ref(true);
const chatContainer = ref(null);
const isLoading = ref(false);

// Función para hacer scroll automático
const scrollToBottom = () => {
  nextTick(() => {
    if (chatContainer.value) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
    }
  });
};

// Función para convertir Markdown a HTML y sanitizarlo
const renderMarkdown = (text) => {
  return DOMPurify.sanitize(marked(text)); // Convierte a HTML y sanitiza
};

// emitir un evento para abrir el modal de reserva y llenar los datos con los properties
const fillForm = (properties) => {
  // Emitir un evento para abrir el modal de reserva
  // Llenar los datos del formulario con los properties
  console.log("Llenar formulario con los datos: ", properties);
  
  eventBus.emit('open-modal');
  setTimeout(() => {
    console.log("Llenar ticket: ", properties);
    eventBus.emit('ticket-selection', properties);
  }, 2000);
  setTimeout(() => {
    console.log("Presiona siguiente: ");
    eventBus.emit('proceed-to-next-step');
  }, 4000);
  setTimeout(() => {
    console.log("Llenar info: ", properties);
    eventBus.emit('fill-buyer-info', properties);
  }, 5000);
};

const sendMessage = async (message) => {
  if (!message.trim()) return;

  // Track AI assistant usage
  trackAIAssistant(props.event.id, message);

  messages.value.push({ role: "user", text: message });
  showSuggestedReplies.value = false;
  scrollToBottom();
  isLoading.value = true;

  const assistantMessage = { role: "assistant", text: "" };
  messages.value.push(assistantMessage);

  // Mensaje oculto con los detalles del evento (NO se muestra en la UI)
  const eventDetailsMessage = {
    role: "system",
    text: `Detalles del evento:
    - ID Evento: ${props.event.id}
    - Nombre: ${props.event.name}
    - Descripción: ${props.event.description}
    - Fecha: ${formatLocalDate(props.event.start_date, { weekday: "long", day: "numeric", month: "long" })} - ${formatLocalDate(props.event.end_date, { weekday: "long", day: "numeric", month: "long" })}
    - Ubicación: ${props.event.location}
    - Preguntas frecuentes: ${props.event.faqs.map(faq => `• ${faq.question}: ${faq.answer}`).join("\n")}
    - Precios de las entradas:
      ${props.event.tickets.map(ticket => `•Ticket ID:${ticket.id} Tipo de entrada: ${ticket.ticket_name}: Precio $${ticket.price} Cantidad maxima por usuario: ${ticket.max_quantity}`).join("\n")}
    `,
  };

  userMessage.value = "";
  try {
    const response = await fetch(assistantURL + '/ai-assistant', {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-secret": apiSecret},
      body: JSON.stringify({ messages: [eventDetailsMessage, ...messages.value] }),
    });

    if (!response.ok) throw new Error("Error en la respuesta del servidor");

    // Leer la respuesta completa de una vez
    const responseData = await response.json();

    if (responseData.function_calling?.called) {
      const { name, properties } = responseData.function_calling;

      // Ejecutas en frontend la lógica asociada (ej: rellenar formulario o actualizar selección de entradas)
      if (name === 'fill_buyer_information') {
        fillForm(properties);
      }

      // ✅ Avisas al bot que ya se ejecutó como mensaje "system"
      messages.value.push({
        role: "system",
        text: `La función ${name} fue ejecutada correctamente en el cliente con los siguientes datos: ${JSON.stringify(properties)}`
      });

      // (Opcional) También puedes mostrar al usuario algo tipo:
      messages.value.push({
        role: "assistant",
        text: `✅ Ya prellené esa información por ti. ¿Quieres continuar?`
      });
    } else {
      // Asignar el texto directamente sin procesamiento por partes
      assistantMessage.text = responseData.message;
    }

  } catch (error) {
    console.log(error)
    assistantMessage.text = "Lo siento, hubo un error. Inténtalo de nuevo más tarde.";
  } finally {
    isLoading.value = false;
    scrollToBottom();
  }

};

// Obtener la fecha actual
const currentDate = formatLocalDate(new Date(), {
  weekday: "long",
  day: "numeric",
  month: "long"
});

onMounted(scrollToBottom);
</script>

<template>
  <div>
    <!-- Overlay en mobile -->
    <div 
      v-if="isOpen" 
      class="fixed inset-0 bg-black opacity-50 z-40 md:hidden"
      @click="isOpen = false">
    </div>

    <!-- Botón flotante -->
    <div v-if="!isOpen" class="assistant-button flex flex-col items-center">
      <span class="bg-gray-800 text-white text-xs px-2 py-1 rounded-md mb-2 opacity-100 transition font-[Prompt]">
        Asistente AI
      </span>
      <button 
        @click="isOpen = true" 
        aria-label="Abrir asistente"
        class="w-16 h-16 rounded-full cursor-pointer shadow-lg bg-cover bg-center bg-no-repeat transition hover:opacity-80 relative z-50 pointer-events-auto"
        :style="{ backgroundImage: `url(${IconChat.src})` }">
      </button>
    </div>

    <!-- Panel del chat -->
    <div v-if="isOpen" 
      class="assistant-chat fixed bottom-0 md:bottom-20 bg-white shadow-xl rounded-t-lg md:rounded-lg max-h-[500px] md:max-h-[600px] flex flex-col overflow-hidden border border-gray-200 z-50 w-full md:w-96">
      
      <!-- Header -->
      <div class="bg-white text-gray-900 p-4 font-semibold flex justify-between font-[Unbounded] border-b">
        <span>AI Tickets</span>
        <button @click="isOpen = false" aria-label="Cerrar asistente" class="cursor-pointer text-gray-400 hover:text-black text-xl">×</button>
      </div>

      <!-- Mensajes -->
      <div ref="chatContainer" class="chat-container-list p-4 flex-1 overflow-y-auto space-y-3 text-sm font-[Prompt]">
        <p class="text-gray-400 text-xs text-center">{{ currentDate }}</p>

        <div v-for="(msg, index) in messages" :key="index" class="flex items-start space-x-2"
          :class="msg.role === 'user' ? 'justify-end' : 'justify-start'">
          <img v-if="msg.role === 'assistant'" :src="IconChat.src" alt="AI" class="w-8 h-8 rounded-full" />
          
          <div v-if="msg.role === 'assistant'" class="bg-gray-200 text-black p-3 rounded-lg max-w-[80%] markdown-content">
            <span v-html="renderMarkdown(msg.text)"></span> 

            <!-- "Escribiendo..." solo en el último mensaje del asistente cuando está cargando -->
            <span v-if="isLoading && index === messages.length - 1" class="text-gray-500 ml-2 italic">Escribiendo...</span>
          </div>

          <div v-if="msg.role === 'user'" class="bg-black text-white p-3 rounded-lg max-w-fit ml-auto">
            {{ msg.text }}
          </div>
        </div>

        <!-- Respuestas sugeridas -->
        <div v-if="showSuggestedReplies" class="mt-2 flex flex-wrap gap-2">
          <button @click="sendMessage('Sí, por favor 🙏')" class="border cursor-pointer border-gray-300 text-black px-4 py-2 rounded-lg text-sm font-[Prompt]">
            Sí, por favor 🙏
          </button>
          <button @click="sendMessage('No, gracias 👌')" class="border cursor-pointer border-gray-300 text-black px-4 py-2 rounded-lg text-sm font-[Prompt]">
            No, gracias 👌
          </button>
        </div>

      </div>

      <!-- Input -->
      <div class="p-4 border-t flex items-center">
        <input 
          v-model="userMessage" 
          @keyup.enter="sendMessage(userMessage)"
          placeholder="Escribe aquí"
          class="flex-1 p-3 border rounded-lg text-sm font-[Prompt] bg-gray-100 outline-none" />
        <button aria-label="Enviar mensaje" @click="sendMessage(userMessage)" class="ml-2 w-10 h-10 bg-cover bg-center cursor-pointer"
          :style="{ backgroundImage: `url(${IconArrowGreen.src})` }">
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Posición del botón de asistencia */
.assistant-button {
  position: fixed;
  top: 70%;
  right: 1rem;
  transform: translateY(-50%);
  z-index: 50;
}

/* Estilos del chat */
.assistant-chat {
  width: 24rem; /* 384px */
  min-height: 250px; /* Tamaño mínimo del chat */
  right: 1rem;
}

.chat-container-list{
  min-height: 300px;
}

/* En mobile, ocupar todo el ancho */
@media (max-width: 768px) {
  .assistant-chat {
    width: 100%;
    left: 0;
    right: 0;
    bottom: 0;
  }
  .assistant-button {
    right: 0.5rem;
  }
}

/* Asegurar que en desktop tenga más z-index que los tabs */
@media (min-width: 1024px) {
  .assistant-button {
    right: 2rem;
  }
}

.markdown-content {
  font-family: "Prompt", sans-serif;
}

.markdown-content strong {
  font-weight: bold;
  color: black;
}

.markdown-content em {
  font-style: italic;
}

.markdown-content ul {
  list-style-type: disc;
  padding-left: 20px;
}

.markdown-content ol {
  list-style-type: decimal;
  padding-left: 20px;
}

.markdown-content li {
  margin-bottom: 4px;
}

.markdown-content p {
  margin-bottom: 8px;
}

</style>
