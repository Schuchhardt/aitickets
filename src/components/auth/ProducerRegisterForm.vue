<script setup>
import { reactive, ref } from 'vue'

import * as z from 'zod'
import { Eye, EyeOff } from 'lucide-vue-next'
import { trackSignUp } from '../../composables/useGoogleAnalytics.js'

// Atribución del registro (utm_* / ref / referrer). Se guarda en sessionStorage para
// no perderla si el productor navega antes de registrarse.
const SIGNUP_ATTRIBUTION_KEY = 'aitickets_signup_attribution'
const attribution = ref({})

const loadAttribution = () => {
  let stored = {}
  try {
    stored = JSON.parse(sessionStorage.getItem(SIGNUP_ATTRIBUTION_KEY) || '{}') || {}
  } catch (e) {
    stored = {}
  }
  const params = new URLSearchParams(window.location.search)
  const fromUrl = {}
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'ref']) {
    const value = params.get(key)
    if (value) fromUrl[key] = value.slice(0, 200)
  }
  let referrer = stored.referrer || ''
  try {
    if (!referrer && document.referrer && new URL(document.referrer).host !== window.location.host) {
      referrer = document.referrer.slice(0, 500)
    }
  } catch (e) { /* referrer inválido */ }
  const merged = Object.keys(fromUrl).length ? { ...fromUrl } : { ...stored }
  if (referrer) merged.referrer = referrer
  attribution.value = merged
  try {
    sessionStorage.setItem(SIGNUP_ATTRIBUTION_KEY, JSON.stringify(merged))
  } catch (e) { /* storage bloqueado */ }
}

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

// Registro desde un enlace de lead (outreach / formulario "web gratis"): ?lead=<token firmado>
const leadToken = ref('')
const leadPrefilled = ref(false)
// Estado posterior al registro: "revisa tu correo"
const submitted = ref(false)
const submittedEmail = ref('')
const emailSent = ref(true)
const resendLoading = ref(false)
const resendMsg = ref('')

const loadLeadPrefill = async () => {
  let token = ''
  try {
    token = new URLSearchParams(window.location.search).get('lead') || ''
  } catch (e) { token = '' }
  if (!token || token.length > 2048) return
  leadToken.value = token
  try {
    const res = await fetch(`/api/outreach/lead-prefill?t=${encodeURIComponent(token)}`)
    if (!res.ok) {
      leadToken.value = ''
      return
    }
    const lead = await res.json()
    if (lead.org_name && !organizationName.value) organizationName.value = String(lead.org_name).slice(0, 120)
    if (lead.email && !email.value) email.value = String(lead.email).slice(0, 254)
    leadPrefilled.value = true
  } catch (e) { /* sin prellenado */ }
}

const resendVerification = async () => {
  try {
    resendLoading.value = true
    resendMsg.value = ''
    const response = await fetch('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: submittedEmail.value }),
    })
    const data = await response.json().catch(() => ({}))
    resendMsg.value = data.message || (response.ok ? 'Listo. Revisa tu correo.' : 'No pudimos reenviar el enlace. Intenta más tarde.')
  } catch (e) {
    resendMsg.value = 'No pudimos reenviar el enlace. Revisa tu conexión e intenta de nuevo.'
  } finally {
    resendLoading.value = false
  }
}

import { onMounted } from 'vue'

// ... existing refs ...

const turnstileToken = ref('')
const turnstileWidgetId = ref(null)

onMounted(() => {
  loadAttribution()
  loadLeadPrefill()

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
    errorMap: () => ({ message: 'Debes aceptar los Términos para productores y la Política de Privacidad' })
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
        acceptedTerms: true,
        leadToken: leadToken.value || undefined,
        cfToken: turnstileToken.value,
        attribution: attribution.value
      }),
    })

    const dataRes = await response.json()

    if (!response.ok) {
      throw new Error(dataRes.message || 'Error al registrarse')
    }

    // Registro exitoso: medir la conversión y pedir que confirme su correo (no hay sesión todavía)
    try {
      trackSignUp('email')
      sessionStorage.removeItem(SIGNUP_ATTRIBUTION_KEY)
    } catch (e) { /* analytics no disponible */ }
    if (dataRes.needsVerification === false && dataRes.redirect) {
      window.location.href = dataRes.redirect
      return
    }
    submittedEmail.value = result.data.email
    emailSent.value = dataRes.emailSent !== false
    submitted.value = true
    try { window.scrollTo({ top: 0, behavior: 'smooth' }) } catch (e) { /* sin scroll */ }

  } catch (error) {
    errorMsg.value = error.message
  } finally {
    loading.value = false
    // Reset Turnstile para obtener un token fresco en caso de reintento
    if (window.turnstile && turnstileWidgetId.value !== null && !submitted.value) {
      try { window.turnstile.reset(turnstileWidgetId.value) } catch (e) { /* widget ya no existe */ }
      turnstileToken.value = ''
    }
  }
}
</script>

<template>
  <div class="w-full max-w-2xl mx-auto bg-white/10 backdrop-blur-xl p-8 rounded-xl shadow-2xl border border-white/20 font-[Prompt]">
    <div v-if="submitted" class="text-center" data-testid="register-check-email">
      <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-lime-400/20 text-lime-300">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
      </div>
      <h2 class="text-2xl font-bold mb-3 font-[Unbounded] text-white">Revisa tu correo</h2>
      <p v-if="emailSent" class="text-white/70 mb-2">
        Te enviamos un enlace a <strong class="text-white">{{ submittedEmail }}</strong> para confirmar tu cuenta.
        Ábrelo para activar tu panel y tu web de eventos gratis.
      </p>
      <p v-else class="text-white/70 mb-2">
        Tu cuenta quedó creada, pero no pudimos enviar el correo de confirmación a <strong class="text-white">{{ submittedEmail }}</strong>. Pide uno nuevo:
      </p>
      <p class="text-white/50 text-sm mb-6">El enlace dura 48 horas. Si no lo ves, revisa la carpeta de spam o promociones.</p>
      <button
        type="button"
        @click="resendVerification"
        :disabled="resendLoading"
        class="w-full bg-white/10 border border-white/20 text-white rounded-lg py-3 px-4 hover:bg-white/20 disabled:opacity-50 transition font-medium"
      >
        {{ resendLoading ? 'Enviando...' : 'Reenviar el correo' }}
      </button>
      <p v-if="resendMsg" class="text-white/70 text-sm mt-3">{{ resendMsg }}</p>
      <p class="mt-6 text-sm text-white/60">
        ¿Ya confirmaste? <a href="/organizadores/login" class="font-medium text-white hover:underline">Inicia sesión</a>
      </p>
    </div>

    <template v-else>
    <h2 class="text-2xl font-bold mb-2 text-center font-[Unbounded] text-white">Registro de Productor</h2>
    <p class="text-center text-white/70 text-sm mb-6">0% de comisión para el productor. Incluye tu web de eventos gratis.</p>
    <p v-if="leadPrefilled" class="mb-6 p-3 rounded-lg bg-lime-400/10 border border-lime-300/30 text-lime-100 text-sm text-center">
      Completamos algunos datos por ti. Revísalos antes de crear tu cuenta.
    </p>

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
            id="register-terms"
            v-model="termsAccepted" 
            type="checkbox" 
            data-testid="register-terms-checkbox"
            class="w-4 h-4 rounded border-white/30 bg-white/10 text-white focus:ring-white/50"
          />
        </div>
        <div class="text-sm">
          <label for="register-terms" class="font-medium text-white/80">Acepto los términos para productores</label>
          <p class="text-white/50">Al registrarte aceptas los <a href="/terminos-productores" target="_blank" rel="noopener" class="underline text-white/80 hover:text-white">Términos para productores</a>, los <a href="/terms" target="_blank" rel="noopener" class="underline text-white/80 hover:text-white">Términos y condiciones</a> y la <a href="/privacy" target="_blank" rel="noopener" class="underline text-white/80 hover:text-white">Política de Privacidad</a>.</p>
          <p v-if="errors.termsAccepted" class="text-red-300 text-xs mt-1">{{ errors.termsAccepted[0] }}</p>
        </div>
      </div>

      <div v-if="errorMsg" class="p-4 bg-red-500/20 text-red-200 rounded-lg border border-red-400/30 text-center text-sm font-medium">
        {{ errorMsg }}
      </div>

      <button
        type="submit"
        data-testid="register-submit"
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
    </template>
  </div>
</template>
