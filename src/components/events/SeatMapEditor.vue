<script setup>
// Editor del mapa de asientos de una ubicación (entradas numeradas, src/lib/seatMap.mjs). Arriba el mapa tal como lo
// verán quienes compran; debajo la plantilla (un carrusel con miniaturas) y los ajustes de cada sección según su tipo:
// filas rectas, mesas redondas (café o bar) o graderías en arco alrededor de una pista (circo). Un clic en un asiento
// lo quita (columnas, espacio para sillas de ruedas) o lo devuelve.
import { reactive, ref, watch, computed, nextTick } from 'vue'
import { Plus, Trash2, ChevronLeft, ChevronRight, Undo2 } from 'lucide-vue-next'
import SeatMapView from '../seats/SeatMapView.vue'
import SeatMapThumb from '../seats/SeatMapThumb.vue'
import {
  SEAT_MAP_TEMPLATES, seatMapFromTemplate, normalizeSeatMap, seatCountBySection, totalSeats, LAYOUT_LABELS,
  MAX_SECTIONS, MAX_ROWS, MAX_SEATS_PER_ROW, MAX_SEATS, MAX_SEATS_PER_TABLE, MAX_TABLE_COLUMNS, MAX_ARC_GROWTH, MAX_ARC_BLOCKS,
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

// ---- Plantillas (carrusel) ----
const templates = SEAT_MAP_TEMPLATES.map((t) => ({ ...t, preview: seatMapFromTemplate(t.id) }))
const strip = ref(null)
// "Deshacer" vuelve al mapa de antes de elegir la plantilla; deja de ofrecerse apenas se edita otra cosa
const undoMap = ref(null)
let applying = false
function swap(next) {
  applying = true
  Object.assign(local, next)
  nextTick(() => (applying = false))
}
function applyTemplate(id) {
  if (local.template === id) return
  undoMap.value = clone(local)
  swap(toLocal(seatMapFromTemplate(id)))
}
function undoTemplate() {
  if (!undoMap.value) return
  const prev = undoMap.value
  undoMap.value = null
  swap(prev)
}
watch(local, () => {
  if (!applying) undoMap.value = null
}, { deep: true })
function scrollTemplates(dir) {
  const el = strip.value
  if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
}
// La plantilla actual queda a la vista al abrir
nextTick(() => strip.value?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' }))

// ---- Secciones ----
const NEW_SECTION = {
  grid: { rows: 5, seatsPerRow: 10 },
  tables: { rows: 6, seatsPerRow: 4, columns: 3 },
  arc: { rows: 5, seatsPerRow: 14, growth: 3, blocks: 3 },
}
function addSection() {
  if (local.sections.length >= MAX_SECTIONS) return
  const n = local.sections.length + 1
  local.sections.push({ id: `seccion-${Date.now() % 100000}`, name: `Sección ${n}`, layout: 'grid', firstRow: 'A', aisles: [], aislesText: '', removed: [], ...NEW_SECTION.grid })
}
function removeSection(i) {
  if (local.sections.length > 1) local.sections.splice(i, 1)
}
// Al cambiar el tipo de una sección se parte de medidas razonables para ese tipo
function setLayout(sec, layout) {
  Object.assign(sec, { layout, removed: [], aislesText: '' }, NEW_SECTION[layout])
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

const input = 'w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none bg-white'
const lbl = 'block text-xs font-bold text-gray-500 uppercase mb-1'
</script>

<template>
  <div class="rounded-xl border border-gray-200 bg-white p-4 sm:p-5 space-y-5" data-testid="seat-map-editor">
    <!-- Título y mapa -->
    <div>
      <h4 class="font-bold">{{ title }}</h4>
      <p class="text-sm text-gray-500">{{ total }} asientos<span v-if="normalized?.sections.length > 1"> · {{ normalized.sections.map((s) => `${s.name}: ${counts[s.id] || 0}`).join(' · ') }}</span></p>
    </div>
    <div v-if="normalized" class="space-y-2">
      <div class="rounded-lg border border-gray-200 py-4">
        <SeatMapView :map="normalized" mode="edit" @toggle="toggleSeat" />
      </div>
      <p class="text-xs text-gray-500">Así lo verán quienes compran. Haz clic en un asiento para quitarlo (columnas, espacio para sillas de ruedas) y otra vez para devolverlo.</p>
      <p v-if="total >= MAX_SEATS" class="text-xs text-amber-700">Máximo {{ MAX_SEATS }} asientos por sala.</p>
    </div>

    <!-- Plantilla -->
    <div data-testid="seat-templates">
      <div class="flex items-center justify-between mb-2">
        <p :class="lbl" class="!mb-0">Plantilla</p>
        <div class="flex items-center gap-1">
          <button v-if="undoMap" type="button" class="mr-2 flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-black" @click="undoTemplate">
            <Undo2 size="13" /> Deshacer
          </button>
          <button type="button" class="p-1.5 rounded-full border border-gray-200 text-gray-500 hover:text-black hover:border-gray-400" aria-label="Plantillas anteriores" @click="scrollTemplates(-1)"><ChevronLeft size="16" /></button>
          <button type="button" class="p-1.5 rounded-full border border-gray-200 text-gray-500 hover:text-black hover:border-gray-400" aria-label="Más plantillas" @click="scrollTemplates(1)"><ChevronRight size="16" /></button>
        </div>
      </div>
      <div ref="strip" class="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1" style="scrollbar-width: thin">
        <button
          v-for="tpl in templates"
          :key="tpl.id"
          type="button"
          class="snap-start shrink-0 w-40 sm:w-44 text-left rounded-xl border p-2 transition-colors"
          :class="local.template === tpl.id ? 'border-black ring-2 ring-black/10 bg-gray-50' : 'border-gray-200 hover:border-gray-400'"
          :aria-pressed="local.template === tpl.id ? 'true' : 'false'"
          :data-template="tpl.id"
          @click="applyTemplate(tpl.id)"
        >
          <span class="block h-20 rounded-lg bg-white border border-gray-100 p-1.5"><SeatMapThumb :map="tpl.preview" /></span>
          <span class="block mt-2 text-sm font-semibold leading-tight">{{ tpl.name }}</span>
          <span class="block mt-0.5 text-xs text-gray-500 leading-snug">{{ tpl.description }}</span>
        </button>
      </div>
      <p class="mt-1 text-xs text-gray-500">Elegir una plantilla reemplaza el mapa. Después ajusta las medidas abajo.</p>
    </div>

    <!-- Frente de la sala -->
    <div class="max-w-xs">
      <label :class="lbl">{{ normalized?.sections.some((s) => s.layout === 'arc') ? 'Nombre de la pista' : 'Frente de la sala' }}</label>
      <input v-model="local.stage" type="text" maxlength="30" placeholder="Pantalla" :class="input" />
    </div>

    <!-- Secciones -->
    <div class="space-y-3">
      <div v-for="(sec, i) in local.sections" :key="sec.id" class="rounded-lg bg-gray-50 border border-gray-200 p-3" data-testid="seat-section">
        <div class="grid grid-cols-2 sm:grid-cols-12 gap-3 items-end">
          <div class="col-span-2 sm:col-span-5">
            <label :class="lbl">Sección</label>
            <input v-model="sec.name" type="text" maxlength="40" :class="input" />
          </div>
          <div class="col-span-2 sm:col-span-5">
            <label :class="lbl">Tipo</label>
            <select :value="sec.layout || 'grid'" :class="input" data-testid="seat-layout" @change="setLayout(sec, $event.target.value)">
              <option v-for="(name, id) in LAYOUT_LABELS" :key="id" :value="id">{{ name }}</option>
            </select>
          </div>
          <div class="col-span-2 sm:col-span-2 flex sm:justify-end">
            <button v-if="local.sections.length > 1" type="button" class="p-2 text-gray-400 hover:text-red-500" :aria-label="`Quitar ${sec.name}`" @click="removeSection(i)">
              <Trash2 size="16" />
            </button>
          </div>

          <!-- Filas rectas -->
          <template v-if="!sec.layout || sec.layout === 'grid'">
            <div class="sm:col-span-3">
              <label :class="lbl">Filas</label>
              <input v-model.number="sec.rows" type="number" min="1" :max="MAX_ROWS" :class="input" data-testid="seat-rows" />
            </div>
            <div class="sm:col-span-3">
              <label :class="lbl">Por fila</label>
              <input v-model.number="sec.seatsPerRow" type="number" min="1" :max="MAX_SEATS_PER_ROW" :class="input" data-testid="seat-per-row" />
            </div>
            <div class="sm:col-span-3">
              <label :class="lbl">1.ª fila</label>
              <select v-model="sec.firstRow" :class="input" aria-label="Letra de la primera fila">
                <option v-for="l in ROW_LETTERS" :key="l" :value="l">{{ l }}</option>
              </select>
            </div>
            <div class="sm:col-span-3">
              <label :class="lbl">Pasillo tras</label>
              <input v-model="sec.aislesText" type="text" placeholder="Ej: 4, 12" :class="input" />
            </div>
          </template>

          <!-- Mesas -->
          <template v-else-if="sec.layout === 'tables'">
            <div class="sm:col-span-4">
              <label :class="lbl">Mesas</label>
              <input v-model.number="sec.rows" type="number" min="1" :max="MAX_ROWS" :class="input" data-testid="seat-tables" />
            </div>
            <div class="sm:col-span-4">
              <label :class="lbl">Sillas por mesa</label>
              <input v-model.number="sec.seatsPerRow" type="number" min="1" :max="MAX_SEATS_PER_TABLE" :class="input" />
            </div>
            <div class="sm:col-span-4">
              <label :class="lbl">Mesas por fila</label>
              <input v-model.number="sec.columns" type="number" min="1" :max="MAX_TABLE_COLUMNS" :class="input" />
            </div>
          </template>

          <!-- Graderías en arco -->
          <template v-else>
            <div class="sm:col-span-3">
              <label :class="lbl">Filas</label>
              <input v-model.number="sec.rows" type="number" min="1" :max="MAX_ROWS" :class="input" data-testid="seat-arc-rows" />
            </div>
            <div class="sm:col-span-3">
              <label :class="lbl">1.ª fila</label>
              <input v-model.number="sec.seatsPerRow" type="number" min="1" :max="MAX_SEATS_PER_ROW" :class="input" aria-label="Asientos de la primera fila" />
            </div>
            <div class="sm:col-span-3">
              <label :class="lbl">+ por fila</label>
              <input v-model.number="sec.growth" type="number" min="0" :max="MAX_ARC_GROWTH" :class="input" aria-label="Asientos que suma cada fila" />
            </div>
            <div class="sm:col-span-3">
              <label :class="lbl">Bloques</label>
              <input v-model.number="sec.blocks" type="number" min="1" :max="MAX_ARC_BLOCKS" :class="input" aria-label="Bloques separados por pasillos" />
            </div>
          </template>
        </div>
        <p class="mt-2 text-xs text-gray-500">
          {{ counts[normalized?.sections[i]?.id] || 0 }} asientos<span v-if="sec.removed?.length"> · {{ sec.removed.length }} quitados</span>
          <span v-if="sec.layout === 'arc'"> · cada fila hacia atrás suma asientos porque el arco es más largo; los bloques los separan pasillos</span>
        </p>
      </div>
      <button v-if="local.sections.length < MAX_SECTIONS" type="button" class="text-sm text-blue-600 font-medium hover:underline flex items-center gap-1" @click="addSection">
        <Plus size="14" /> Agregar sección (con otro precio, p. ej. Preferencial o Balcón)
      </button>
    </div>
  </div>
</template>
