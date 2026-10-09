<script setup>
import { ref, computed, onMounted } from 'vue'
import { Eye, EyeOff } from 'lucide-vue-next'

const props = defineProps({
  googleEnabled: { type: Boolean, default: false },
})

const email = ref('')
const password = ref('')
const loading = ref(false)
const errorMsg = ref('')
const showPassword = ref(false)
// Correo sin confirmar: el login responde code 'email_not_verified' y se ofrece reenviar el enlace
const needsVerification = ref(false)
const resendLoading = ref(false)
const resendMsg = ref('')
const infoMsg = ref('')
// Destino tras iniciar sesión (?next=). Solo rutas internas del panel o de autorización OAuth: nunca otro
// sitio (evita redirecciones abiertas).
const nextPath = ref('/dashboard')
const safeNext = (raw) => (typeof raw === 'string' && /^\/(dashboard|oauth\/)/.test(raw) && !raw.startsWith('//') && !raw.includes('\\') ? raw : '/dashboard')
const nextQuery = computed(() => (nextPath.value && nextPath.value !== '/dashboard' ? `?next=${encodeURIComponent(nextPath.value)}` : ''))
const registerHref = computed(() => `/organizadores/registro${nextQuery.value}`)
const googleHref = computed(() => `/api/auth/google${nextQuery.value}`)

onMounted(() => {
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('verificado') === '1') infoMsg.value = '¡Correo confirmado! Ya puedes iniciar sesión.'
    nextPath.value = safeNext(params.get('next'))
    if (nextPath.value.startsWith('/oauth/') || nextPath.value.startsWith('/dashboard/ia')) infoMsg.value = 'Inicia sesión para conectar tu asistente de IA con AI Tickets.'
    const err = params.get('error')
    if (err === 'google_email_in_use') errorMsg.value = 'Ya tienes una cuenta con ese correo. Ingresa con tu contraseña (o recupérala).'
    else if (err === 'google') errorMsg.value = 'No pudimos completar el acceso con Google. Intenta de nuevo.'
  } catch (e) { /* sin URL */ }
})

const resendVerification = async () => {
  if (!email.value) {
    resendMsg.value = 'Ingresa tu correo para reenviar el enlace.'
    return
  }
  try {
    resendLoading.value = true
    resendMsg.value = ''
    const response = await fetch('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value.trim() }),
    })
    const data = await response.json().catch(() => ({}))
    resendMsg.value = data.message || (response.ok ? 'Listo. Revisa tu correo.' : 'No pudimos reenviar el enlace. Intenta más tarde.')
  } catch (e) {
    resendMsg.value = 'No pudimos reenviar el enlace. Revisa tu conexión e intenta de nuevo.'
  } finally {
    resendLoading.value = false
  }
}

const togglePassword = () => {
  showPassword.value = !showPassword.value
}

const handleLogin = async () => {
  try {
    loading.value = true
    errorMsg.value = ''
    needsVerification.value = false
    resendMsg.value = ''
   
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email.value,
        password: password.value,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      if (data.code === 'email_not_verified') needsVerification.value = true
      throw new Error(data.message || 'Error al iniciar sesión')
    }

    window.location.href = nextPath.value
  } catch (err) {
    errorMsg.value = err.message || 'Error al iniciar sesión'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="w-full max-w-md mx-auto bg-white/10 backdrop-blur-xl p-8 rounded-xl shadow-2xl border border-white/20">
    <h2 class="text-2xl font-bold mb-6 text-center font-[Unbounded] text-white">Acceso Productores</h2>

    <template v-if="googleEnabled">
      <a :href="googleHref" data-testid="login-google" class="w-full flex items-center justify-center gap-3 bg-white text-gray-900 rounded-lg py-3 px-4 hover:bg-white/90 transition font-medium">
        <svg viewBox="0 0 24 24" class="w-5 h-5" aria-hidden="true"><path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81z"/><path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.29 14.29A7.2 7.2 0 0 1 4.91 12c0-.79.14-1.56.38-2.29v-3.1H1.28a12 12 0 0 0 0 10.78l4.01-3.1z"/><path fill="#EA4335" d="M12 4.75c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.61l4.01 3.1C6.23 6.86 8.88 4.75 12 4.75z"/></svg>
        Continuar con Google
      </a>
      <p class="text-[11px] text-white/50 text-center mt-2">Si es tu primera vez, al continuar aceptas los <a href="/terminos-productores" target="_blank" rel="noopener" class="underline">Términos para productores</a>.</p>
      <div class="flex items-center gap-3 my-5 text-white/40 text-xs">
        <span class="flex-1 h-px bg-white/20"></span> o con tu correo <span class="flex-1 h-px bg-white/20"></span>
      </div>
    </template>
    
    <form @submit.prevent="handleLogin" class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-white/80 mb-1">Email</label>
        <input 
          v-model="email" 
          type="email" 
          required
          class="w-full px-4 py-2 border border-white/20 bg-white/10 text-white placeholder-white/40 rounded-lg focus:ring-2 focus:ring-white/50 focus:border-transparent outline-none transition"
          placeholder="tu@email.com"
        />
      </div>
      
      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="block text-sm font-medium text-white/80">Contraseña</label>
          <a
            :href="email ? `/organizadores/recuperar?email=${encodeURIComponent(email.trim())}` : '/organizadores/recuperar'"
            class="text-xs font-medium text-white/70 hover:text-white hover:underline"
            data-testid="login-forgot-password"
          >¿Olvidaste tu contraseña?</a>
        </div>
        <div class="relative">
          <input 
            v-model="password" 
            :type="showPassword ? 'text' : 'password'" 
            required
            class="w-full px-4 py-2 border border-white/20 bg-white/10 text-white placeholder-white/40 rounded-lg focus:ring-2 focus:ring-white/50 focus:border-transparent outline-none transition"
            placeholder="••••••••"
          />
          <button 
            type="button" 
            @click="togglePassword"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
          >
            <component :is="showPassword ? EyeOff : Eye" size="20" />
          </button>
        </div>
      </div>
      
      <div v-if="infoMsg && !errorMsg" class="p-3 bg-lime-400/15 text-lime-100 text-sm rounded-lg border border-lime-300/30" data-testid="login-info">
        {{ infoMsg }}
      </div>

      <div v-if="needsVerification" class="p-3 bg-amber-400/15 text-amber-100 text-sm rounded-lg border border-amber-300/30 space-y-2" data-testid="login-needs-verification">
        <p>{{ errorMsg }}</p>
        <button
          type="button"
          @click="resendVerification"
          :disabled="resendLoading"
          class="font-medium underline hover:text-white disabled:opacity-60"
          data-testid="login-resend-verification"
        >
          {{ resendLoading ? 'Enviando...' : 'Reenviar el correo de confirmación' }}
        </button>
        <p v-if="resendMsg" class="text-amber-50/90">{{ resendMsg }}</p>
      </div>
      <div v-else-if="errorMsg" class="p-3 bg-red-500/20 text-red-200 text-sm rounded-lg border border-red-400/30 flex items-center gap-2">
        <span class="font-bold">Error:</span> {{ errorMsg }}
      </div>
      
      <button 
        type="submit" 
        :disabled="loading"
        class="w-full bg-white text-gray-900 font-medium py-3 rounded-lg hover:bg-white/90 transition active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed flex justify-center items-center gap-2"
      >
        <span v-if="loading" class="w-5 h-5 border-2 border-gray-400/30 border-t-gray-600 rounded-full animate-spin"></span>
        {{ loading ? 'Iniciando sesión...' : 'Ingresar' }}
      </button>
    </form>
    
    <div class="mt-6 text-center text-sm text-white/60">
      ¿No tienes cuenta? 
      <a :href="registerHref" class="font-medium text-white hover:underline">Crea tu cuenta gratis</a>
    </div>
  </div>
</template>
