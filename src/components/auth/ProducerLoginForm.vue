<script setup>
import { ref } from 'vue'
import { Eye, EyeOff } from 'lucide-vue-next'

const email = ref('')
const password = ref('')
const loading = ref(false)
const errorMsg = ref('')
const showPassword = ref(false)

const togglePassword = () => {
  showPassword.value = !showPassword.value
}

const handleLogin = async () => {
  try {
    loading.value = true
    errorMsg.value = ''
   
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
  <div class="w-full max-w-md mx-auto bg-white p-8 rounded-xl shadow-lg border border-gray-100">
    <h2 class="text-2xl font-bold mb-6 text-center font-[Unbounded]">Acceso Productores</h2>
    
    <form @submit.prevent="handleLogin" class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Email</label>
        <input 
          v-model="email" 
          type="email" 
          required
          class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent outline-none transition"
          placeholder="tu@email.com"
        />
      </div>
      
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Contraseña</label>
        <div class="relative">
          <input 
            v-model="password" 
            :type="showPassword ? 'text' : 'password'" 
            required
            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent outline-none transition"
            placeholder="••••••••"
          />
          <button 
            type="button" 
            @click="togglePassword"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <component :is="showPassword ? EyeOff : Eye" size="20" />
          </button>
        </div>
      </div>
      
      <div v-if="errorMsg" class="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100 flex items-center gap-2">
        <span class="font-bold">Error:</span> {{ errorMsg }}
      </div>
      
      <button 
        type="submit" 
        :disabled="loading"
        class="w-full bg-black text-white font-medium py-3 rounded-lg hover:bg-gray-800 transition active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed flex justify-center items-center gap-2"
      >
        <span v-if="loading" class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
        {{ loading ? 'Iniciando sesión...' : 'Ingresar' }}
      </button>
    </form>
    
    <div class="mt-6 text-center text-sm text-gray-600">
      ¿No tienes cuenta? 
      <a href="/organizadores/registro" class="font-medium text-black hover:underline">Regístrate aquí</a>
    </div>
  </div>
</template>
