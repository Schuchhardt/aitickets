<script setup>
// Editor del mapa de asientos de una ubicación (entradas numeradas, src/lib/seatMap.mjs): se parte de una plantilla
// y se ajustan secciones, filas, asientos por fila y pasillos. Un clic en un asiento lo quita (columnas, espacio para
// sillas de ruedas) o lo devuelve.
import { reactive, ref, watch, computed } from 'vue'
import { Plus, Trash2, LayoutTemplate } from 'lucide-vue-next'
import SeatMapView from '../seats/SeatMapView.vue'
import {
  SEAT_MAP_TEMPLATES, seatMapFromTemplate, normalizeSeatMap, seatCountBySection, totalSeats,
  MAX_SECTIONS, MAX_ROWS, MAX_SEATS_PER_ROW, MAX_SEATS,
} from '../../lib/seatMap.mjs'

const props = defineProps({
  modelValue: { type: Object, default: null },
  title: { type: String, default: 'Mapa de asientos' },
})
const emit = defineEmits(['update:modelValue'])

const clone = (m) => JSON.parse(JSON.stringify(m))
const toLocal = (m) => {
  const src = clone(m || seatMapFromTemplate())
  for (const s of src.sections) s.aislesText = (s.aisles || []).join(', ')
  return src
}
const local = reactive(toLocal(props.modelValue))
const showTemplates = ref(!props.modelValue)

const normalized = computed(() => {
  const raw = clone(local)
  for (const s of raw.sections) {
    s.aisles = String(s.aislesText || '').split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0)
    delete s.aislesText
  }
  return normalizeSeatMap(raw)
})
watch(normalized, (m) => emit('update:modelValue', m), { deep: true, immediate: true })

const counts = computed(() => (normalized.value ? seatCountBySection(normalized.value) : {}))
const total = computed(() => (normalized.value ? totalSeats(normalized.value) : 0))
const ROW_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

function applyTemplate(id) {
  const next = toLocal(seatMapFromTemplate(id))
  Object.assign(local, next)
  showTemplates.value = false
}

function addSection() {
  if (local.sections.length >= MAX_SECTIONS) return
  const n = local.sections.length + 1
  local.sections.push({ id: `seccion-${Date.now() % 100000}`, name: `Sección ${n}`, rows: 5, seatsPerRow: 10, firstRow: 'A', aisles: [], aislesText: '', removed: [] })
}
function removeSection(i) {
  if (local.sections.length > 1) local.sections.splice(i, 1)
}

// Clic en un asiento: lo quita o lo devuelve (hueco)
function toggleSeat({ sectionId, row, n }) {
  // Las secciones normalizadas van en el mismo orden que las del formulario
  const sec = local.sections[(normalized.value?.sections || []).findIndex((x) => x.id === sectionId)]
  if (!sec) return
  const key = `${row}-${n}`
  sec.removed = sec.removed || []
  const i = sec.removed.indexOf(key)
  if (i >= 0) sec.removed.splice(i, 1)
  else sec.removed.push(key)
}
</script>

<template>
  <div class="rounded-xl border border-gray-200 bg-white p-4 sm:p-5 space-y-5" data-testid="seat-map-editor">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h4 class="font-bold">{{ title }}</h4>
        <p class="text-sm text-gray-500">{{ total }} asientos<span v-if="normalized?.sections.length > 1"> · {{ normalized.sections.map((s) => `${s.name}: ${counts[s.id] || 0}`).join(' · ') }}</span></p>
      </div>
      <button type="button" class="shrink-0 flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-black" @click="showTemplates = !showTemplates">
        <LayoutTemplate size="15" /> {{ showTemplates ? 'Ocultar plantillas' : 'Cambiar plantilla' }}
      </button>
    </div>

    <!-- Plantillas -->
    <div v-if="showTemplates" class="grid gap-2 sm:grid-cols-2" data-testid="seat-templates">
      <button
        v-for="tpl in SEAT_MAP_TEMPLATES"
        :key="tpl.id"
        type="button"
        class="text-left rounded-lg border px-3 py-2.5 transition-colors"
        :class="local.template === tpl.id ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-gray-400'"
        :data-template="tpl.id"
        @click="applyTemplate(tpl.id)"
      >
        <span class="block text-sm font-semibold">{{ tpl.name }}</span>
        <span class="block text-xs text-gray-500">{{ tpl.description }}</span>
      </button>
      <p class="sm:col-span-2 text-xs text-gray-500">Elegir una plantilla reemplaza el mapa actual. Después puedes ajustar filas y asientos.</p>
    </div>

    <!-- Frente de la sala -->
    <div class="max-w-xs">
      <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Frente de la sala</label>
      <input v-model="local.stage" type="text" maxlength="30" placeholder="Pantalla" class="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none" />
    </div>

    <!-- Secciones -->
    <div class="space-y-3">
      <div v-for="(sec, i) in local.sections" :key="sec.id" class="rounded-lg bg-gray-50 border border-gray-200 p-3" data-testid="seat-section">
        <div class="grid grid-cols-2 sm:grid-cols-12 gap-3 items-end">
          <div class="col-span-2 sm:col-span-3">
            <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Sección</label>
            <input v-model="sec.name" type="text" maxlength="40" class="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none bg-white" />
          </div>
          <div class="sm:col-span-2">
            <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Filas</label>
            <input v-model.number="sec.rows" type="number" min="1" :max="MAX_ROWS" class="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none bg-white" data-testid="seat-rows" />
          </div>
          <div class="sm:col-span-2">
            <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Por fila</label>
            <input v-model.number="sec.seatsPerRow" type="number" min="1" :max="MAX_SEATS_PER_ROW" class="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none bg-white" data-testid="seat-per-row" />
          </div>
          <div class="sm:col-span-2">
            <label class="block text-xs font-bold text-gray-500 uppercase mb-1">1.ª fila</label>
            <select v-model="sec.firstRow" class="w-full px-2 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none bg-white" aria-label="Letra de la primera fila">
              <option v-for="l in ROW_LETTERS" :key="l" :value="l">{{ l }}</option>
            </select>
          </div>
          <div class="sm:col-span-2">
            <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Pasillo tras</label>
            <input v-model="sec.aislesText" type="text" placeholder="Ej: 4, 12" class="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none bg-white" />
          </div>
          <div class="sm:col-span-1 flex sm:justify-end">
            <button v-if="local.sections.length > 1" type="button" class="p-2 text-gray-400 hover:text-red-500" :aria-label="`Quitar ${sec.name}`" @click="removeSection(i)">
              <Trash2 size="16" />
            </button>
          </div>
        </div>
        <p class="mt-2 text-xs text-gray-500">{{ counts[normalized?.sections[i]?.id] || 0 }} asientos<span v-if="sec.removed?.length"> · {{ sec.removed.length }} quitados</span></p>
      </div>
      <button v-if="local.sections.length < MAX_SECTIONS" type="button" class="text-sm text-blue-600 font-medium hover:underline flex items-center gap-1" @click="addSection">
        <Plus size="14" /> Agregar sección (con otro precio, p. ej. Preferencial o Balcón)
      </button>
    </div>

    <!-- Vista del mapa -->
    <div v-if="normalized" class="space-y-2">
      <p class="text-sm text-gray-600">Así lo verán quienes compran. Haz clic en un asiento para quitarlo (columnas, espacio para sillas de ruedas) y otra vez para devolverlo.</p>
      <div class="rounded-lg border border-gray-200 py-4">
        <SeatMapView :map="normalized" mode="edit" @toggle="toggleSeat" />
      </div>
      <p v-if="total >= MAX_SEATS" class="text-xs text-amber-700">Máximo {{ MAX_SEATS }} asientos por sala.</p>
    </div>
  </div>
</template>
