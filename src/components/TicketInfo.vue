<script setup>
import { ref, computed } from 'vue';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import TicketQR from "./TicketQR.vue";
import ShareEventModal from "./ShareEventModal.vue";
import { formatLocalDate, formatLocalTime } from "../utils/dateHelpers.js";

const props = defineProps({
  ticket: Object,
  event: Object,
});

const isDownloading = ref(false);
const showShareModal = ref(false);

// URL del ticket para compartir
const ticketUrl = computed(() => {
  if (typeof window === "undefined") return "";
  return window.location.href;
});

// Título personalizado para compartir
const shareTitle = computed(() => {
  return `Mi entrada para ${props.event?.name || 'el evento'}`;
});

// Texto personalizado para compartir
const shareText = computed(() => {
  return `¡Mira mi entrada para ${props.event?.name}! ${formattedDate(props.event)} a las ${formattedTime(props.event)}`;
});

// Formatear fecha del evento usando zona horaria local del usuario
const formattedDate = (event) => {
  if (!event.start_date) return "Fecha no disponible";
  return formatLocalDate(event.start_date, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
};

// Formatear hora del evento usando zona horaria local del usuario
const formattedTime = (event) => {
  if (!event.start_date) return "Hora no disponible";
  return formatLocalTime(event.start_date) + " hrs";
};

// Función para detectar si el navegador soporta descarga de archivos
const supportsDownload = () => {
  const a = document.createElement('a');
  return typeof a.download !== 'undefined';
};

// Abrir modal de compartir
const openShareModal = () => {
  showShareModal.value = true;
};

// Cerrar modal de compartir
const closeShareModal = () => {
  showShareModal.value = false;
};

// 👉 Función mejorada para descargar el ticket como PDF (optimizada para móvil)
const downloadAsPDF = async () => {
  if (isDownloading.value) return;
  
  try {
    isDownloading.value = true;
    
    // Verificar soporte del navegador
    if (!supportsDownload()) {
      console.warn('El navegador no soporta descargas');
      alert('Tu navegador no soporta la descarga de archivos. Por favor, usa otro navegador.');
      return;
    }
    
    const ticketEl = document.getElementById('ticket-container');
    if (!ticketEl) {
      throw new Error('No se encontró el contenedor del ticket');
    }

    // Esperar a que todas las fuentes e imágenes estén cargadas
    await document.fonts.ready;
    
    // Pausa más larga en móviles para asegurar el renderizado
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    await new Promise(resolve => setTimeout(resolve, isMobile ? 300 : 100));

    // Configuración optimizada según el dispositivo
    const scale = isMobile ? 1.5 : 2; // Menor escala en móviles para reducir memoria
    
    // Generar canvas con html2canvas (configuración optimizada para móviles y desktop)
    const canvas = await html2canvas(ticketEl, { 
      scale: scale,
      useCORS: false, // Cambiar a false para evitar problemas de CORS
      allowTaint: true, // Permitir taint para capturar todo el contenido
      backgroundColor: '#ffffff',
      logging: false, // Desactivar logs en producción
      imageTimeout: 0, // Sin timeout para imágenes
      removeContainer: true, // Limpiar después de capturar
      async: true,
      foreignObjectRendering: false, // Evitar problemas con SVG en Safari
      windowWidth: ticketEl.scrollWidth,
      windowHeight: ticketEl.scrollHeight,
      onclone: (clonedDoc) => {
        // Asegurar que el contenido clonado esté visible
        const clonedEl = clonedDoc.getElementById('ticket-container');
        if (clonedEl) {
          clonedEl.style.display = 'block';
          clonedEl.style.visibility = 'visible';
        }
      }
    });

    // Verificar que el canvas se generó correctamente
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      throw new Error('No se pudo generar el canvas correctamente');
    }

    // Crear PDF con jsPDF
    // Reducir calidad en móviles para archivos más pequeños
    const imageQuality = isMobile ? 0.8 : 1.0;
    const imgData = canvas.toDataURL('image/jpeg', imageQuality);
    
    // Verificar que la imagen se generó correctamente
    if (!imgData || imgData === 'data:,') {
      throw new Error('No se pudo convertir el canvas a imagen');
    }
    
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    // Calcular dimensiones para centrar en A4
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = canvas.width;
    const imgHeight = canvas.height;
    
    // Mantener proporción y ajustar al ancho de la página con margen
    const maxWidth = pdfWidth - 20; // 10mm de margen a cada lado
    const ratio = Math.min(maxWidth / (imgWidth * 0.264583), (pdfHeight - 40) / (imgHeight * 0.264583));
    const finalWidth = imgWidth * 0.264583 * ratio;
    const finalHeight = imgHeight * 0.264583 * ratio;
    
    // Centrar en la página
    const x = (pdfWidth - finalWidth) / 2;
    const y = 20; // Margen superior

    pdf.addImage(imgData, 'JPEG', x, y, finalWidth, finalHeight, undefined, 'FAST');
    
    // Generar nombre del archivo
    const eventName = props.event?.name || 'evento';
    const fileName = `ticket-${eventName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}.pdf`;
    
    // Descargar PDF (funciona tanto en desktop como en móvil)
    pdf.save(fileName);
    
    // En móviles, mostrar mensaje de éxito
    if (isMobile) {
      // Pequeño delay para que la descarga se inicie
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
  } catch (error) {
    console.error('Error detallado al generar PDF:', error);
    console.error('Error stack:', error.stack);
    
    // Mensaje de error más específico
    let errorMessage = 'Ocurrió un error al generar el PDF.';
    
    if (error.message.includes('canvas')) {
      errorMessage = 'No se pudo capturar el ticket. Por favor, intenta de nuevo.';
    } else if (error.message.includes('imagen')) {
      errorMessage = 'Error al procesar las imágenes del ticket. Por favor, intenta de nuevo.';
    } else if (error.message.includes('memory') || error.message.includes('quota')) {
      errorMessage = 'No hay suficiente memoria disponible. Intenta cerrar otras pestañas.';
    }
    
    alert(errorMessage + ' Si el problema persiste, intenta recargar la página.');
  } finally {
    isDownloading.value = false;
  }
};
</script>

<template>
  <div>
    <div id="ticket-container" class="bg-white p-6 rounded-lg shadow-lg w-full max-w-md text-center mx-auto lg:col-span-1">
      <div v-if="ticket.qr_code" class="mt-2 flex flex-col items-center">
        <TicketQR :code="ticket.qr_code" client:idle />
        <p class="text-gray-500 text-sm mt-2">Muestra este código al ingresar</p>
      </div>
      <h2 class="text-3xl font-bold mb-4 font-[Unbounded]">{{ event.name }}</h2>
      <p class="text-gray-600 font-bold font-[Prompt]">{{ ticket.ticket_name || ticket.name }}</p>
      <p class="text-gray-500 font-[Prompt]">{{ formattedDate(event) }}</p>
      <p class="text-gray-500 font-[Prompt]">{{ formattedTime(event) }}</p>
      
      <!-- Dirección del evento -->
      <div class="mt-3 text-gray-500 font-[Prompt] text-sm">
        <div v-if="event.secret_location" class="space-y-1">
          <p class="font-semibold">📍 {{ event.secret_location }}</p>
        </div>
        <p v-else-if="event.address" class="font-semibold">📍 {{ event.address }}</p>
        <p v-else class="text-gray-400">📍 Dirección por confirmar</p>
      </div>

      <!-- <a :href="ticket.pdf_url" v download="ticket.pdf" class="block bg-lime-500 text-white text-center py-2 rounded-lg mt-4 hover:bg-lime-600 transition">
        Descargar PDF oficial
      </a> -->
    </div>

    <div class="mt-4 flex gap-2">
      <!-- Botón principal de compartir entrada -->
      <button
        aria-label="Compartir entrada"
        @click="openShareModal"
        :disabled="isDownloading"
        class="flex-1 bg-lime-500 font-[Unbounded] text-white text-center py-2 rounded-lg hover:bg-lime-600 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z"></path>
        </svg>
        Compartir Entrada
      </button>
      
      <!-- Botón PDF (solo icono) -->
      <button
        aria-label="Descargar ticket como PDF"
        @click="downloadAsPDF"
        :disabled="isDownloading"
        class="bg-gray-700 text-white px-4 py-2 rounded-lg hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
        title="Descargar PDF"
      >
        <svg v-if="isDownloading" class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
        </svg>
      </button>
    </div>

    <!-- Modal de compartir -->
    <ShareEventModal 
      :show="showShareModal" 
      :event="event"
      :customUrl="ticketUrl"
      :customTitle="shareTitle"
      :customText="shareText"
      @close="closeShareModal"
      client:only
    />
  </div>
</template>

