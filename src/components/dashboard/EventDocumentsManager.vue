<script setup>
import { ref, computed, onMounted } from 'vue'
import SkeletonRows from './SkeletonRows.vue'
import { FileCheck, Upload } from 'lucide-vue-next'

// Permisos y documentos del evento (/api/events/documents): autorización de la Delegación Presidencial (eventos
// masivos, Ley 21.659), contrato o permiso del lugar y póliza de responsabilidad civil. El archivo se sube directo a
// Storage con una URL firmada y AI Tickets lo revisa. El estado de la autorización se muestra en la página pública.

const props = defineProps({
  eventId: { type: Number, required: true },
})

const KIND_ORDER = ['delegacion_presidencial', 'venue_permit', 'rc_insurance', 'other']
const STATUS_LABEL = { pending: 'En revisión', approved: 'Aprobado', rejected: 'Rechazado' }
const STATUS_CLASS = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700' }
const PERMIT_LABEL = { none: 'Sin documentos', pending: 'Autorización en trámite', approved: 'Autorización aprobada', rejected: 'Autorización rechazada' }
const RISK_LABEL = { low: 'bajo', medium: 'medio', high: 'alto' }

const loading = ref(true)
const unavailable = ref(false)
const state = ref({ event: {}, documents: [], missing: [], kinds: {}, max_bytes: 15 * 1024 * 1024 })
const kind = ref('delegacion_presidencial')
const file = ref(null)
const fileInput = ref(null)
const uploading = ref(false)
const savingMassive = ref(false)
const error = ref('')

const kinds = computed(() => KIND_ORDER.filter((k) => state.value.kinds?.[k]).map((k) => ({ value: k, label: state.value.kinds[k] })))
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' }) : '')

const load = async () => {
  loading.value = true
  try {
    const res = await fetch(`/api/events/documents?eventId=${props.eventId}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || 'No se pudieron cargar los documentos')
    unavailable.value = data.available === false
    state.value = data
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

const post = async (body) => {
  const res = await fetch('/api/events/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId: props.eventId, ...body }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || 'No se pudo completar la acción')
  return data
}

const onFile = (e) => {
  file.value = e.target.files?.[0] || null
}

const upload = async () => {
  if (!file.value) return
  error.value = ''
  if (file.value.size > state.value.max_bytes) {
    error.value = 'El archivo supera los 15 MB.'
    return
  }
  uploading.value = true
  try {
    const f = file.value
    const prepared = await post({ action: 'upload_url', kind: kind.value, contentType: f.type, size: f.size, fileName: f.name })
    // Mismo formato que supabase-js (uploadToSignedUrl): multipart con el archivo en el campo vacío.
    const body = new FormData()
    body.append('cacheControl', '3600')
    body.append('', f)
    const put = await fetch(prepared.uploadUrl, { method: 'PUT', headers: { 'x-upsert': 'false' }, body })
    if (!put.ok) throw new Error('No se pudo subir el archivo')
    await post({ action: 'confirm', kind: kind.value, path: prepared.path, fileName: f.name })
    file.value = null
    if (fileInput.value) fileInput.value.value = ''
    await load()
  } catch (e) {
    error.value = e.message
  } finally {
    uploading.value = false
  }
}

const toggleMassive = async (value) => {
  error.value = ''
  savingMassive.value = true
  try {
    await post({ action: 'set_massive', is_massive: value })
    await load()
  } catch (e) {
    error.value = e.message
  } finally {
    savingMassive.value = false
  }
}
</script>

<template>
  <div class="bg-white p-4 sm:p-6 rounded-xl border border-gray-200 shadow-sm" data-testid="event-documents">
    <h3 class="font-bold text-lg mb-1 flex items-center gap-2"><FileCheck :size="18" /> Permisos y documentos</h3>
    <p class="text-sm text-gray-500 mb-4">
      Sube la autorización del evento, el permiso del lugar y la póliza de responsabilidad civil. Los revisamos y la página del evento muestra el estado de la autorización.
    </p>

    <SkeletonRows v-if="loading" variant="lines" :rows="3" />
    <p v-else-if="unavailable" class="text-sm text-amber-700">Esta sección estará disponible en unos minutos.</p>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <span class="px-2 py-1 rounded-full bg-gray-100 text-gray-700" data-testid="permit-status">{{ PERMIT_LABEL[state.event.permit_status] || 'Sin documentos' }}</span>
        <span v-if="state.event.risk_level && state.event.risk_level !== 'low'" class="px-2 py-1 rounded-full bg-amber-100 text-amber-700">
          Riesgo {{ RISK_LABEL[state.event.risk_level] }} · reserva {{ state.event.reserve_pct }}%
        </span>
      </div>

      <label class="flex items-start gap-2 text-sm text-gray-700 cursor-pointer mb-3">
        <input type="checkbox" class="mt-1" :checked="state.event.is_massive" :disabled="savingMassive" @change="toggleMassive($event.target.checked)" />
        <span>
          Es un evento masivo
          <span class="block text-xs text-gray-500">Requiere autorización de la Delegación Presidencial Regional (Ley 21.659). Mientras no esté aprobada, la página mostrará "Autorización en trámite".</span>
        </span>
      </label>

      <div v-if="state.missing?.length" class="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900" data-testid="documents-missing">
        <p class="font-semibold mb-1">Faltan documentos para este evento:</p>
        <ul class="list-disc pl-4">
          <li v-for="k in state.missing" :key="k">{{ state.kinds[k] }}</li>
        </ul>
        <p class="mt-1">Mientras falten podemos pausar la venta o retener lo recaudado.</p>
      </div>

      <ul v-if="state.documents.length" class="divide-y divide-gray-100 mb-4 text-sm">
        <li v-for="d in state.documents" :key="d.id" class="py-2 flex flex-wrap items-center justify-between gap-2">
          <div class="min-w-0">
            <p class="font-medium text-gray-900 truncate">{{ d.kind_label }}</p>
            <p class="text-xs text-gray-500 truncate">
              <a :href="`/api/events/documents?eventId=${eventId}&download=${d.id}`" target="_blank" rel="noopener" class="underline">{{ d.file_name || 'Documento' }}</a>
              · {{ fmtDate(d.created_at) }}
            </p>
            <p v-if="d.notes" class="text-xs text-red-600">{{ d.notes }}</p>
          </div>
          <span class="px-2 py-0.5 rounded-full text-xs" :class="STATUS_CLASS[d.status]">{{ STATUS_LABEL[d.status] || d.status }}</span>
        </li>
      </ul>

      <form @submit.prevent="upload" class="space-y-2">
        <select v-model="kind" class="w-full bg-gray-50 border border-gray-200 text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-black">
          <option v-for="k in kinds" :key="k.value" :value="k.value">{{ k.label }}</option>
        </select>
        <input ref="fileInput" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" class="block w-full text-sm" @change="onFile" />
        <button type="submit" :disabled="!file || uploading" class="w-full py-2 bg-black text-white rounded-lg font-medium text-sm hover:bg-gray-900 transition disabled:opacity-60 flex items-center justify-center gap-2">
          <Upload :size="16" /> {{ uploading ? 'Subiendo…' : 'Subir documento' }}
        </button>
        <p class="text-xs text-gray-400">PDF, JPG, PNG o WEBP, hasta 15 MB.</p>
      </form>
    </template>

    <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
  </div>
</template>
