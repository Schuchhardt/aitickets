<script setup>
// "¿Olvidaste tu contraseña?" → POST /api/auth/magic-link { email, purpose: 'recovery' }.
// El servidor siempre responde un mensaje genérico (no revela si la cuenta existe).
import { ref, onMounted } from 'vue'

const props = defineProps({
  turnstileSiteKey: { type: String, default: '' },
})

const email = ref('')
const loading = ref(false)
const errorMsg = ref('')
const sent = ref(false)
const sentMsg = ref('')
const turnstileToken = ref('')
const turnstileWidgetId = ref(null)

onMounted(() => {
  try {
    const params = new URLSearchParams(window.location.search)
    const e = params.get('email')
    if (e) email.value = e
  } catch (e) { /* sin URL */ }

  if (!props.turnstileSiteKey) return
  const render = () => {
    turnstileWidgetId.value = window.turnstile.render('#cf-turnstile-recover', {
      sitekey: props.turnstileSiteKey,
      callback: (token) => { turnstileToken.value = token },
    })
  }
  if (window.turnstile) return render()
  const interval = setInterval(() => {
    if (window.turnstile) {
      clearInterval(interval)
      render()
    }
  }, 100)
  setTimeout(() => clearInterval(interval), 10000)
})

const resetTurnstile = () => {
  if (window.turnstile && turnstileWidgetId.value !== null) {
    try { window.turnstile.reset(turnstileWidgetId.value) } catch (e) { /* widget ya no existe */ }
    turnstileToken.value = ''
  }
}

const submit = async () => {
  errorMsg.value = ''
  const value = email.value.trim()
  if (!value) {
    errorMsg.value = 'Ingresa tu correo.'
    return
  }
  if (props.turnstileSiteKey && !turnstileToken.value) {
    errorMsg.value = 'Completa la verificación de seguridad.'
    return
  }
  loading.value = true
  try {
    const res = await fetch('/api/auth/magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: value, purpose: 'recovery', cfToken: turnstileToken.value || undefined }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      errorMsg.value = data.message || 'No pudimos enviar el enlace. Intenta de nuevo.'
      resetTurnstile()
      return
    }
    sent.value = true
    sentMsg.value = data.message || 'Si el correo corresponde a una cuenta, te enviamos un enlace para ingresar.'
  } catch (e) {
    errorMsg.value = 'Error de conexión. Revisa tu internet e intenta de nuevo.'
    resetTurnstile()
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="w-full max-w-md mx-auto bg-white/10 backdrop-blur-xl p-8 rounded-xl shadow-2xl border border-white/20 font-[Prompt]" data-testid="recover-form">
    <template v-if="!sent">
      <h2 class="text-2xl font-bold mb-2 text-center font-[Unbounded] text-white">¿Olvidaste tu contraseña?</h2>
      <p class="text-center text-sm text-white/70 mb-6">
        Te enviaremos un enlace para ingresar directo a tu panel. Luego podrás crear una nueva contraseña.
      </p>

      <form class="space-y-4" novalidate @submit.prevent="submit">
        <div>
          <label for="recover-email" class="block text-sm font-medium text-white/80 mb-1">Email</label>
          <input
            id="recover-email"
            v-model="email"
            type="email"
            required
            autocomplete="email"
            class="w-full px-4 py-2 border border-white/20 bg-white/10 text-white placeholder-white/40 rounded-lg focus:ring-2 focus:ring-white/50 focus:border-transparent outline-none transition"
            placeholder="tu@email.com"
          />
        </div>

        <div v-if="turnstileSiteKey" id="cf-turnstile-recover" class="flex justify-center"></div>

        <div v-if="errorMsg" class="p-3 bg-red-500/20 text-red-200 text-sm rounded-lg border border-red-400/30" role="alert">
          {{ errorMsg }}
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full bg-white text-gray-900 font-medium py-3 rounded-lg hover:bg-white/90 transition active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed flex justify-center items-center gap-2"
          data-testid="recover-submit"
        >
          <span v-if="loading" class="w-5 h-5 border-2 border-gray-400/30 border-t-gray-600 rounded-full animate-spin"></span>
          {{ loading ? 'Enviando...' : 'Enviarme un enlace' }}
        </button>
      </form>
    </template>

    <div v-else class="text-center" data-testid="recover-sent">
      <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-lime-400/20 text-lime-300">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
      </div>
      <h2 class="text-2xl font-bold mb-3 font-[Unbounded] text-white">Revisa tu correo</h2>
      <p class="text-white/70 mb-6">{{ sentMsg }}</p>
      <button type="button" class="text-sm font-medium text-white/80 underline hover:text-white" @click="sent = false">
        Usar otro correo
      </button>
    </div>

    <div class="mt-6 text-center text-sm text-white/60">
      ¿La recordaste?
      <a href="/organizadores/login" class="font-medium text-white hover:underline">Inicia sesión</a>
    </div>
  </div>
</template>
