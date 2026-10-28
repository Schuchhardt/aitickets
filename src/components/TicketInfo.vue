<script setup>
// Tarjeta de una entrada (páginas de la orden, de la entrada y de confirmación de pago): QR grande, evento, función,
// lugar y titular, autocontenida para que sirva como captura de pantalla en la puerta. "PDF" descarga la tarjeta.
// Con shareUrl (la página /ticket/<id> de esta entrada), "Compartir" la manda por WhatsApp, correo, etc.: así quien
// compró varias (o una mesa) le pasa a cada invitado su propio QR.
import { ref, computed } from 'vue';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import TicketQR from "./TicketQR.vue";
import { formatLocalDate, formatLocalTime } from "../utils/dateHelpers.js";
import { showSuccess, showError } from "../lib/toastBus.js";

const props = defineProps({
  ticket: Object,
  event: Object,
  // Posición en la orden ("Entrada 2 de 3")
  index: { type: Number, required: false },
  total: { type: Number, required: false },
  // Función de la entrada ya formateada ("Sábado 12 de octubre · 20:00 hrs"); sin ella, la fecha del evento
  functionLabel: { type: String, required: false },
  // Lugar a mostrar (la dirección secreta si corresponde); sin él, el del evento
  place: { type: String, required: false },
  // Link de esta entrada sola (/ticket/<id>) para pasársela a otra persona
  shareUrl: { type: String, required: false },
});

const shareState = ref('');
async function shareTicket() {
  const url = props.shareUrl;
  if (!url) return;
  const title = props.event?.name || 'Entrada';
  if (navigator.share) {
    try {
      await navigator.share({ title, text: `Tu entrada para ${title}`, url });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    shareState.value = 'copied';
    setTimeout(() => (shareState.value = ''), 2000);
  } catch {
    window.prompt('Copia el link de esta entrada:', url);
  }
}

const isDownloading = ref(false);
const captureEl = ref(null);

const whenLabel = computed(() => {
  if (props.functionLabel) return props.functionLabel;
  if (!props.event?.start_date) return '';
  const day = formatLocalDate(props.event.start_date, { weekday: 'long', day: 'numeric', month: 'long' });
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} · ${formatLocalTime(props.event.start_date)} hrs`;
});
const whereLabel = computed(() => props.place || props.event?.secret_location || props.event?.address || '');
const holder = computed(() => props.ticket?.attendee_name || '');
const position = computed(() => props.index || 1);
const count = computed(() => props.total || 1);
const cancelled = computed(() => props.ticket?.status === 'cancelled');
const used = computed(() => props.ticket?.status === 'validated');

// Función para detectar si el navegador soporta descarga de archivos
const supportsDownload = () => {
  const a = document.createElement('a');
  return typeof a.download !== 'undefined';
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
    
    // Cada tarjeta captura la suya (con varias entradas en la página, un id fijo siempre tomaba la primera)
    const ticketEl = captureEl.value;
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
        } else if (className.includes('bg-lime-100')) {
          el.style.backgroundColor = 'rgb(236, 252, 203)';
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
        } else if (className.includes('text-gray-900')) {
          el.style.color = 'rgb(17, 24, 39)';
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
  <article class="rounded-2xl bg-white border border-gray-200 shadow-sm overflow-hidden" :class="cancelled ? 'opacity-70' : ''">
    <div ref="captureEl" class="bg-white px-5 pt-5 pb-4 text-center">
      <p class="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{{ ticket.ticket_name || ticket.name || 'Entrada' }}</p>
      <p class="mt-1 font-bold font-[Unbounded] text-gray-900 leading-snug">{{ event?.name }}</p>
      <p v-if="whenLabel" class="mt-1 text-sm text-gray-600 font-[Prompt]">{{ whenLabel }}</p>
      <p v-if="whereLabel" class="text-xs text-gray-500 font-[Prompt]">{{ whereLabel }}</p>

      <div v-if="ticket.qr_code" class="mt-3 flex flex-col items-center">
        <TicketQR :code="ticket.qr_code" />
      </div>
      <p v-else-if="cancelled" class="my-6 text-sm font-semibold text-gray-500">Entrada anulada</p>
      <p v-else class="my-6 text-sm text-gray-500">El código QR aparecerá aquí apenas se emita.</p>

      <p v-if="used" class="mt-1 inline-block rounded-full bg-lime-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">Ya ingresaste con esta entrada</p>
      <p v-else-if="ticket.qr_code" class="mt-1 text-xs text-gray-500 font-[Prompt]">Muestra este código en la puerta</p>
    </div>

    <div class="flex items-center justify-between gap-3 border-t border-dashed border-gray-200 px-5 py-3 font-[Prompt]">
      <p class="min-w-0 truncate text-xs text-gray-500">
        <span v-if="holder" class="text-gray-700">{{ holder }}</span>
        <span v-if="holder && count > 1"> · </span>
        <span v-if="count > 1">Entrada {{ position }} de {{ count }}</span>
      </p>
      <div class="shrink-0 flex items-center gap-2">
      <button
        v-if="ticket.qr_code && shareUrl"
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-gray-900 transition"
        data-testid="ticket-share"
        @click="shareTicket"
      >
        <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M7 17 17 7M9 7h8v8"></path></svg>
        {{ shareState === 'copied' ? '¡Link copiado!' : 'Compartir' }}
      </button>
      <button
        v-if="ticket.qr_code"
        type="button"
        aria-label="Descargar entrada en PDF"
        title="Descargar PDF"
        :disabled="isDownloading"
        class="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-gray-900 transition disabled:opacity-50"
        @click="downloadAsPDF"
      >
        <svg v-if="isDownloading" class="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
        <svg v-else class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v12m0 0-4-4m4 4 4-4M5 20h14"></path>
        </svg>
        PDF
      </button>
      </div>
    </div>
  </article>
</template>
