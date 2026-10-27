<script setup>
import { ref } from 'vue'
import { SlidersHorizontal, ChevronDown } from 'lucide-vue-next'

// "Más herramientas" del detalle del evento: lista los módulos opcionales que aplican a este evento y permite
// activarlos o apagarlos (events.panel_modules vía /api/events/modules). Lo que viene por defecto depende del perfil
// del evento (su categoría); registro en src/lib/eventModules.ts.

const props = defineProps({
  eventId: { type: Number, required: true },
  profileLabel: { type: String, required: true },
  // [{ id, title, description, tabLabel, enabled, suggested }]
  modules: { type: Array, required: true },
})

const open = ref(false)
const busyId = ref(null)
const error = ref('')

const toggle = async (m) => {
  const next = !m.enabled
  busyId.value = m.id
  error.value = ''
  try {
    const res = await fetch('/api/events/modules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Volver al valor sugerido no guarda nada: si cambia la categoría, el módulo sigue al perfil nuevo
      body: JSON.stringify({ eventId: props.eventId, moduleId: m.id, enabled: next === m.suggested ? null : next }),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'No se pudo guardar')
    window.location.reload()
  } catch (e) {
    error.value = e.message || 'Error de conexión'
    busyId.value = null
  }
}
</script>

<template>
  <section class="bg-white rounded-xl border border-gray-200 shadow-sm" data-testid="event-modules">
    <button
      type="button"
      class="w-full flex items-center justify-between gap-3 p-4 sm:p-6 text-left"
      :aria-expanded="open"
      @click="open = !open"
    >
      <div class="min-w-0">
        <h3 class="font-bold text-lg flex items-center gap-2"><SlidersHorizontal :size="18" /> Más herramientas</h3>
        <p class="text-sm text-gray-500">
          Mostramos lo que suele usarse en {{ profileLabel }}. Activa o apaga herramientas para este evento.
        </p>
      </div>
      <ChevronDown :size="20" class="shrink-0 text-gray-500 transition" :class="open ? 'rotate-180' : ''" />
    </button>
    <div v-if="open" class="border-t border-gray-100 divide-y divide-gray-100">
      <label
        v-for="m in modules"
        :key="m.id"
        class="flex items-center justify-between gap-4 p-4 cursor-pointer hover:bg-gray-50"
      >
        <div class="min-w-0">
          <p class="font-medium text-gray-900">
            {{ m.title }}
            <span class="ml-1 text-xs font-normal text-gray-400">· {{ m.tabLabel }}</span>
          </p>
          <p class="text-sm text-gray-500">{{ m.description }}</p>
        </div>
        <input
          type="checkbox"
          class="w-5 h-5 shrink-0 rounded border-gray-300 accent-black"
          :checked="m.enabled"
          :disabled="busyId !== null"
          :data-module="m.id"
          @change.prevent="toggle(m)"
        />
      </label>
      <p v-if="error" class="p-4 text-sm text-red-600">{{ error }}</p>
    </div>
  </section>
</template>
