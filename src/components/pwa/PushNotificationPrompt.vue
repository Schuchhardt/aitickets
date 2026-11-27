<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Bell, X } from 'lucide-vue-next'
import { usePushNotifications } from '../../composables/usePushNotifications'

const DISMISS_KEY = 'ait:push-prompt-dismissed'
const DISMISS_DAYS = 7

const { supported, permission, subscribed, loading, subscribe } = usePushNotifications()
const dismissed = ref(true)
const success = ref(false)
const error = ref('')

const visible = computed(() => {
  if (!supported.value || dismissed.value || success.value) return false
  if (permission.value !== 'default' || subscribed.value) return false
  return true
})

const isDismissedRecently = (): boolean => {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return false
    const ts = parseInt(raw, 10)
    return Date.now() - ts < DISMISS_DAYS * 24 * 60 * 60 * 1000
  } catch {
    return false
  }
}

const dismiss = () => {
  dismissed.value = true
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
  } catch { /* private browsing */ }
}

const activate = async () => {
  error.value = ''
  try {
    await subscribe()
    success.value = true
    setTimeout(() => { dismissed.value = true }, 2500)
  } catch {
    error.value = 'No se pudieron activar. Revisa los permisos de tu navegador.'
  }
}

onMounted(() => {
  dismissed.value = isDismissedRecently()
})
</script>

<template>
  <div v-if="success" class="rounded-xl bg-lime-500/10 border border-lime-500/20 p-4 font-[Prompt] flex items-center gap-3">
    <Bell :size="20" class="text-lime-500 shrink-0" />
    <p class="text-sm text-lime-700">Notificaciones activadas</p>
  </div>

  <div
    v-else-if="visible"
    class="rounded-xl bg-white border border-gray-200 shadow-sm p-4 font-[Prompt]"
  >
    <div class="flex items-start gap-3">
      <div class="w-9 h-9 rounded-full bg-lime-500/10 flex items-center justify-center shrink-0 mt-0.5">
        <Bell :size="18" class="text-lime-600" />
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-sm text-gray-800 leading-snug">
          Activa las notificaciones para enterarte al instante de ventas, mensajes y pagos
        </p>
        <p v-if="error" class="text-xs text-red-600 mt-1">{{ error }}</p>
        <div class="flex items-center gap-3 mt-3">
          <button
            @click="activate"
            :disabled="loading"
            class="inline-flex items-center gap-1.5 bg-lime-500 text-white text-sm font-semibold px-4 py-1.5 rounded-lg hover:bg-lime-600 transition-colors disabled:opacity-50"
          >
            <Bell v-if="!loading" :size="14" />
            <svg v-else class="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Activar
          </button>
          <button
            @click="dismiss"
            class="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Ahora no
          </button>
        </div>
      </div>
      <button
        @click="dismiss"
        class="shrink-0 p-1 text-gray-400 hover:text-gray-600 transition-colors"
        aria-label="Cerrar"
      >
        <X :size="16" />
      </button>
    </div>
  </div>
</template>
