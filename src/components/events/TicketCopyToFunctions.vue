<script setup>
// "Copiar las entradas a cada función": cada función queda con su propio cupo (functionRepeat.js).
import { computed, ref } from 'vue'
import { Copy } from 'lucide-vue-next'
import { planTicketCopy } from './functionRepeat'

const props = defineProps({
  tickets: { type: Array, required: true },
  functionIds: { type: Array, required: true },
  canPin: { type: Function, default: () => true },
})
const emit = defineEmits(['apply'])
const done = ref('')

const plan = computed(() => planTicketCopy(props.tickets, props.functionIds, { canPin: props.canPin }))
const names = computed(() => plan.value.template.map((t) => t.name || 'sin nombre').join(', '))

const apply = () => {
  if (plan.value.error) return
  const created = plan.value.template.length * plan.value.targets.length
  emit('apply')
  done.value = `Listo: ${created} ${created === 1 ? 'entrada creada' : 'entradas creadas'}. Revisa precios y cupos abajo.`
}
</script>

<template>
  <div v-if="done || !plan.error || plan.pinBlocked" class="text-sm bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2" data-testid="ticket-copy">
    <p v-if="done" class="text-green-700">{{ done }}</p>
    <template v-if="!plan.error">
      <p class="text-gray-700">
        ¿Cada función con su propio cupo? Copia {{ names }} a
        {{ plan.targets.length }} {{ plan.targets.length === 1 ? 'función que aún no tiene' : 'funciones que aún no tienen' }} entradas propias.
        <template v-if="plan.pinTo != null"> Las de «Todas las funciones» pasan a ser de la primera función.</template>
      </p>
      <button type="button" @click="apply" class="px-3 py-1.5 rounded-lg bg-black text-white font-medium flex items-center gap-1.5">
        <Copy size="14" /> Copiar a cada función
      </button>
    </template>
    <p v-else-if="!done" class="text-gray-500">{{ plan.error }}</p>
  </div>
</template>
