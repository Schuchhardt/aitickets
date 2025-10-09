<script setup>
import { ref, computed } from 'vue';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import TicketQR from "./TicketQR.vue";
import ShareEventModal from "./ShareEventModal.vue";
import { formatLocalDate, formatLocalTime } from "../utils/dateHelpers.js";
import { showSuccess, showError } from "../lib/toastBus.js";

const props = defineProps({
  ticket: Object,
  event: Object,
});

const isDownloading = ref(false);
const showShareModal = ref(false);

// URL del ticket para compartir
const ticketUrl = computed(() => {
  
  // Obtener el ID del ticket - puede venir como 'id' o como parte del objeto ticket
  const ticketId = props.ticket?.id || props.ticket?.internal_id;
  
  if (!ticketId) {
    console.warn('No se encontró ID del ticket');
    return window.location.href;
  }
  
  if (typeof window === "undefined") return "";
  // Construir la URL del ticket usando el origin actual y el ID del ticket
  const origin = window.location.origin;
  return `${origin}/ticket/${ticketId}`;
});

// Título personalizado para compartir
const shareTitle = computed(() => {
  return `La entrada para ${props.event?.name || 'el evento'}`;
});

// Texto personalizado para compartir
const shareText = computed(() => {
  return `¡Mira la entrada para ${props.event?.name}! ${formattedDate(props.event)} a las ${formattedTime(props.event)}`;
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
      showError('Tu navegador no soporta la descarga de archivos. Por favor, usa otro navegador.');
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
    await new Promise(resolve => setTimeout(resolve, isMobile ? 500 : 200));

    // Configuración optimizada según el dispositivo
    const scale = isMobile ? 1.5 : 2;
    
    // 🔧 SOLUCIÓN RADICAL: Forzar todos los colores a valores RGB estáticos conocidos
    const clonedTicket = ticketEl.cloneNode(true);
    clonedTicket.id = 'ticket-container-temp-clone';
    clonedTicket.style.position = 'absolute';
    clonedTicket.style.left = '-9999px';
    clonedTicket.style.top = '0';
    clonedTicket.style.visibility = 'visible';
    document.body.appendChild(clonedTicket);
    
    // Función para reemplazar estilos problemáticos
    const sanitizeElement = (el) => {
      // Obtener las clases del elemento
      const classes = Array.from(el.classList || []);
      
      // Aplicar colores directamente basados en las clases
      classes.forEach(className => {
        // Background colors
        if (className.includes('bg-white')) {
          el.style.backgroundColor = 'rgb(255, 255, 255)';
        } else if (className.includes('bg-gray')) {
          el.style.backgroundColor = 'rgb(243, 244, 246)';
        } else if (className.includes('bg-lime')) {
          el.style.backgroundColor = 'rgb(132, 204, 22)';
        }
        
        // Text colors
        if (className.includes('text-gray-500')) {
          el.style.color = 'rgb(107, 114, 128)';
        } else if (className.includes('text-gray-600')) {
          el.style.color = 'rgb(75, 85, 99)';
        } else if (className.includes('text-gray-700')) {
          el.style.color = 'rgb(55, 65, 81)';
        } else if (className.includes('text-gray-400')) {
          el.style.color = 'rgb(156, 163, 175)';
        } else if (className.includes('text-white')) {
          el.style.color = 'rgb(255, 255, 255)';
        } else if (className.includes('text-black')) {
          el.style.color = 'rgb(0, 0, 0)';
        }
      });
      
      // Copiar estilos de layout y tipografía (sin colores)
      try {
        const computed = window.getComputedStyle(el);
        el.style.fontSize = computed.fontSize;
        el.style.fontFamily = computed.fontFamily;
        el.style.fontWeight = computed.fontWeight;
        el.style.padding = computed.padding;
        el.style.margin = computed.margin;
        el.style.borderRadius = computed.borderRadius;
        el.style.textAlign = computed.textAlign;
        el.style.display = computed.display;
        
        if (computed.display.includes('flex')) {
          el.style.flexDirection = computed.flexDirection;
          el.style.alignItems = computed.alignItems;
          el.style.justifyContent = computed.justifyContent;
          el.style.gap = computed.gap;
        }
      } catch (err) {
        console.warn('Error copiando estilos:', err);
      }
      
      // Remover clases para evitar que Tailwind las procese
      el.className = '';
    };
    
    // Aplicar sanitización a todos los elementos
    const allElements = [clonedTicket, ...clonedTicket.querySelectorAll('*')];
    allElements.forEach(el => {
      try {
        sanitizeElement(el);
      } catch (err) {
        console.warn('Error sanitizando elemento:', err);
      }
    });
    
    // Forzar fondo blanco al contenedor principal
    clonedTicket.style.backgroundColor = 'rgb(255, 255, 255)';
    
    // Esperar a que se apliquen todos los cambios
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Configuración simplificada de html2canvas
    const html2canvasOptions = { 
      scale: scale,
      useCORS: false,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      imageTimeout: 15000,
      async: true,
      foreignObjectRendering: false
    };
    
    // Generar canvas con el elemento clonado (ya sin oklch)
    const canvas = await html2canvas(clonedTicket, html2canvasOptions);
    
    // Limpiar el clon temporal
    document.body.removeChild(clonedTicket);

    // Verificar que el canvas se generó correctamente
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      throw new Error('Canvas generado con dimensiones inválidas');
    }

    // Crear imagen desde canvas - intentar PNG primero
    let imgData;
    let imageFormat = 'PNG';
    
    try {
      imgData = canvas.toDataURL('image/png', 1.0);
    } catch (pngError) {
      console.warn('Fallback a JPEG:', pngError);
      imgData = canvas.toDataURL('image/jpeg', 0.95);
      imageFormat = 'JPEG';
    }
    
    // Verificar que la imagen se generó correctamente
    if (!imgData || imgData === 'data:,' || imgData.length < 100) {
      throw new Error('No se pudo convertir el canvas a imagen válida');
    }
    
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    // Obtener nombre del evento y ticket ID
    const eventName = props.event?.name || 'Evento';
    const ticketId = props.ticket?.id || props.ticket?.internal_id || '';
    
    // Agregar título del evento al PDF
    pdf.setFontSize(18);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(0, 0, 0);
    pdf.text(eventName, pdf.internal.pageSize.getWidth() / 2, 12, { align: 'center' });
    
    // Agregar ticket ID si existe
    if (ticketId) {
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(100, 100, 100);
      pdf.text(`Ticket ID: ${ticketId}`, pdf.internal.pageSize.getWidth() / 2, 19, { align: 'center' });
    }
    
    // Calcular dimensiones para centrar en A4 (ajustando por el título)
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = canvas.width;
    const imgHeight = canvas.height;
    
    // Mantener proporción y ajustar al ancho de la página con margen
    const maxWidth = pdfWidth - 20;
    const maxHeight = pdfHeight - 50; // Más margen para el título
    const ratio = Math.min(
      maxWidth / (imgWidth * 0.264583), 
      maxHeight / (imgHeight * 0.264583)
    );
    const finalWidth = imgWidth * 0.264583 * ratio;
    const finalHeight = imgHeight * 0.264583 * ratio;
    
    // Centrar en la página (más abajo por el título)
    const x = (pdfWidth - finalWidth) / 2;
    const y = 25; // Más abajo para dar espacio al título
    
    pdf.addImage(imgData, imageFormat, x, y, finalWidth, finalHeight, undefined, 'FAST');
    
    // Generar nombre del archivo con ticket ID
    const fileNameParts = [`ticket-${eventName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`];
    if (ticketId) {
      fileNameParts.push(ticketId);
    }
    const fileName = `${fileNameParts.join('-')}.pdf`;
    
    pdf.save(fileName);
    
    // Mostrar mensaje de éxito
    showSuccess('PDF generado exitosamente');
    
    // En móviles, pequeño delay
    if (isMobile) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
  } catch (error) {
    console.error('Error al generar PDF:', error.message);
    
    // Mensaje de error más específico
    let errorMessage = 'Ocurrió un error al generar el PDF';
    
    if (error.message.includes('canvas') || error.message.includes('Canvas')) {
      errorMessage = 'No se pudo capturar el ticket. Intenta de nuevo';
    } else if (error.message.includes('imagen') || error.message.includes('image')) {
      errorMessage = 'Error al procesar las imágenes. Intenta de nuevo';
    } else if (error.message.includes('memory') || error.message.includes('quota')) {
      errorMessage = 'No hay suficiente memoria. Cierra otras pestañas';
    } else if (error.name === 'SecurityError') {
      errorMessage = 'Error de seguridad del navegador';
    } else if (error.message.includes('oklch') || error.message.includes('color')) {
      errorMessage = 'Error de compatibilidad de colores. Intenta de nuevo';
    }

    console.error('Error específico:', error.message);
    
    showError(errorMessage, 5000);
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

