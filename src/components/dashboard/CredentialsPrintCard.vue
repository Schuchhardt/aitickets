<script setup>
import { ref, computed } from 'vue'
import { IdCard, Download } from 'lucide-vue-next'

// Credenciales con nombre para imprimir (/api/events/credentials, src/lib/credentials.ts): un PDF A4 con 4 por hoja,
// en orden alfabético. Cada una con el nombre del titular, la empresa si la compra la pidió, el tipo de entrada y el
// QR de su entrada (también sirve para acreditar). Con varias funciones se filtra por una (y entran los pases).

const props = defineProps({
  eventId: { type: Number, required: true },
  /** Funciones del evento: [{ id, label }] */
  options: { type: Array, required: true },
})

const functionId = ref('')
const error = ref('')
const loading = ref(false)
const url = computed(() => `/api/events/credentials?event_id=${props.eventId}${functionId.value ? `&function_id=${functionId.value}` : ''}`)

// Se descarga con fetch para mostrar el error (sin entradas, demasiadas) en vez de una página en blanco
const download = async () => {
  error.value = ''
  loading.value = true
  try {
    const res = await fetch(url.value)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error?.message || 'No se pudieron generar las credenciales')
    }
    const blob = await res.blob()
    const disposition = res.headers.get('Content-Disposition') || ''
    const name = disposition.split('filename=')[1]?.replaceAll('"', '') || 'credenciales.pdf'
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10000)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="bg-white p-4 sm:p-6 rounded-xl border border-gray-200 shadow-sm" data-testid="credentials-card">
    <h3 class="font-bold text-lg mb-1 flex items-center gap-2"><IdCard :size="18" /> Credenciales con nombre</h3>
    <p class="text-sm text-gray-500 mb-4">
      Un PDF para imprimir y recortar, 4 por hoja, en orden alfabético: nombre, empresa (si la pediste al comprar), tipo de
      entrada y el QR de su entrada, que también se puede escanear para acreditar.
    </p>
    <div class="flex flex-wrap items-end gap-2">
      <label v-if="options.length > 1" class="block">
        <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Función</span>
        <select v-model="functionId" class="bg-gray-50 border border-gray-200 text-sm rounded-lg px-2 py-2 outline-none focus:ring-2 focus:ring-black" data-testid="credentials-function">
          <option value="">Todas</option>
          <option v-for="f in options" :key="f.id" :value="String(f.id)">{{ f.label }}</option>
        </select>
      </label>
      <button type="button" @click="download" :disabled="loading" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-black text-white text-sm font-medium hover:bg-gray-900 disabled:opacity-60" data-testid="credentials-download">
        <Download :size="16" /> {{ loading ? 'Preparando…' : 'Descargar PDF' }}
      </button>
    </div>
    <p v-if="options.length > 1 && functionId" class="text-xs text-gray-500 mt-2">Incluye los pases válidos para todas las funciones.</p>
    <p v-if="error" class="mt-2 text-sm text-red-600" role="alert">{{ error }}</p>
  </div>
</template>
