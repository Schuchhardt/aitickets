<script setup>
import { ref, computed, onMounted } from 'vue'
import { Mail } from 'lucide-vue-next'
import { apiRequest, notifySiteUpdated } from './siteApi.js'

const props = defineProps({
  contactEmail: { type: String, default: '' },
  contactFormEnabled: { type: Boolean, default: true },
  orgEmail: { type: String, default: '' },
})

const email = ref(props.contactEmail || '')
const enabled = ref(props.contactFormEnabled)
const saved = ref({ email: email.value, enabled: enabled.value })
const saving = ref(false)
const message = ref('')
const isError = ref(false)

const dirty = computed(() => email.value.trim() !== saved.value.email || enabled.value !== saved.value.enabled)

async function save() {
  saving.value = true
  message.value = ''
  try {
    const data = await apiRequest('/api/sites', {
      method: 'PUT',
      body: { contact_email: email.value.trim() || null, contact_form_enabled: enabled.value },
    })
    email.value = data.site?.contact_email || ''
    enabled.value = data.site?.contact_form_enabled !== false
    saved.value = { email: email.value, enabled: enabled.value }
    isError.value = false
    message.value = data.pendingContactEmail ? data.message : 'Guardado.'
    notifySiteUpdated()
  } catch (e) {
    isError.value = true
    message.value = e.message
  } finally {
    saving.value = false
  }
}

// Resultado del enlace de confirmación (/api/sites/contact-email-confirm → ?contacto=...)
const CONFIRM_MESSAGES = {
  ok: ['Correo de contacto confirmado. Los mensajes llegarán ahí.', false],
  expired: ['El enlace de confirmación venció. Guarda el correo de nuevo para recibir otro.', true],
  invalid: ['El enlace de confirmación no es válido.', true],
  not_found: ['No encontramos el sitio de ese enlace.', true],
  server: ['No pudimos confirmar el correo. Intenta de nuevo.', true],
}
onMounted(() => {
  try {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('contacto')
    if (!code || !CONFIRM_MESSAGES[code]) return
    ;[message.value, isError.value] = CONFIRM_MESSAGES[code]
    params.delete('contacto')
    const qs = params.toString()
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash)
  } catch {
    /* sin acceso a la URL */
  }
})
</script>

<template>
  <section class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
    <div class="p-6 border-b border-gray-100">
      <h3 class="font-bold text-lg flex items-center gap-2"><Mail size="18" /> Formulario de contacto</h3>
      <p class="text-sm text-gray-500 mt-1">Los mensajes que te escriban desde tu sitio llegan a este correo. Puedes responderles directamente.</p>
    </div>
    <form class="p-6 space-y-4" @submit.prevent="save">
      <label class="flex items-center gap-2 text-sm text-gray-800">
        <input v-model="enabled" type="checkbox" class="rounded" />
        Mostrar el formulario de contacto en mi sitio
      </label>
      <label class="block">
        <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Correo que recibe los mensajes</span>
        <input
          v-model="email"
          type="email"
          maxlength="254"
          :placeholder="orgEmail || 'contacto@tuproductora.cl'"
          class="w-full px-3 py-2 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black"
        />
        <span v-if="orgEmail" class="block text-xs text-gray-500 mt-1">Si lo dejas vacío, usamos el correo verificado de tu cuenta ({{ orgEmail }}). Si escribes otro correo, te enviaremos un enlace para confirmarlo.</span>
        <span v-else class="block text-xs text-gray-500 mt-1">Escribe el correo donde quieres recibir los mensajes: te enviaremos un enlace para confirmarlo. Hasta entonces no se envían mensajes.</span>
      </label>
      <div class="flex items-center gap-3">
        <button type="submit" class="px-4 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-40" :disabled="saving || !dirty">
          {{ saving ? 'Guardando…' : 'Guardar' }}
        </button>
        <p v-if="message" class="text-sm" :class="isError ? 'text-red-600' : 'text-green-700'">{{ message }}</p>
      </div>
    </form>
  </section>
</template>
