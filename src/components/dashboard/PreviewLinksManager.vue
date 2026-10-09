<script setup>
import { ref, onMounted } from 'vue'
import { Eye, Copy, Check, Link2 } from 'lucide-vue-next'

// Links privados de vista previa del evento (/api/events/preview-links). Sirven para mostrar un borrador
// a socios, artistas o al equipo sin publicarlo. La URL con el token solo se muestra al crearla.

const props = defineProps({
  eventId: { type: Number, required: true },
  status: { type: String, default: 'draft' },
})

const EXPIRY_OPTIONS = [
  { value: '1', label: '1 hora' },
  { value: '24', label: '24 horas' },
  { value: '168', label: '7 días' },
  { value: '720', label: '30 días' },
  { value: 'never', label: 'Sin vencimiento' },
]

const links = ref([])
const loading = ref(true)
const unavailable = ref(false)
const form = ref({ expiry: '168', singleUse: false, label: '' })
const saving = ref(false)
const error = ref('')
const newUrl = ref('')
const copied = ref(false)
const busyId = ref(null)

const STATUS_LABEL = { active: 'Activo', expired: 'Vencido', revoked: 'Revocado', used: 'Usado' }
const STATUS_CLASS = {
  active: 'bg-green-100 text-green-700',
  expired: 'bg-gray-100 text-gray-500',
  revoked: 'bg-gray-100 text-gray-500',
  used: 'bg-amber-100 text-amber-700',
}
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' }) : '')

const load = async () => {
  loading.value = true
  try {
    const res = await fetch(`/api/events/preview-links?event_id=${props.eventId}`)
    const data = await res.json().catch(() => ({}))
    if (res.status === 503) unavailable.value = true
    links.value = res.ok ? data.links || [] : []
  } finally {
    loading.value = false
  }
}
onMounted(load)

const create = async () => {
  error.value = ''
  saving.value = true
  try {
    const res = await fetch('/api/events/preview-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: props.eventId,
        expiresInHours: form.value.expiry === 'never' ? null : Number(form.value.expiry),
        singleUse: form.value.singleUse,
        label: form.value.label || null,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || 'No se pudo crear el link')
    newUrl.value = data.url
    links.value = [data.link, ...links.value]
    form.value.label = ''
  } catch (e) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}

const revoke = async (link) => {
  if (!confirm('¿Revocar este link? Quien lo tenga ya no podrá ver la vista previa.')) return
  busyId.value = link.id
  try {
    const res = await fetch(`/api/events/preview-links?id=${encodeURIComponent(link.id)}`, { method: 'DELETE' })
    if (res.ok) links.value = links.value.map((l) => (l.id === link.id ? { ...l, status: 'revoked' } : l))
  } finally {
    busyId.value = null
  }
}

const copy = async () => {
  try {
    await navigator.clipboard.writeText(newUrl.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch { /* sin permiso de portapapeles */ }
}
</script>

<template>
  <div class="bg-white p-6 rounded-xl border border-gray-200 shadow-sm" data-testid="preview-links">
    <h3 class="font-bold text-lg mb-1 flex items-center gap-2"><Eye :size="18" /> Vista previa privada</h3>
    <p class="text-sm text-gray-500 mb-4">
      <template v-if="status !== 'published'">Tu evento está en <strong>borrador</strong>: el link público da error hasta publicarlo.</template>
      Comparte un link privado para que otros vean la página sin publicarla. No aparece en buscadores.
    </p>

    <p v-if="unavailable" class="text-sm text-amber-700">Los links de vista previa estarán disponibles en unos minutos.</p>

    <template v-else>
      <div v-if="newUrl" class="mb-4 p-3 rounded-lg bg-green-50 border border-green-200 space-y-2">
        <p class="text-xs font-semibold text-green-800">Link creado. Cópialo ahora: no lo volveremos a mostrar.</p>
        <div class="flex gap-2">
          <input :value="newUrl" readonly class="flex-1 min-w-0 bg-white border border-green-200 text-xs rounded-lg px-3 py-2 outline-none" @focus="$event.target.select()" />
          <button type="button" @click="copy" class="px-3 py-2 bg-black text-white rounded-lg text-xs flex items-center gap-1 shrink-0">
            <component :is="copied ? Check : Copy" :size="14" /> {{ copied ? 'Copiado' : 'Copiar' }}
          </button>
        </div>
        <button type="button" class="text-xs underline text-green-800" @click="newUrl = ''">Crear otro link</button>
      </div>

      <form v-else @submit.prevent="create" class="space-y-3">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="block">
            <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Vence en</span>
            <select v-model="form.expiry" class="w-full bg-gray-50 border border-gray-200 text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-black">
              <option v-for="o in EXPIRY_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </label>
          <label class="block">
            <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Para (opcional)</span>
            <input v-model="form.label" type="text" maxlength="80" placeholder="Ej: Artista, socio" class="w-full bg-gray-50 border border-gray-200 text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-black" />
          </label>
        </div>
        <label class="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
          <input v-model="form.singleUse" type="checkbox" class="mt-1" />
          <span>De un solo uso <span class="block text-xs text-gray-500">Solo funciona en el primer navegador que lo abra.</span></span>
        </label>
        <button type="submit" :disabled="saving" class="w-full py-2 bg-black text-white rounded-lg font-medium text-sm hover:bg-gray-900 transition disabled:opacity-60 flex items-center justify-center gap-2">
          <Link2 :size="16" /> {{ saving ? 'Creando...' : 'Crear link de vista previa' }}
        </button>
        <p v-if="error" class="text-sm text-red-600" role="alert">{{ error }}</p>
      </form>

      <ul v-if="!loading && links.length" class="mt-4 divide-y divide-gray-100 text-xs">
        <li v-for="l in links.slice(0, 8)" :key="l.id" class="py-2 flex items-center justify-between gap-2">
          <div class="min-w-0">
            <span class="px-2 py-0.5 rounded font-medium" :class="STATUS_CLASS[l.status]">{{ STATUS_LABEL[l.status] }}</span>
            <span class="ml-1 text-gray-700">{{ l.label || (l.created_via === 'dashboard' ? 'Link' : 'Creado por tu IA') }}</span>
            <span class="block text-gray-400 mt-0.5">
              {{ l.single_use ? 'Un solo uso' : 'Varios usos' }} ·
              {{ l.expires_at ? `vence ${fmtDate(l.expires_at)}` : 'sin vencimiento' }} ·
              {{ l.view_count }} {{ l.view_count === 1 ? 'visita' : 'visitas' }}
            </span>
          </div>
          <button v-if="l.status === 'active'" type="button" :disabled="busyId === l.id" @click="revoke(l)" class="text-red-600 font-medium hover:underline shrink-0 disabled:opacity-50">Revocar</button>
        </li>
      </ul>
    </template>
  </div>
</template>
