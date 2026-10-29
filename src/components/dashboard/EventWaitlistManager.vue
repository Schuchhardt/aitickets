<script setup>
import { ref, computed, onMounted } from 'vue'
import SkeletonRows from './SkeletonRows.vue'
import { BellRing, Download } from 'lucide-vue-next'

// Lista de espera del evento (/api/events/waitlist-list): quiénes se anotaron en la página (agotado, cupos llenos o
// venta por abrir) y si ya se les avisó. El aviso sale solo (netlify/lib/waitlist.mjs, cada 15 min) cuando abre la
// venta o se liberan entradas.

const props = defineProps({
  eventId: { type: Number, required: true },
})

const PAGE = 20
const data = ref(null)
const loading = ref(true)
const error = ref('')
const showAll = ref(false)

const fmt = (iso) => (iso ? new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' }) : '')
const visibleRows = computed(() => (showAll.value ? data.value?.rows : data.value?.rows.slice(0, PAGE)) || [])

onMounted(async () => {
  try {
    const res = await fetch(`/api/events/waitlist-list?event_id=${props.eventId}`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.message || 'No se pudo cargar la lista de espera')
    data.value = body
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" data-testid="event-waitlist">
    <div class="p-4 sm:p-6 border-b border-gray-100 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
      <div class="min-w-0">
        <h3 class="font-bold text-lg flex items-center gap-2"><BellRing :size="18" /> Lista de espera</h3>
        <p class="text-sm text-gray-500">
          Personas que pidieron aviso en la página del evento. Les escribimos solos, una vez, cuando abre la venta o se
          liberan entradas.
        </p>
      </div>
      <a
        v-if="data?.total"
        :href="`/api/events/waitlist-list?event_id=${eventId}&format=csv`"
        class="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50"
      >
        <Download :size="16" /> Exportar CSV
      </a>
    </div>

    <div v-if="loading" class="px-4 sm:px-6 py-2"><SkeletonRows :rows="3" label="Cargando lista de espera" /></div>
    <p v-else-if="error" class="p-4 sm:p-6 text-sm text-red-600" role="alert">{{ error }}</p>
    <template v-else-if="data">
      <div class="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100 text-center">
        <div class="p-3"><p class="text-xl font-bold">{{ data.total }}</p><p class="text-xs text-gray-500">anotados</p></div>
        <div class="p-3"><p class="text-xl font-bold">{{ data.pending }}</p><p class="text-xs text-gray-500">esperando aviso</p></div>
        <div class="p-3"><p class="text-xl font-bold">{{ data.notified }}</p><p class="text-xs text-gray-500">avisados</p></div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-left text-xs text-gray-500 bg-gray-50">
            <tr>
              <th class="px-4 py-2 font-medium">Email</th>
              <th class="px-4 py-2 font-medium">Motivo</th>
              <th class="px-4 py-2 font-medium">Función</th>
              <th class="px-4 py-2 font-medium">Anotado</th>
              <th class="px-4 py-2 font-medium">Aviso</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="r in visibleRows" :key="r.id">
              <td class="px-4 py-2 break-all">{{ r.email }}</td>
              <td class="px-4 py-2 whitespace-nowrap">{{ r.kind_label }}</td>
              <td class="px-4 py-2 whitespace-nowrap text-gray-600">{{ r.function_label || 'Todas' }}</td>
              <td class="px-4 py-2 whitespace-nowrap text-gray-600">{{ fmt(r.created_at) }}</td>
              <td class="px-4 py-2 whitespace-nowrap">
                <span v-if="r.notified_at" class="px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700">{{ fmt(r.notified_at) }}</span>
                <span v-else class="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">Pendiente</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <button
        v-if="!showAll && data.rows.length > PAGE"
        type="button"
        class="w-full p-3 text-sm font-medium text-gray-700 hover:bg-gray-50 border-t border-gray-100"
        @click="showAll = true"
      >
        Ver los {{ data.rows.length }}
      </button>
    </template>
  </section>
</template>
