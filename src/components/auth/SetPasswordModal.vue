<script setup>
// Modal para crear una contraseña nueva después de entrar con un enlace de acceso
// (recuperar / cambiar contraseña). No pide la contraseña actual: el servidor exige la sesión y la
// cookie aitickets_pw_reset que deja /auth/link. Se monta en DashboardLayout cuando la URL trae
// ?set_password=1.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { Eye, EyeOff, KeyRound, CircleCheck, X } from 'lucide-vue-next'

const props = defineProps({
  // false si la cookie del enlace ya venció (o no existe): se ofrece pedir un enlace nuevo
  canSet: { type: Boolean, default: true },
})

const MIN = 8
const open = ref(true)
const password = ref('')
const confirm = ref('')
const show = ref(false)
const loading = ref(false)
const errorMsg = ref('')
const toast = ref('')
const inputRef = ref(null)

const tooShort = computed(() => password.value.length > 0 && password.value.length < MIN)
const mismatch = computed(() => confirm.value.length > 0 && confirm.value !== password.value)
const canSubmit = computed(() => password.value.length >= MIN && password.value === confirm.value && !loading.value)

function cleanUrl() {
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.has('set_password')) {
      url.searchParams.delete('set_password')
      window.history.replaceState(window.history.state, '', url.pathname + (url.search ? url.search : '') + url.hash)
    }
  } catch (e) { /* sin URL */ }
}

function close() {
  open.value = false
  cleanUrl()
}

function onKey(e) {
  if (e.key === 'Escape' && !loading.value) close()
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  setTimeout(() => inputRef.value?.focus?.(), 50)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

async function submit() {
  errorMsg.value = ''
  if (password.value.length < MIN) {
    errorMsg.value = `La contraseña debe tener al menos ${MIN} caracteres.`
    return
  }
  if (password.value !== confirm.value) {
    errorMsg.value = 'Las contraseñas no coinciden.'
    return
  }
  loading.value = true
  try {
    const res = await fetch('/api/auth/set-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password.value }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      errorMsg.value = data.message || 'No pudimos guardar tu contraseña. Intenta de nuevo.'
      return
    }
    password.value = ''
    confirm.value = ''
    open.value = false
    cleanUrl()
    toast.value = data.message || '¡Listo! Tu contraseña quedó actualizada.'
    setTimeout(() => { toast.value = '' }, 5000)
  } catch (e) {
    errorMsg.value = 'Error de conexión. Revisa tu internet e intenta de nuevo.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div>
    <div
      v-if="open"
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="set-password-title"
      data-testid="set-password-modal"
      @click.self="!loading && close()"
    >
      <div class="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-200 p-6 relative font-[Prompt]">
        <button
          type="button"
          class="absolute right-4 top-4 text-gray-400 hover:text-gray-700"
          aria-label="Cerrar"
          :disabled="loading"
          @click="close"
        >
          <X :size="20" />
        </button>

        <div class="w-12 h-12 rounded-full bg-lime-100 text-lime-700 flex items-center justify-center mb-4">
          <KeyRound :size="22" />
        </div>

        <template v-if="canSet">
          <h2 id="set-password-title" class="text-xl font-bold font-[Unbounded] mb-1">Crea tu nueva contraseña</h2>
          <p class="text-sm text-gray-500 mb-5">Ya ingresaste a tu cuenta. Elige una contraseña nueva para tus próximos ingresos.</p>

          <form class="space-y-4" novalidate @submit.prevent="submit">
            <div>
              <label for="sp-password" class="block text-sm font-medium text-gray-700 mb-1">Nueva contraseña</label>
              <div class="relative">
                <input
                  id="sp-password"
                  ref="inputRef"
                  v-model="password"
                  :type="show ? 'text' : 'password'"
                  autocomplete="new-password"
                  :minlength="MIN"
                  maxlength="72"
                  required
                  :placeholder="`Mínimo ${MIN} caracteres`"
                  class="w-full px-4 py-2 pr-11 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-black outline-none transition-all"
                  data-testid="set-password-input"
                />
                <button
                  type="button"
                  class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                  :aria-label="show ? 'Ocultar contraseña' : 'Mostrar contraseña'"
                  @click="show = !show"
                >
                  <component :is="show ? EyeOff : Eye" :size="20" />
                </button>
              </div>
              <p v-if="tooShort" class="mt-1 text-xs text-amber-700">Faltan {{ MIN - password.length }} caracteres.</p>
            </div>

            <div>
              <label for="sp-confirm" class="block text-sm font-medium text-gray-700 mb-1">Confirmar contraseña</label>
              <input
                id="sp-confirm"
                v-model="confirm"
                :type="show ? 'text' : 'password'"
                autocomplete="new-password"
                maxlength="72"
                required
                placeholder="Repite la contraseña"
                class="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-black outline-none transition-all"
                data-testid="set-password-confirm"
              />
              <p v-if="mismatch" class="mt-1 text-xs text-red-600">Las contraseñas no coinciden.</p>
            </div>

            <div v-if="errorMsg" class="p-3 rounded-lg border bg-red-50 text-red-800 border-red-200 text-sm" role="alert">
              {{ errorMsg }}
            </div>

            <div class="flex flex-col-reverse sm:flex-row gap-2 pt-1">
              <button
                type="button"
                class="sm:flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium"
                :disabled="loading"
                @click="close"
              >
                Más tarde
              </button>
              <button
                type="submit"
                class="sm:flex-1 px-4 py-2.5 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                :disabled="!canSubmit"
                data-testid="set-password-submit"
              >
                <span v-if="loading" class="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></span>
                {{ loading ? 'Guardando...' : 'Guardar contraseña' }}
              </button>
            </div>
            <p class="text-xs text-gray-400">Por seguridad, este paso está disponible durante 15 minutos después de abrir el enlace.</p>
          </form>
        </template>

        <template v-else>
          <h2 id="set-password-title" class="text-xl font-bold font-[Unbounded] mb-1">El enlace ya no sirve para cambiar la contraseña</h2>
          <p class="text-sm text-gray-500 mb-5">Pasaron más de 15 minutos desde que lo abriste. Pide un enlace nuevo desde Mi Perfil y ábrelo desde tu correo.</p>
          <div class="flex flex-col-reverse sm:flex-row gap-2">
            <button type="button" class="sm:flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium" @click="close">Cerrar</button>
            <a href="/dashboard/profile#password" class="sm:flex-1 px-4 py-2.5 bg-black text-white rounded-lg hover:bg-gray-800 text-center font-medium">Ir a Mi Perfil</a>
          </div>
        </template>
      </div>
    </div>

    <transition
      enter-active-class="transition duration-200"
      enter-from-class="opacity-0 translate-y-2"
      leave-active-class="transition duration-200"
      leave-to-class="opacity-0 translate-y-2"
    >
      <div
        v-if="toast"
        class="fixed bottom-6 right-6 z-[110] flex items-center gap-2 rounded-xl bg-gray-900 text-white px-4 py-3 shadow-xl"
        role="status"
        data-testid="set-password-toast"
      >
        <CircleCheck :size="20" class="text-lime-400" />
        <span class="text-sm">{{ toast }}</span>
      </div>
    </transition>
  </div>
</template>
