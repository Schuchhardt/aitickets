<script setup>
// "Repetir" en el editor de funciones: días de la semana, hora y período; crea todas las funciones de una vez.
// La lógica está en functionRepeat.js (planRepeat/applyRepeat), compartida por crear y editar evento.
import { ref, computed } from 'vue'
import { Repeat } from 'lucide-vue-next'
import { WEEKDAYS, MAX_FUNCTIONS, weekdaysLabel } from '../../lib/functionPattern.mjs'
import { planRepeat } from './functionRepeat'

const props = defineProps({
  locations: { type: Array, required: true },
  locIndex: { type: Number, required: true },
})
const emit = defineEmits(['apply'])

const open = ref(false)
const done = ref('')
const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())

const firstDate = () => props.locations[props.locIndex]?.dates.find((d) => d.date)
const pattern = ref({ weekdays: [], from: '', until: '', startTime: '20:00', endTime: '' })

const toggleOpen = () => {
  open.value = !open.value
  done.value = ''
  if (open.value && !pattern.value.from) {
    const first = firstDate()
    pattern.value.from = first?.date || todayKey()
    if (first?.startTime) pattern.value.startTime = String(first.startTime).slice(0, 5)
    if (first?.endTime) pattern.value.endTime = String(first.endTime).slice(0, 5)
  }
}

const toggleDay = (day) => {
  const set = new Set(pattern.value.weekdays)
  set.has(day) ? set.delete(day) : set.add(day)
  pattern.value.weekdays = [...set]
}

const plan = computed(() => planRepeat(props.locations, props.locIndex, pattern.value))
const touched = computed(() => pattern.value.weekdays.length > 0 && !!pattern.value.until)

const fmt = (key) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Intl.DateTimeFormat('es-CL', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(Date.UTC(y, m - 1, d, 12)))
}

const apply = () => {
  if (plan.value.error) return
  const count = plan.value.dates.length
  emit('apply', { ...pattern.value })
  done.value = `Listo: se agregaron ${count} ${count === 1 ? 'función' : 'funciones'} (${weekdaysLabel(pattern.value.weekdays)}).`
  open.value = false
}
</script>

<template>
  <div class="space-y-2" data-testid="function-repeat">
    <button type="button" @click="toggleOpen" class="text-sm text-blue-600 font-medium hover:underline flex items-center gap-1">
      <Repeat size="14" /> Repetir en varios días
    </button>
    <p v-if="done" class="text-sm text-green-700">{{ done }}</p>

    <div v-if="open" class="p-4 bg-white rounded-lg border border-gray-200 space-y-3">
      <div>
        <p class="text-xs font-bold text-gray-500 uppercase mb-2">Días</p>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="d in WEEKDAYS"
            :key="d.key"
            type="button"
            @click="toggleDay(d.day)"
            :aria-pressed="pattern.weekdays.includes(d.day)"
            :aria-label="d.key"
            class="w-9 h-9 rounded-full text-sm font-bold transition-colors"
            :class="pattern.weekdays.includes(d.day) ? 'bg-black text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
          >{{ d.short }}</button>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <label class="block">
          <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Desde</span>
          <input v-model="pattern.from" type="date" class="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none" />
        </label>
        <label class="block">
          <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Hasta</span>
          <input v-model="pattern.until" type="date" data-testid="repeat-until" class="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none" />
        </label>
        <label class="block">
          <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Hora de inicio</span>
          <input v-model="pattern.startTime" type="time" class="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none" />
        </label>
        <label class="block">
          <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Término (opcional)</span>
          <input v-model="pattern.endTime" type="time" class="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none" />
        </label>
      </div>

      <p v-if="touched && plan.error" class="text-sm text-red-600" data-testid="repeat-error">{{ plan.error }}</p>
      <p v-else-if="touched" class="text-sm text-gray-600" data-testid="repeat-preview">
        Se agregan {{ plan.dates.length }} {{ plan.dates.length === 1 ? 'función' : 'funciones' }}: {{ fmt(plan.dates[0]) }}<template v-if="plan.dates.length > 1"> → {{ fmt(plan.dates[plan.dates.length - 1]) }}</template>.
        <template v-if="plan.skipped"> {{ plan.skipped }} ya estaban.</template>
        Quedan {{ plan.total }} de {{ MAX_FUNCTIONS }} posibles.
      </p>

      <button
        type="button"
        @click="apply"
        :disabled="!touched || !!plan.error"
        class="px-4 py-2 rounded-lg bg-black text-white text-sm font-medium disabled:opacity-40"
      >Agregar funciones</button>
    </div>
  </div>
</template>
