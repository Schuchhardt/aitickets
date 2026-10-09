<script setup>
import { computed, onMounted, ref } from 'vue'
import { Eye, EyeOff } from 'lucide-vue-next'
import { trackSignUp } from '../../composables/useGoogleAnalytics.js'
import AiBrandIcon from '../ai/AiBrandIcon.vue'

// Registro en dos pasos: 1) correo + contraseña (o Google), 2) tras verificar el correo, solo el nombre de la
// productora (/organizadores/bienvenida). ?next= (p. ej. /dashboard/ia desde "Conecta tu IA" o la autorización
// OAuth de Claude/ChatGPT) se conserva hasta el final.

const props = defineProps({
  turnstileSiteKey: { type: String, required: true },
  googleEnabled: { type: Boolean, default: false },
})

// Atribución del registro (utm_* / ref / referrer). Se guarda en sessionStorage para no perderla si el
// productor navega antes de registrarse.
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

// Destino tras registrarse: solo rutas internas del panel o de autorización OAuth (igual que el login)
const safeNext = (raw) => (typeof raw === 'string' && /^\/(dashboard(\/|\?|$)|oauth\/)/.test(raw) && !raw.startsWith('//') && !raw.includes('\\') ? raw : '')
const next = ref('')
const goingToAi = computed(() => next.value.startsWith('/dashboard/ia') || next.value.startsWith('/oauth/'))

const GOOGLE_ERRORS = {
  google: 'No pudimos completar el acceso con Google. Intenta de nuevo o usa tu correo.',
  google_inactive: 'Tu usuario está desactivado en la organización. Habla con el administrador de tu productora.',
}

const email = ref('')
const password = ref('')
const showPassword = ref(false)
const termsAccepted = ref(false)
const loading = ref(false)
const errorMsg = ref('')
const errors = ref({})

// Registro desde un enlace de lead (outreach / formulario "web gratis"): ?lead=<token firmado>
const leadToken = ref('')
const leadPrefilled = ref(false)
const leadOrgName = ref('')

// Estado posterior al registro: "revisa tu correo"
const submitted = ref(false)
const submittedEmail = ref('')
const emailSent = ref(true)
const resendLoading = ref(false)
const resendMsg = ref('')

const turnstileToken = ref('')
const turnstileWidgetId = ref(null)

const googleHref = computed(() => {
  const p = new URLSearchParams()
  if (next.value) p.set('next', next.value)
  for (const [k, v] of Object.entries(attribution.value || {})) if (v) p.set(k, v)
  if (leadToken.value) p.set('lead', leadToken.value)
  const qs = p.toString()
  return `/api/auth/google${qs ? `?${qs}` : ''}`
})
const loginHref = computed(() => (next.value ? `/organizadores/login?next=${encodeURIComponent(next.value)}` : '/organizadores/login'))

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
    if (lead.org_name) leadOrgName.value = String(lead.org_name).slice(0, 120)
    if (lead.email && !email.value) email.value = String(lead.email).slice(0, 254)
    leadPrefilled.value = true
  } catch (e) { /* sin prellenado */ }
}

onMounted(() => {
  loadAttribution()
  loadLeadPrefill()
  try {
    const params = new URLSearchParams(window.location.search)
    next.value = safeNext(params.get('next'))
    const err = params.get('error')
    if (err && GOOGLE_ERRORS[err]) errorMsg.value = GOOGLE_ERRORS[err]
    const presetEmail = params.get('email')
    if (presetEmail && !email.value) email.value = presetEmail.slice(0, 254)
  } catch (e) { /* sin URL */ }

  const renderTurnstile = () => {
    if (!window.turnstile || turnstileWidgetId.value !== null) return
    turnstileWidgetId.value = window.turnstile.render('#cf-turnstile-widget', {
      sitekey: props.turnstileSiteKey,
      callback: (token) => { turnstileToken.value = token },
    })
  }
  if (window.turnstile) {
    renderTurnstile()
  } else {
    const interval = setInterval(() => {
      if (window.turnstile) {
        clearInterval(interval)
        renderTurnstile()
      }
    }, 100)
    setTimeout(() => clearInterval(interval), 10000)
  }
})

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const validate = () => {
  const e = {}
  if (!EMAIL_RE.test(email.value.trim())) e.email = 'Ingresa un correo válido'
  if (password.value.length < 8) e.password = 'Mínimo 8 caracteres'
  if (!termsAccepted.value) e.termsAccepted = 'Debes aceptar los Términos para productores y la Política de Privacidad'
  errors.value = e
  return Object.keys(e).length === 0
}

const handleRegister = async () => {
  errorMsg.value = ''
  if (!validate()) return
  if (!turnstileToken.value) {
    errorMsg.value = 'Completa la verificación de seguridad (CAPTCHA).'
    return
  }
  loading.value = true
  try {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email.value.trim(),
        password: password.value,
        organizationName: leadOrgName.value || undefined,
        acceptedTerms: true,
        next: next.value || undefined,
        leadToken: leadToken.value || undefined,
        cfToken: turnstileToken.value,
        attribution: attribution.value,
      }),
    })
    const dataRes = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(dataRes.message || 'Error al registrarse')

    try {
      trackSignUp('email')
      sessionStorage.removeItem(SIGNUP_ATTRIBUTION_KEY)
    } catch (e) { /* analytics no disponible */ }
    if (dataRes.needsVerification === false && dataRes.redirect) {
      window.location.href = dataRes.redirect
      return
    }
    submittedEmail.value = email.value.trim()
    emailSent.value = dataRes.emailSent !== false
    submitted.value = true
    try { window.scrollTo({ top: 0, behavior: 'smooth' }) } catch (e) { /* sin scroll */ }
  } catch (error) {
    errorMsg.value = error.message
  } finally {
    loading.value = false
    if (window.turnstile && turnstileWidgetId.value !== null && !submitted.value) {
      try { window.turnstile.reset(turnstileWidgetId.value) } catch (e) { /* widget ya no existe */ }
      turnstileToken.value = ''
    }
  }
}

const resendVerification = async () => {
  try {
    resendLoading.value = true
    resendMsg.value = ''
    const response = await fetch('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: submittedEmail.value, next: next.value || undefined }),
    })
    const data = await response.json().catch(() => ({}))
    resendMsg.value = data.message || (response.ok ? 'Listo. Revisa tu correo.' : 'No pudimos reenviar el enlace. Intenta más tarde.')
  } catch (e) {
    resendMsg.value = 'No pudimos reenviar el enlace. Revisa tu conexión e intenta de nuevo.'
  } finally {
    resendLoading.value = false
  }
}

const inputClass = (field) => [
  'w-full px-4 py-3 border bg-white/10 text-white placeholder-white/40 rounded-lg focus:ring-2 focus:ring-white/50 outline-none transition',
  errors.value[field] ? 'border-red-400/60' : 'border-white/20',
]
</script>

<template>
  <div class="w-full max-w-md mx-auto bg-white/10 backdrop-blur-xl p-6 sm:p-8 rounded-xl shadow-2xl border border-white/20 font-[Prompt]">
    <!-- Pasos -->
    <ol class="flex items-center justify-center gap-2 text-xs text-white/60 mb-6" aria-label="Pasos del registro">
      <li class="flex items-center gap-1" :class="submitted ? '' : 'text-white'">
        <span class="w-5 h-5 rounded-full flex items-center justify-center font-bold" :class="submitted ? 'bg-lime-400 text-black' : 'bg-white text-black'">{{ submitted ? '✓' : '1' }}</span>
        Tu correo
      </li>
      <li class="w-5 h-px bg-white/30"></li>
      <li class="flex items-center gap-1"><span class="w-5 h-5 rounded-full border border-white/40 flex items-center justify-center">2</span> Tu productora</li>
      <template v-if="goingToAi">
        <li class="w-5 h-px bg-white/30"></li>
        <li class="flex items-center gap-1"><span class="w-5 h-5 rounded-full border border-white/40 flex items-center justify-center">3</span> Conecta tu IA</li>
      </template>
    </ol>

    <!-- Revisa tu correo -->
    <div v-if="submitted" class="text-center" data-testid="register-check-email">
      <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-lime-400/20 text-lime-300">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
      </div>
      <h2 class="text-2xl font-bold mb-3 font-[Unbounded] text-white">Revisa tu correo</h2>
      <p v-if="emailSent" class="text-white/70 mb-2">
        Te enviamos un enlace a <strong class="text-white">{{ submittedEmail }}</strong>.
        Ábrelo para confirmar tu correo; después solo te pediremos el nombre de tu productora<span v-if="goingToAi"> y te llevamos directo a conectar tu IA</span>.
      </p>
      <p v-else class="text-white/70 mb-2">
        Tu cuenta quedó creada, pero no pudimos enviar el correo de confirmación a <strong class="text-white">{{ submittedEmail }}</strong>. Pide uno nuevo:
      </p>
      <p class="text-white/50 text-sm mb-6">El enlace dura 48 horas. Si no lo ves, revisa spam o promociones.</p>
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
        ¿Ya confirmaste? <a :href="loginHref" class="font-medium text-white hover:underline">Inicia sesión</a>
      </p>
    </div>

    <template v-else>
      <div v-if="goingToAi" class="flex items-center justify-center gap-3 mb-3 text-white" aria-hidden="true">
        <span class="w-10 h-10 rounded-xl bg-white flex items-center justify-center"><AiBrandIcon brand="claude" colored class="w-6 h-6" /></span>
        <span class="w-10 h-10 rounded-xl bg-white text-black flex items-center justify-center"><AiBrandIcon brand="chatgpt" class="w-6 h-6" /></span>
      </div>
      <h1 class="text-2xl font-bold mb-2 text-center font-[Unbounded] text-white">
        {{ goingToAi ? 'Crea tu cuenta y conecta tu IA' : 'Crea tu cuenta de productor' }}
      </h1>
      <p class="text-center text-white/70 text-sm mb-6">
        {{ goingToAi ? 'Gratis. Después conectas Claude o ChatGPT en 1 minuto.' : 'Gratis. 0% de comisión para el productor e incluye tu web de eventos.' }}
      </p>
      <p v-if="leadPrefilled" class="mb-4 p-3 rounded-lg bg-lime-400/10 border border-lime-300/30 text-lime-100 text-sm text-center">
        Completamos tu correo por ti. Revísalo antes de crear tu cuenta.
      </p>

      <template v-if="googleEnabled">
        <a
          :href="googleHref"
          data-testid="register-google"
          class="w-full flex items-center justify-center gap-3 bg-white text-gray-900 rounded-lg py-3 px-4 hover:bg-white/90 transition font-medium"
        >
          <svg viewBox="0 0 24 24" class="w-5 h-5" aria-hidden="true"><path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81z"/><path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.29 14.29A7.2 7.2 0 0 1 4.91 12c0-.79.14-1.56.38-2.29v-3.1H1.28a12 12 0 0 0 0 10.78l4.01-3.1z"/><path fill="#EA4335" d="M12 4.75c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.61l4.01 3.1C6.23 6.86 8.88 4.75 12 4.75z"/></svg>
          Continuar con Google
        </a>
        <p class="text-[11px] text-white/50 text-center mt-2">
          Al continuar con Google aceptas los <a href="/terminos-productores" target="_blank" rel="noopener" class="underline">Términos para productores</a> y la <a href="/privacy" target="_blank" rel="noopener" class="underline">Política de Privacidad</a>.
        </p>
        <div class="flex items-center gap-3 my-5 text-white/40 text-xs">
          <span class="flex-1 h-px bg-white/20"></span> o con tu correo <span class="flex-1 h-px bg-white/20"></span>
        </div>
      </template>

      <form @submit.prevent="handleRegister" class="space-y-4" novalidate>
        <div>
          <label for="register-email" class="block text-sm font-medium text-white/80 mb-1">Correo</label>
          <input id="register-email" v-model="email" type="email" autocomplete="email" inputmode="email" :class="inputClass('email')" placeholder="tu@productora.cl" data-testid="register-email" />
          <p v-if="errors.email" class="text-red-300 text-xs mt-1">{{ errors.email }}</p>
        </div>

        <div>
          <label for="register-password" class="block text-sm font-medium text-white/80 mb-1">Contraseña</label>
          <div class="relative">
            <input id="register-password" v-model="password" :type="showPassword ? 'text' : 'password'" autocomplete="new-password" :class="inputClass('password')" placeholder="Mínimo 8 caracteres" data-testid="register-password" />
            <button type="button" @click="showPassword = !showPassword" class="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70" :aria-label="showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'">
              <component :is="showPassword ? EyeOff : Eye" :size="20" />
            </button>
          </div>
          <p v-if="errors.password" class="text-red-300 text-xs mt-1">{{ errors.password }}</p>
        </div>

        <label for="register-terms" class="flex items-start gap-3 text-sm cursor-pointer">
          <input id="register-terms" v-model="termsAccepted" type="checkbox" data-testid="register-terms-checkbox" class="mt-1 w-4 h-4 rounded border-white/30 bg-white/10" />
          <span class="text-white/60">
            Acepto los <a href="/terminos-productores" target="_blank" rel="noopener" class="underline text-white/80 hover:text-white">Términos para productores</a>, los
            <a href="/terms" target="_blank" rel="noopener" class="underline text-white/80 hover:text-white">Términos y condiciones</a> y la
            <a href="/privacy" target="_blank" rel="noopener" class="underline text-white/80 hover:text-white">Política de Privacidad</a>.
            <span v-if="errors.termsAccepted" class="block text-red-300 text-xs mt-1">{{ errors.termsAccepted }}</span>
          </span>
        </label>

        <div v-if="errorMsg" class="p-3 bg-red-500/20 text-red-200 rounded-lg border border-red-400/30 text-center text-sm font-medium" role="alert">
          {{ errorMsg }}
        </div>

        <button
          type="submit"
          data-testid="register-submit"
          :disabled="loading"
          class="w-full bg-lime-400 text-black font-bold font-[Unbounded] rounded-lg py-3 px-4 hover:bg-lime-300 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          <span v-if="loading" class="flex items-center justify-center gap-2">
            <span class="animate-spin rounded-full h-5 w-5 border-b-2 border-black"></span> Creando cuenta...
          </span>
          <span v-else>Crear cuenta gratis</span>
        </button>

        <div id="cf-turnstile-widget" class="flex justify-center"></div>
      </form>

      <p class="mt-6 text-center text-sm text-white/60">
        ¿Ya tienes cuenta? <a :href="loginHref" class="font-medium text-white hover:underline">Inicia sesión</a>
      </p>
    </template>
  </div>
</template>
