<script setup>
import { reactive, ref } from 'vue'

import * as z from 'zod'
import { Eye, EyeOff } from 'lucide-vue-next'

const props = defineProps({
  turnstileSiteKey: {
    type: String,
    required: true
  }
})

const showPassword = ref(false)

const loading = ref(false)
const errorMsg = ref('')
const errors = ref({}) // Rename to match template usage

const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const name = ref('')
const phone = ref('')
const organizationName = ref('')
const termsAccepted = ref(false)

import { onMounted } from 'vue'

// ... existing refs ...

const turnstileToken = ref('')
const turnstileWidgetId = ref(null)

onMounted(() => {
  // Function to render the widget
  const renderTurnstile = () => {
    if (window.turnstile) {
      turnstileWidgetId.value = window.turnstile.render('#cf-turnstile-widget', {
        sitekey: props.turnstileSiteKey,
        callback: (token) => {
          turnstileToken.value = token
        },
      })
    }
  }

  // Check if Turnstile is already loaded
  if (window.turnstile) {
    renderTurnstile()
  } else {
    // If not, wait for it (simple polling for this case, or relying on script loading order if predictable)
    // A better way is to define the onload callback expected by the script URL if we controlled it,
    // but since the script is in the layout, polling is a pragmatic local fix.
    const interval = setInterval(() => {
      if (window.turnstile) {
        clearInterval(interval)
        renderTurnstile()
      }
    }, 100)
    
    // Safety timeout
    setTimeout(() => clearInterval(interval), 10000)
  }
})

const registerSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio'),
  email: z.string().email('Formato de email inválido'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
  confirmPassword: z.string().min(1, 'Debes confirmar tu contraseña'),
  organizationName: z.string().min(1, 'El nombre de la organización es obligatorio'),
  phone: z.string().regex(/^\+?[0-9\s-]+$/, 'Teléfono inválido'),
  termsAccepted: z.literal(true, {
    errorMap: () => ({ message: 'Debes aceptar los términos' })
  })
}).refine(data => data.password === data.confirmPassword, {
  path: ['confirmPassword'],
  message: 'Las contraseñas no coinciden'
})

const togglePassword = () => {
  showPassword.value = !showPassword.value
}

const handleRegister = async () => {
  try {
    loading.value = true
    errorMsg.value = ''
    errors.value = {}

    if (!turnstileToken.value) {
      throw new Error('Por favor completa la verificación de seguridad (CAPTCHA).')
    }

    const result = registerSchema.safeParse({
      name: name.value,
      email: email.value,
      phone: phone.value,
      password: password.value,
      confirmPassword: confirmPassword.value,
      organizationName: organizationName.value,
      termsAccepted: termsAccepted.value
    })

    if (!result.success) {
      errors.value = result.error.flatten().fieldErrors
      return
    }

    const { confirmPassword: _, termsAccepted: __, ...registerData } = result.data

    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...registerData,
        cfToken: turnstileToken.value
      }),
    })

    const dataRes = await response.json()

    if (!response.ok) {
      throw new Error(dataRes.message || 'Error al registrarse')
    }

    // Registro exitoso, redirigir al login
    window.location.href = '/organizadores/login'

  } catch (error) {
    errorMsg.value = error.message
  } finally {
    loading.value = false
    // Reset Turnstile para obtener un token fresco en caso de reintento
    if (window.turnstile && turnstileWidgetId.value !== null) {
      window.turnstile.reset(turnstileWidgetId.value)
      turnstileToken.value = ''
    }
  }
}
</script>

<template>
  <div class="w-full max-w-2xl mx-auto bg-white/10 backdrop-blur-xl p-8 rounded-xl shadow-2xl border border-white/20 font-[Prompt]">
    <h2 class="text-2xl font-bold mb-6 text-center font-[Unbounded] text-white">Registro de Productor</h2>
    
    <form @submit.prevent="handleRegister" class="space-y-6">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="col-span-2 md:col-span-1">
          <label class="block text-sm font-medium text-white/80 mb-1">Nombre Completo</label>
          <input 
            v-model="name" 
            type="text" 
            class="w-full px-4 py-2 border bg-white/10 text-white placeholder-white/40 rounded-lg focus:ring-2 focus:ring-white/50 outline-none transition"
            :class="errors.name ? 'border-red-400/60' : 'border-white/20'"
            placeholder="Juan Pérez"
          />
          <p v-if="errors.name" class="text-red-300 text-xs mt-1">{{ errors.name[0] }}</p>
        </div>

        <div class="col-span-2 md:col-span-1">
          <label class="block text-sm font-medium text-white/80 mb-1">Nombre Organización</label>
          <input 
            v-model="organizationName" 
            type="text" 
            class="w-full px-4 py-2 border bg-white/10 text-white placeholder-white/40 rounded-lg focus:ring-2 focus:ring-white/50 outline-none transition"
            :class="errors.organizationName ? 'border-red-400/60' : 'border-white/20'"
            placeholder="Mi Productora"
          />
          <p v-if="errors.organizationName" class="text-red-300 text-xs mt-1">{{ errors.organizationName[0] }}</p>
        </div>

        <div class="col-span-2">
          <label class="block text-sm font-medium text-white/80 mb-1">Email</label>
          <input 
            v-model="email" 
            type="email" 
            class="w-full px-4 py-2 border bg-white/10 text-white placeholder-white/40 rounded-lg focus:ring-2 focus:ring-white/50 outline-none transition"
            :class="errors.email ? 'border-red-400/60' : 'border-white/20'"
            placeholder="contacto@productora.com"
          />
          <p v-if="errors.email" class="text-red-300 text-xs mt-1">{{ errors.email[0] }}</p>
        </div>

        <div class="col-span-2 md:col-span-1">
          <label class="block text-sm font-medium text-white/80 mb-1">Contraseña</label>
          <div class="relative">
            <input 
              v-model="password" 
              :type="showPassword ? 'text' : 'password'" 
              class="w-full px-4 py-2 border bg-white/10 text-white placeholder-white/40 rounded-lg focus:ring-2 focus:ring-white/50 outline-none transition"
              :class="errors.password ? 'border-red-400/60' : 'border-white/20'"
              placeholder="Min. 6 caracteres"
            />
            <button 
              type="button" 
              @click="togglePassword"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
            >
              <component :is="showPassword ? EyeOff : Eye" size="20" />
            </button>
          </div>
          <p v-if="errors.password" class="text-red-300 text-xs mt-1">{{ errors.password[0] }}</p>
        </div>

        <div class="col-span-2 md:col-span-1">
          <label class="block text-sm font-medium text-white/80 mb-1">Confirmar Contraseña</label>
          <input 
            v-model="confirmPassword" 
            type="password" 
            class="w-full px-4 py-2 border bg-white/10 text-white placeholder-white/40 rounded-lg focus:ring-2 focus:ring-white/50 outline-none transition"
            :class="errors.confirmPassword ? 'border-red-400/60' : 'border-white/20'"
            placeholder="Repite la contraseña"
          />
          <p v-if="errors.confirmPassword" class="text-red-300 text-xs mt-1">{{ errors.confirmPassword[0] }}</p>
        </div>

        <div class="col-span-2">
          <label class="block text-sm font-medium text-white/80 mb-1">Teléfono</label>
          <input 
            v-model="phone" 
            type="tel" 
            class="w-full px-4 py-2 border bg-white/10 text-white placeholder-white/40 rounded-lg focus:ring-2 focus:ring-white/50 outline-none transition"
            :class="errors.phone ? 'border-red-400/60' : 'border-white/20'"
            placeholder="+56 9 1234 5678"
          />
          <p v-if="errors.phone" class="text-red-300 text-xs mt-1">{{ errors.phone[0] }}</p>
        </div>
      </div>

      <div class="flex items-start gap-3 mt-4">
        <div class="flex items-center h-5">
          <input 
            v-model="termsAccepted" 
            type="checkbox" 
            class="w-4 h-4 rounded border-white/30 bg-white/10 text-white focus:ring-white/50"
          />
        </div>
        <div class="text-sm">
          <label class="font-medium text-white/80">Acepto los términos y condiciones</label>
          <p class="text-white/50">Al registrarte aceptas nuestros <a href="/terms" class="underline text-white/80 hover:text-white">Términos del Servicio</a> y <a href="/privacy" class="underline text-white/80 hover:text-white">Política de Privacidad</a>.</p>
          <p v-if="errors.termsAccepted" class="text-red-300 text-xs mt-1">{{ errors.termsAccepted[0] }}</p>
        </div>
      </div>

      <div v-if="errorMsg" class="p-4 bg-red-500/20 text-red-200 rounded-lg border border-red-400/30 text-center text-sm font-medium">
        {{ errorMsg }}
      </div>

      <button
        type="submit"
        :disabled="loading"
        class="w-full bg-white text-gray-900 rounded-lg py-3 px-4 hover:bg-white/90 focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-transparent disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium"
      >
        <div v-if="loading" class="flex items-center justify-center">
          <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-600 mr-2"></div>
          Registrando...
        </div>
        <span v-else>Crear cuenta</span>
      </button>

      <!-- Turnstile Widget -->
      <div id="cf-turnstile-widget" class="flex justify-center mt-4"></div>

    </form>

    <div class="mt-6 text-center text-sm text-white/60">
      ¿Ya tienes cuenta? 
      <a href="/organizadores/login" class="font-medium text-white hover:underline">Inicia sesión</a>
    </div>
  </div>
</template>
