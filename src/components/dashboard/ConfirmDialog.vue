<script setup>
// Modal de confirmación del panel. Reemplaza a window.confirm donde la acción tiene efecto público (p. ej.
// publicar u ocultar el sitio): explica qué va a pasar y deja cancelar. El foco parte en "Cancelar" (la opción
// segura), Esc cierra y, mientras `busy`, no se puede cerrar ni confirmar dos veces.
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, required: true },
  confirmLabel: { type: String, default: 'Confirmar' },
  cancelLabel: { type: String, default: 'Cancelar' },
  /** 'danger' pinta el botón de confirmar en rojo (acciones que quitan algo del público). */
  tone: { type: String, default: 'default' },
  busy: { type: Boolean, default: false },
  busyLabel: { type: String, default: 'Guardando…' },
  testId: { type: String, default: 'confirm-dialog' },
})
const emit = defineEmits(['confirm', 'cancel'])

const cancelButton = ref(null)
const titleId = `confirm-dialog-title-${Math.random().toString(36).slice(2, 9)}`
let previousFocus = null

function cancel() {
  if (!props.busy) emit('cancel')
}
function confirm() {
  if (!props.busy) emit('confirm')
}
function onKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
  }
}

watch(
  () => props.open,
  async (open) => {
    if (typeof window === 'undefined') return
    if (open) {
      previousFocus = document.activeElement
      window.addEventListener('keydown', onKeydown)
      await nextTick()
      cancelButton.value?.focus()
    } else {
      window.removeEventListener('keydown', onKeydown)
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus()
      previousFocus = null
    }
  }
)
onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="titleId"
    :data-testid="testId"
    @click.self="cancel"
  >
    <div class="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-gray-200 p-5 sm:p-6 relative">
      <button
        type="button"
        class="absolute right-4 top-4 p-1 rounded text-gray-400 hover:text-gray-700 disabled:opacity-50"
        aria-label="Cerrar"
        :disabled="busy"
        @click="cancel"
      >
        <X size="18" />
      </button>
      <h3 :id="titleId" class="text-lg font-bold pr-8">{{ title }}</h3>
      <div class="mt-3 text-sm text-gray-700 space-y-3">
        <slot />
      </div>
      <div class="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button
          ref="cancelButton"
          type="button"
          class="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          :disabled="busy"
          :data-testid="`${testId}-cancel`"
          @click="cancel"
        >
          {{ cancelLabel }}
        </button>
        <button
          type="button"
          class="px-4 py-2 text-sm rounded-lg text-white disabled:opacity-60"
          :class="tone === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-black hover:bg-gray-800'"
          :disabled="busy"
          :data-testid="`${testId}-confirm`"
          @click="confirm"
        >
          {{ busy ? busyLabel : confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>
