<script setup>
// "¿Las entradas son numeradas?" (paso Entradas del formulario del evento). Al marcarlo, cada ubicación arma su mapa
// de asientos (SeatMapEditor): parte del último mapa guardado de esa sala o de una plantilla. Las entradas pasan a
// tener cupo según los asientos (SeatTicketFields).
import { watch } from 'vue'
import { Armchair } from 'lucide-vue-next'
import SeatMapEditor from './SeatMapEditor.vue'
import { normalizeSeatMap } from '../../lib/seatMap.mjs'

const props = defineProps({
  seated: { type: Boolean, default: false },
  locations: { type: Array, required: true },
  venues: { type: Array, default: () => [] },
  // Nombre de la ubicación para el título del mapa
  venueNameFor: { type: Function, default: () => '' },
})
const emit = defineEmits(['update:seated'])

// Mapa inicial de una ubicación: el último guardado de su sala, si lo hay
function savedMapOf(loc) {
  if (loc.isNewVenue) return null
  const v = props.venues.find((x) => String(x.id) === String(loc.venueId))
  return normalizeSeatMap(v?.seat_map)
}
function ensureMaps() {
  if (!props.seated) return
  for (const loc of props.locations) if (!loc.seatMap) loc.seatMap = savedMapOf(loc)
}
watch(() => [props.seated, props.locations.length], ensureMaps, { immediate: true })
// Al cambiar la sala de una ubicación se propone el mapa guardado de la nueva sala (si tiene)
watch(() => props.locations.map((l) => `${l.id}:${l.venueId}`).join(','), (now, before) => {
  if (!props.seated || !before) return
  const prev = new Map(before.split(',').map((p) => p.split(':')))
  for (const loc of props.locations) {
    if (prev.get(String(loc.id)) === String(loc.venueId)) continue
    const saved = savedMapOf(loc)
    if (saved) loc.seatMap = saved
  }
})
</script>

<template>
  <div class="p-4 sm:p-6 bg-gray-50 rounded-xl border border-gray-200 space-y-4" data-testid="seating-settings">
    <label class="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" :checked="seated" class="mt-1 h-4 w-4 accent-black" data-testid="seated-toggle" @change="emit('update:seated', $event.target.checked)" />
      <span>
        <span class="font-bold flex items-center gap-1.5"><Armchair size="16" /> Entradas numeradas</span>
        <span class="text-sm text-gray-500">Quienes compran eligen su asiento en el mapa de la sala. Cada asiento se vende una sola vez por función y sale impreso en la entrada.</span>
      </span>
    </label>

    <template v-if="seated">
      <SeatMapEditor
        v-for="(loc, i) in locations"
        :key="`${loc.id}:${loc.venueId}`"
        :model-value="loc.seatMap"
        :title="locations.length > 1 ? `Mapa de ${venueNameFor(loc) || `la ubicación ${i + 1}`}` : `Mapa de asientos${venueNameFor(loc) ? ` · ${venueNameFor(loc)}` : ''}`"
        @update:model-value="(m) => (loc.seatMap = m)"
      />
      <p class="text-xs text-gray-500">El mapa queda guardado en la sala: el próximo evento ahí parte de este mismo mapa.</p>
    </template>
  </div>
</template>
