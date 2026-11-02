<script setup>
// Campos de una entrada cuando las entradas son numeradas: en qué secciones del mapa vale (para precios por zona) y su
// cupo, que sale de los asientos (no se escribe a mano). El servidor lo recalcula al guardar.
import { computed, watch } from 'vue'
import { seatedTicketCapacity } from '../../lib/seatMap.mjs'

const props = defineProps({
  ticket: { type: Object, required: true },
  locations: { type: Array, required: true },
})

// Mapa de cada función del formulario (id real o temporal)
const mapsByDate = computed(() => {
  const out = new Map()
  for (const loc of props.locations) for (const d of loc.dates || []) if (loc.seatMap) out.set(String(d.id), loc.seatMap)
  return out
})
// Secciones de los mapas (por id; con nombre)
const sections = computed(() => {
  const byId = new Map()
  for (const loc of props.locations) for (const s of loc.seatMap?.sections || []) if (!byId.has(s.id)) byId.set(s.id, s.name)
  return [...byId].map(([id, name]) => ({ id, name }))
})
const selected = computed(() => (Array.isArray(props.ticket.seatSections) ? props.ticket.seatSections : []))
const capacity = computed(() =>
  seatedTicketCapacity({ event_date_id: props.ticket.eventDateId || null, seat_sections: selected.value.length ? selected.value : null }, mapsByDate.value),
)
const functionsCount = computed(() => (props.ticket.eventDateId ? 1 : mapsByDate.value.size))

watch(capacity, (n) => {
  props.ticket.quantity = n
  props.ticket.peoplePerTicket = 1
}, { immediate: true })

function toggle(id) {
  const next = selected.value.includes(id) ? selected.value.filter((x) => x !== id) : [...selected.value, id]
  // Todas marcadas = sin restricción
  props.ticket.seatSections = next.length && next.length < sections.value.length ? next : null
}
const isOn = (id) => !selected.value.length || selected.value.includes(id)
</script>

<template>
  <div class="col-span-2 space-y-2" data-testid="seat-ticket-fields">
    <div v-if="sections.length > 1">
      <p class="block text-xs font-bold text-gray-500 uppercase mb-1">Vale en</p>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="s in sections"
          :key="s.id"
          type="button"
          class="px-3 py-1 text-sm rounded-full border transition-colors"
          :class="isOn(s.id) ? 'bg-black text-white border-black' : 'bg-white text-gray-600 border-gray-300'"
          :aria-pressed="isOn(s.id) ? 'true' : 'false'"
          @click="toggle(s.id)"
        >{{ s.name }}</button>
      </div>
    </div>
    <p class="text-xs text-gray-500">
      Cupo: <strong class="text-gray-800">{{ capacity }}</strong> según los asientos del mapa<span v-if="functionsCount > 1"> ({{ functionsCount }} funciones)</span>.
      <span v-if="sections.length > 1"> Para cobrar distinto por zona, crea una entrada por sección.</span>
    </p>
  </div>
</template>
