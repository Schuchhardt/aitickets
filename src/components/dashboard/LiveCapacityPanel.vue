<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { Activity, ScanLine } from 'lucide-vue-next'

// Aforo en vivo del evento (/api/events/checkin-stats = get_checkin_stats del asistente de IA): ingresados sobre
// emitidas y sobre la capacidad, por tipo de entrada y función, y llegadas cada 15 minutos. Se refresca solo cada
// REFRESH_MS mientras la tarjeta está a la vista y la pestaña del navegador activa (pestaña Puerta del panel).

const REFRESH_MS = 5000

const props = defineProps({
  eventId: { type: Number, required: true },
  checkinUrl: { type: String, default: '' },
})

const stats = ref(null)
const error = ref('')
const loading = ref(true)
const now = ref(Date.now())
let timer = 0
let clock = 0
let observer = null
let inView = false
let busy = false

const num = (n) => Number(n || 0).toLocaleString('es-CL')
const pctOf = (part, total) => (total ? Math.min(100, Math.round((part / total) * 100)) : 0)
const timeLabel = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit' }) : '')

const ago = computed(() => {
  if (!stats.value?.as_of) return ''
  const s = Math.max(0, Math.round((now.value - new Date(stats.value.as_of).getTime()) / 1000))
  return s < 5 ? 'recién' : s < 60 ? `hace ${s} s` : `hace ${Math.round(s / 60)} min`
})
const base = computed(() => stats.value?.capacity || stats.value?.issued || 0)
const types = computed(() => (stats.value?.by_ticket_type || []).filter((t) => t.issued > 0).sort((a, b) => b.issued - a.issued))
const functions = computed(() => (stats.value?.functions_count > 1 ? stats.value.by_function.filter((f) => f.issued > 0) : []))
const arrivals = computed(() => stats.value?.arrivals_last_3h || [])
const maxArrivals = computed(() => Math.max(1, ...arrivals.value.map((a) => a.count)))
const last15 = computed(() => arrivals.value.at(-1)?.count || 0)

async function load() {
  if (busy) return
  busy = true
  try {
    const res = await fetch(`/api/events/checkin-stats?event_id=${props.eventId}`, { cache: 'no-store' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.message || 'No se pudo cargar el aforo')
    stats.value = body
    error.value = ''
  } catch (e) {
    // Si ya hay datos se mantienen; el error se muestra igual para saber que no se está actualizando
    error.value = e.message
  } finally {
    busy = false
    loading.value = false
  }
}

const active = () => inView && document.visibilityState === 'visible'

function schedule() {
  clearTimeout(timer)
  if (!active()) return
  timer = setTimeout(async () => {
    await load()
    schedule()
  }, REFRESH_MS)
}

function resume() {
  if (!active()) return clearTimeout(timer)
  load().then(schedule)
}

onMounted(() => {
  clock = setInterval(() => (now.value = Date.now()), 1000)
  document.addEventListener('visibilitychange', resume)
  const el = document.querySelector(`[data-testid="live-capacity-${props.eventId}"]`)
  if (el && 'IntersectionObserver' in window) {
    observer = new IntersectionObserver((entries) => {
      inView = entries.some((e) => e.isIntersecting)
      resume()
    })
    observer.observe(el)
  } else {
    inView = true
    resume()
  }
})

onBeforeUnmount(() => {
  clearTimeout(timer)
  clearInterval(clock)
  observer?.disconnect()
  document.removeEventListener('visibilitychange', resume)
})
</script>

<template>
  <section class="bg-white p-4 sm:p-6 rounded-xl border border-gray-200 shadow-sm" :data-testid="`live-capacity-${eventId}`">
    <div class="flex items-start justify-between gap-3 mb-4">
      <div class="min-w-0">
        <h3 class="font-bold text-lg flex items-center gap-2"><Activity :size="18" /> Aforo en vivo</h3>
        <p class="text-xs text-gray-500 mt-0.5" aria-live="off">
          Se actualiza solo cada 5 segundos<span v-if="ago"> · {{ ago }}</span>
        </p>
      </div>
      <a v-if="checkinUrl" :href="checkinUrl" class="shrink-0 inline-flex items-center gap-1 text-sm font-medium text-black hover:underline">
        <ScanLine :size="16" /> Escanear
      </a>
    </div>

    <p v-if="loading" class="text-sm text-gray-500">Cargando…</p>
    <p v-else-if="!stats" class="text-sm text-red-600" role="alert">{{ error }}</p>

    <template v-else>
      <div class="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <p class="text-xs text-gray-500">Adentro</p>
          <p class="text-4xl font-bold tabular-nums" data-testid="live-capacity-inside">{{ num(stats.checked_in) }}</p>
        </div>
        <p class="text-sm text-gray-600 pb-1">
          de {{ num(stats.issued) }} entradas emitidas
          <span v-if="stats.capacity"> · aforo {{ num(stats.capacity) }} ({{ stats.occupancy_pct ?? 0 }}%)</span>
        </p>
      </div>
      <div class="mt-3 h-3 rounded-full bg-gray-100 overflow-hidden" role="progressbar" :aria-valuenow="stats.checked_in" aria-valuemin="0" :aria-valuemax="base" aria-label="Personas adentro">
        <div class="h-full bg-black rounded-full transition-all duration-500" :style="{ width: `${pctOf(stats.checked_in, base)}%` }"></div>
      </div>
      <p class="mt-2 text-xs text-gray-500">
        Faltan {{ num(stats.pending) }}
        <span v-if="stats.complimentary_checked_in"> · {{ num(stats.complimentary_checked_in) }} cortesías adentro</span>
        <span v-if="stats.last_check_in_at"> · último ingreso {{ timeLabel(stats.last_check_in_at) }}</span>
        · {{ num(last15) }} en los últimos 15 min
      </p>
      <p v-if="error" class="mt-2 text-xs text-amber-700" role="status">No se pudo actualizar: {{ error }}</p>

      <div v-if="types.length" class="mt-5">
        <p class="text-xs font-bold text-gray-500 uppercase mb-2">Por tipo de entrada</p>
        <ul class="space-y-2 text-sm">
          <li v-for="t in types" :key="t.ticket_type_id" data-testid="live-capacity-type">
            <div class="flex justify-between gap-3">
              <span class="min-w-0 break-words">{{ t.name || 'Entrada' }}</span>
              <span class="shrink-0 tabular-nums text-gray-700">{{ num(t.checked_in) }} / {{ num(t.issued) }}</span>
            </div>
            <div class="mt-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div class="h-full bg-gray-800 rounded-full transition-all duration-500" :style="{ width: `${pctOf(t.checked_in, t.issued)}%` }"></div>
            </div>
          </li>
        </ul>
      </div>

      <div v-if="functions.length" class="mt-5">
        <p class="text-xs font-bold text-gray-500 uppercase mb-2">Por función</p>
        <ul class="divide-y divide-gray-100 text-sm">
          <li v-for="(f, i) in functions" :key="f.function?.id ?? `all-${i}`" class="flex justify-between gap-3 py-1.5">
            <span class="min-w-0 break-words">{{ f.function?.label || 'Función' }}</span>
            <span class="shrink-0 tabular-nums text-gray-700">{{ num(f.checked_in) }} / {{ num(f.issued) }}</span>
          </li>
        </ul>
      </div>

      <div class="mt-5">
        <p class="text-xs font-bold text-gray-500 uppercase mb-2">Llegadas cada 15 minutos (últimas 3 horas)</p>
        <div class="flex items-end gap-1 h-16" aria-hidden="true">
          <div v-for="a in arrivals" :key="a.from" class="flex-1 bg-gray-200 rounded-sm relative" :style="{ height: `${Math.max(4, (a.count / maxArrivals) * 100)}%` }" :title="`${a.from_local}: ${a.count}`">
            <div v-if="a.count" class="absolute inset-0 bg-gray-800 rounded-sm"></div>
          </div>
        </div>
        <p class="sr-only">{{ arrivals.map((a) => `${a.from_local}: ${a.count}`).join(', ') }}</p>
      </div>
    </template>
  </section>
</template>
