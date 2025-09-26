<script setup>
import { ref, onMounted } from 'vue';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import TicketQR from "./TicketQR.vue";
import { formatLocalDate, formatLocalTime } from "../utils/dateHelpers.js";

const props = defineProps({
  ticket: Object,
  event: Object,
});

const isDownloading = ref(false);
const isSharing = ref(false);

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

// Función para imprimir como fallback
const printTicket = () => {
  const printWindow = window.open('', '_blank');
  const ticketEl = document.getElementById('ticket-container');
  
  if (!ticketEl || !printWindow) {
    // Fallback adicional - usar window.print() directamente
    window.print();
    return;
  }
  
  const ticketHTML = ticketEl.outerHTML;
  const eventName = props.event.name || 'Evento';
  
  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <title>Ticket - ${eventName}</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
  <style>
    @media print {
      body { margin: 0; padding: 20px; }
      * { 
        -webkit-print-color-adjust: exact !important; 
        color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    }
    @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@400;700&family=Prompt:wght@400;700&display=swap');
    .font-unbounded { font-family: 'Unbounded', cursive; }
    .font-prompt { font-family: 'Prompt', sans-serif; }
  </style>
</head>
<body class="bg-gray-100 p-4">
  <div class="max-w-md mx-auto">
    ${ticketHTML}
  </div>
  <script>
    window.onload = function() {
      window.print();
      setTimeout(function() { window.close(); }, 100);
    }
  <\/script>
</body>
</html>`;
  
  printWindow.document.write(htmlContent);
  printWindow.document.close();
};

// Función para compartir la entrada con Web Share API
const shareTicket = async () => {
  if (isSharing.value) return;
  
  try {
    isSharing.value = true;
    
    const ticketEl = document.getElementById('ticket-container');
    if (!ticketEl) {
      throw new Error('No se encontró el contenedor del ticket');
    }

    // Generar imagen del ticket
    const canvas = await html2canvas(ticketEl, { 
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      width: ticketEl.offsetWidth,
      height: ticketEl.offsetHeight
    });

    // Convertir canvas a blob
    const blob = await new Promise(resolve => {
      canvas.toBlob(resolve, 'image/jpeg', 0.9);
    });

    const eventName = props.event.name || 'Evento';
    const fileName = `ticket-${eventName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}.jpg`;
    const file = new File([blob], fileName, { type: 'image/jpeg' });

    // Intentar compartir con Web Share API
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: `Mi entrada para ${eventName}`,
        text: `¡Mira mi entrada para ${eventName}! ${formattedDate(props.event)} a las ${formattedTime(props.event)}`
      });
      console.log('Entrada compartida exitosamente');
    } else {
      // Fallback: descargar la imagen
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      console.log('Web Share API no disponible, imagen descargada');
    }
    
  } catch (error) {
    console.error('Error al compartir entrada:', error);
    // Fallback adicional - copiar información al portapapeles
    try {
      const eventName = props.event.name || 'Evento';
      const shareText = `¡Mira mi entrada para ${eventName}! ${formattedDate(props.event)} a las ${formattedTime(props.event)}`;
      await navigator.clipboard.writeText(shareText);
      alert('Información de la entrada copiada al portapapeles');
    } catch (clipboardError) {
      console.error('Error al copiar al portapapeles:', clipboardError);
      alert('No se pudo compartir la entrada');
    }
  } finally {
    isSharing.value = false;
  }
};

// 👉 Función mejorada para descargar el ticket como PDF
const downloadAsPDF = async () => {
  if (isDownloading.value) return;
  
  try {
    isDownloading.value = true;
    
    // Verificar soporte del navegador
    if (!supportsDownload()) {
      console.warn('El navegador no soporta descargas, usando diálogo de impresión');
      printTicket();
      return;
    }
    
    const ticketEl = document.getElementById('ticket-container');
    if (!ticketEl) {
      throw new Error('No se encontró el contenedor del ticket');
    }

    // Generar canvas con html2canvas
    const canvas = await html2canvas(ticketEl, { 
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      width: ticketEl.offsetWidth,
      height: ticketEl.offsetHeight
    });

    // Crear PDF con jsPDF
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
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

    pdf.addImage(imgData, 'PNG', x, y, finalWidth, finalHeight);
    
    // Generar nombre del archivo
    const fileName = `ticket-${(props.event.name || 'evento').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}.pdf`;
    
    // Descargar PDF
    pdf.save(fileName);
    
  } catch (error) {
    console.error('Error al generar PDF:', error);
    console.log('Usando diálogo de impresión como fallback');
    printTicket();
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
          <p class="text-xs text-amber-600 flex items-center justify-center">
            <svg class="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path>
            </svg>
            Ubicación puede cambiar
          </p>
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
        @click="shareTicket"
        :disabled="isSharing || isDownloading"
        class="flex-1 bg-lime-500 font-[Unbounded] text-white text-center py-2 rounded-lg hover:bg-lime-600 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        <svg v-if="isSharing" class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z"></path>
        </svg>
        {{ isSharing ? 'Compartiendo...' : 'Compartir Entrada' }}
      </button>
      
      <!-- Botón PDF (solo icono) -->
      <button
        aria-label="Descargar ticket como PDF"
        @click="downloadAsPDF"
        :disabled="isDownloading || isSharing"
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
      
      <!-- Botón Imprimir (solo icono) -->
      <button
        aria-label="Imprimir ticket"
        @click="printTicket"
        :disabled="isDownloading || isSharing"
        class="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
        title="Imprimir ticket"
      >
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path>
        </svg>
      </button>
    </div>
  </div>
</template>

