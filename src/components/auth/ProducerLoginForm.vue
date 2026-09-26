<script setup>
import { ref, onMounted } from 'vue'
import { Eye, EyeOff } from 'lucide-vue-next'

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

onMounted(() => {
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('verificado') === '1') infoMsg.value = '¡Correo confirmado! Ya puedes iniciar sesión.'
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

    window.location.href = '/dashboard'
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
        <label class="block text-sm font-medium text-white/80 mb-1">Contraseña</label>
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
      <a href="/organizadores/registro" class="font-medium text-white hover:underline">Regístrate aquí</a>
    </div>
  </div>
</template>
