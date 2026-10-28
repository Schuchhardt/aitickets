<script setup>
import { ref, computed, onMounted } from 'vue'
import { CalendarClock, Plus, Trash2 } from 'lucide-vue-next'

// Agenda del evento (/api/events/agenda → get_event_agenda / update_event_agenda, src/lib/eventAgenda.mjs): bloques
// con hora, título, expositores y sala, de una función (día) o de todas. Se guarda la agenda completa; la página del
// evento la muestra por día en la sección "Agenda" (solo si hay bloques).

const props = defineProps({
  eventId: { type: Number, required: true },
})

const functions = ref([])
const blocks = ref([])
const loading = ref(true)
const unavailable = ref(false)
const saving = ref(false)
const error = ref('')
const saved = ref(false)
const dirty = ref(false)

const multi = computed(() => functions.value.length > 1)
const blank = (fnId = null) => ({ function_id: fnId, start: '', end: '', title: '', speakers: '', room: '' })

const load = async () => {
  loading.value = true
  try {
    const res = await fetch(`/api/events/agenda?event_id=${props.eventId}`)
    const body = await res.json().catch(() => ({}))
    if (res.status === 503) unavailable.value = true
    if (!res.ok) throw new Error(body?.error?.message || 'No se pudo cargar la agenda')
    functions.value = body.data.functions || []
    blocks.value = (body.data.blocks || []).map((b) => ({ ...b, end: b.end || '', speakers: b.speakers || '', room: b.room || '' }))
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

const touch = () => {
  dirty.value = true
  saved.value = false
}
const add = () => {
  // El bloque nuevo hereda el día del último: así se carga un día completo seguido
  const last = blocks.value[blocks.value.length - 1]
  blocks.value.push(blank(last ? last.function_id : multi.value ? functions.value[0]?.id ?? null : null))
  touch()
}
const remove = (i) => {
  blocks.value.splice(i, 1)
  touch()
}

const save = async () => {
  error.value = ''
  saving.value = true
  try {
    const payload = blocks.value.map((b) => ({
      function_id: b.function_id === '' || b.function_id == null ? null : Number(b.function_id),
      start: b.start,
      end: b.end || null,
      title: b.title,
      speakers: b.speakers || null,
      room: b.room || null,
    }))
    const res = await fetch('/api/events/agenda', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: props.eventId, blocks: payload }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body?.error?.message || 'No se pudo guardar la agenda')
    blocks.value = (body.data.blocks || []).map((b) => ({ ...b, end: b.end || '', speakers: b.speakers || '', room: b.room || '' }))
    dirty.value = false
    saved.value = true
  } catch (e) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="bg-white p-4 sm:p-6 rounded-xl border border-gray-200 shadow-sm" data-testid="event-agenda-manager">
    <h3 class="font-bold text-lg mb-1 flex items-center gap-2"><CalendarClock :size="18" /> Agenda</h3>
    <p class="text-sm text-gray-500 mb-4">
      Cada bloque con su hora, expositores y sala{{ multi ? ', en el día que corresponde' : '' }}. En la página del evento se ve
      como una agenda por día, y el asistente de tu página la usa para responder "¿a qué hora es el panel?".
    </p>

    <p v-if="unavailable" class="text-sm text-amber-700">La agenda estará disponible en unos minutos.</p>
    <p v-else-if="loading" class="text-sm text-gray-500">Cargando…</p>

    <template v-else>
      <p v-if="!blocks.length" class="text-sm text-gray-500 mb-3">Todavía no hay bloques. Sin bloques, la página no muestra la agenda.</p>
      <ul class="space-y-3">
        <li v-for="(b, i) in blocks" :key="i" class="rounded-lg border border-gray-200 p-3 space-y-2" data-testid="agenda-block">
          <div class="flex flex-wrap items-end gap-2">
            <label v-if="multi" class="block">
              <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Día</span>
              <select v-model="b.function_id" @change="touch" class="bg-gray-50 border border-gray-200 text-sm rounded-lg px-2 py-2 outline-none focus:ring-2 focus:ring-black">
                <option :value="null">Todos los días</option>
                <option v-for="f in functions" :key="f.id" :value="f.id">{{ f.label }}</option>
              </select>
            </label>
            <label class="block">
              <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Desde</span>
              <input v-model="b.start" @input="touch" type="time" required class="bg-gray-50 border border-gray-200 text-sm rounded-lg px-2 py-2 outline-none focus:ring-2 focus:ring-black" />
            </label>
            <label class="block">
              <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Hasta</span>
              <input v-model="b.end" @input="touch" type="time" class="bg-gray-50 border border-gray-200 text-sm rounded-lg px-2 py-2 outline-none focus:ring-2 focus:ring-black" />
            </label>
            <button type="button" @click="remove(i)" class="ml-auto p-2 text-gray-400 hover:text-red-600" :aria-label="`Quitar el bloque ${i + 1}`">
              <Trash2 :size="16" />
            </button>
          </div>
          <input v-model="b.title" @input="touch" type="text" maxlength="160" placeholder="Título. Ej: Panel: IA en la empresa" aria-label="Título del bloque"
            class="w-full bg-gray-50 border border-gray-200 text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-black" />
          <div class="grid gap-2 sm:grid-cols-[1fr_12rem]">
            <input v-model="b.speakers" @input="touch" type="text" maxlength="300" placeholder="Expositores. Ej: Ana Pérez (Empresa X)" aria-label="Expositores"
              class="w-full bg-gray-50 border border-gray-200 text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-black" />
            <input v-model="b.room" @input="touch" type="text" maxlength="80" placeholder="Sala" aria-label="Sala"
              class="w-full bg-gray-50 border border-gray-200 text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-black" />
          </div>
        </li>
      </ul>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" @click="add" class="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center gap-1" data-testid="agenda-add">
          <Plus :size="16" /> Agregar bloque
        </button>
        <button type="button" @click="save" :disabled="saving || !dirty" class="px-4 py-2 bg-black text-white rounded-lg text-sm font-medium hover:bg-gray-900 transition disabled:opacity-60" data-testid="agenda-save">
          {{ saving ? 'Guardando…' : 'Guardar agenda' }}
        </button>
        <span v-if="saved" class="text-sm text-green-700">Guardada. Ya se ve en la página.</span>
      </div>
      <p v-if="error" class="mt-2 text-sm text-red-600" role="alert">{{ error }}</p>
    </template>
  </div>
</template>
