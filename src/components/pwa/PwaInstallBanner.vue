<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Download, X, Share } from 'lucide-vue-next'

const emit = defineEmits<{ installed: [] }>()

const DISMISS_KEY = 'ait:pwa-banner-dismissed'
const DISMISS_DAYS = 30

const deferredPrompt = ref<any>(null)
const dismissed = ref(true)
const isStandalone = ref(false)
const isIos = ref(false)
const showIosHint = ref(false)

const visible = computed(() => {
  if (isStandalone.value || dismissed.value) return false
  return !!deferredPrompt.value || isIos.value
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

const install = async () => {
  if (isIos.value) {
    showIosHint.value = !showIosHint.value
    return
  }
  if (!deferredPrompt.value) return
  try {
    deferredPrompt.value.prompt()
    const { outcome } = await deferredPrompt.value.userChoice
    if (outcome === 'accepted') {
      emit('installed')
      dismiss()
    }
  } catch { /* user cancelled */ }
  deferredPrompt.value = null
}

const onBeforeInstallPrompt = (e: Event) => {
  e.preventDefault()
  deferredPrompt.value = e
}

onMounted(() => {
  isStandalone.value = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as any).standalone === true
  isIos.value = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream
  dismissed.value = isDismissedRecently()
  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
})

onUnmounted(() => {
  window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
})
</script>

<template>
  <div
    v-if="visible"
    class="w-full bg-gray-900 text-white px-4 py-3 font-[Prompt]"
  >
    <div class="max-w-xl mx-auto flex items-center gap-3">
      <img src="/android-chrome-192x192.png" alt="AI Tickets" class="w-8 h-8 rounded-lg shrink-0" />
      <p class="text-sm flex-1 min-w-0">Instala la app para acceder más rápido</p>
      <button
        @click="install"
        class="shrink-0 inline-flex items-center gap-1.5 bg-lime-500 text-gray-900 text-sm font-semibold px-3 py-1.5 rounded-lg hover:bg-lime-400 transition-colors"
      >
        <Download :size="16" />
        Instalar
      </button>
      <button
        @click="dismiss"
        class="shrink-0 p-1 text-gray-400 hover:text-white transition-colors"
        aria-label="Cerrar"
      >
        <X :size="18" />
      </button>
    </div>
    <div v-if="showIosHint && isIos" class="max-w-xl mx-auto mt-2 text-sm text-gray-300 flex items-center gap-2">
      <Share :size="16" class="shrink-0 text-lime-400" />
      <span>Toca el ícono de compartir en Safari y luego <strong>"Agregar a pantalla de inicio"</strong></span>
    </div>
  </div>
</template>
