<script setup>
import { ref, onMounted } from 'vue'
import { Users, Copy, Check, Link2 } from 'lucide-vue-next'

// Links privados de promotor / RRPP (/api/events/promoter-links, src/lib/promoterLinks.ts): el promotor abre su link
// en el celular, sin cuenta, y ve solo sus ventas (las que llegaron con su ?ref=), sin datos de compradores. La URL
// con el token solo se muestra al crearla.

const props = defineProps({
  eventId: { type: Number, required: true },
})

const links = ref([])
const loading = ref(true)
const unavailable = ref(false)
const canCreateAll = ref(true)
const form = ref({ name: '', allEvents: true })
const saving = ref(false)
const error = ref('')
const created = ref(null)
const copied = ref(false)
const busyId = ref(null)

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' }) : '')

const load = async () => {
  loading.value = true
  try {
    const res = await fetch(`/api/events/promoter-links?event_id=${props.eventId}`)
    const data = await res.json().catch(() => ({}))
    if (res.status === 503) unavailable.value = true
    links.value = res.ok ? data.links || [] : []
    canCreateAll.value = res.ok ? data.can_create_all !== false : true
    if (!canCreateAll.value) form.value.allEvents = false
  } finally {
    loading.value = false
  }
}
onMounted(load)

const create = async () => {
  error.value = ''
  saving.value = true
  try {
    const res = await fetch('/api/events/promoter-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: props.eventId, name: form.value.name, allEvents: canCreateAll.value && form.value.allEvents }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || 'No se pudo crear el link')
    created.value = { url: data.url, name: data.link.name }
    links.value = [data.link, ...links.value]
    form.value.name = ''
  } catch (e) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}

const revoke = async (link) => {
  if (!confirm(`¿Revocar el link de ${link.name}? Ya no podrá ver sus ventas (las ventas con su link se siguen contando).`)) return
  busyId.value = link.id
  try {
    const res = await fetch(`/api/events/promoter-links?id=${encodeURIComponent(link.id)}`, { method: 'DELETE' })
    if (res.ok) links.value = links.value.map((l) => (l.id === link.id ? { ...l, status: 'revoked' } : l))
  } finally {
    busyId.value = null
  }
}

const copy = async () => {
  try {
    await navigator.clipboard.writeText(created.value.url)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch { /* sin permiso de portapapeles */ }
}
</script>

<template>
  <div class="bg-white p-4 sm:p-6 rounded-xl border border-gray-200 shadow-sm" data-testid="promoter-links">
    <h3 class="font-bold text-lg mb-1 flex items-center gap-2"><Users :size="18" /> Promotores y RRPP</h3>
    <p class="text-sm text-gray-500 mb-4">
      Cada promotor recibe un link privado: lo abre en su celular, sin cuenta, y ve cuántas entradas vendió con su link en cada
      evento y función. No ve datos de quienes compraron.
    </p>

    <p v-if="unavailable" class="text-sm text-amber-700">Los links de promotor estarán disponibles en unos minutos.</p>

    <template v-else>
      <div v-if="created" class="mb-4 p-3 rounded-lg bg-green-50 border border-green-200 space-y-2">
        <p class="text-xs font-semibold text-green-800">Link de {{ created.name }} creado. Envíaselo ahora: no lo volveremos a mostrar.</p>
        <div class="flex gap-2">
          <input :value="created.url" readonly class="flex-1 min-w-0 bg-white border border-green-200 text-xs rounded-lg px-3 py-2 outline-none" @focus="$event.target.select()" />
          <button type="button" @click="copy" class="px-3 py-2 bg-black text-white rounded-lg text-xs flex items-center gap-1 shrink-0">
            <component :is="copied ? Check : Copy" :size="14" /> {{ copied ? 'Copiado' : 'Copiar' }}
          </button>
        </div>
        <p class="text-xs text-green-800">Ahí mismo copia su link para compartir cada evento a la venta.</p>
        <button type="button" class="text-xs underline text-green-800" @click="created = null">Crear otro link</button>
      </div>

      <form v-else @submit.prevent="create" class="space-y-3">
        <label class="block">
          <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre del promotor</span>
          <input v-model="form.name" type="text" maxlength="80" required placeholder="Ej: Cami Rojas" data-testid="promoter-name"
            class="w-full bg-gray-50 border border-gray-200 text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-black" />
        </label>
        <label v-if="canCreateAll" class="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
          <input v-model="form.allEvents" type="checkbox" class="mt-1" />
          <span>Para todos tus eventos <span class="block text-xs text-gray-500">Un solo link para todas las noches. Desmárcalo para que vea solo este evento.</span></span>
        </label>
        <button type="submit" :disabled="saving || !form.name.trim()" class="w-full py-2 bg-black text-white rounded-lg font-medium text-sm hover:bg-gray-900 transition disabled:opacity-60 flex items-center justify-center gap-2">
          <Link2 :size="16" /> {{ saving ? 'Creando...' : 'Crear link de promotor' }}
        </button>
        <p v-if="error" class="text-sm text-red-600" role="alert">{{ error }}</p>
      </form>

      <ul v-if="!loading && links.length" class="mt-4 divide-y divide-gray-100 text-xs">
        <li v-for="l in links.slice(0, 20)" :key="l.id" class="py-2 flex items-center justify-between gap-2">
          <div class="min-w-0">
            <span class="px-2 py-0.5 rounded font-medium" :class="l.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'">
              {{ l.status === 'active' ? 'Activo' : 'Revocado' }}
            </span>
            <span class="ml-1 text-gray-700 break-words">{{ l.name }}</span>
            <span class="block text-gray-400 mt-0.5">
              ref={{ l.ref }} · {{ l.scope === 'all_events' ? 'todos tus eventos' : 'solo este evento' }} ·
              {{ l.opens ? `abierto ${l.opens} ${l.opens === 1 ? 'vez' : 'veces'}, último ${fmtDate(l.last_opened_at)}` : 'aún sin abrir' }}
            </span>
          </div>
          <button v-if="l.status === 'active'" type="button" :disabled="busyId === l.id" @click="revoke(l)" class="text-red-600 hover:underline shrink-0 disabled:opacity-50">Revocar</button>
        </li>
      </ul>
    </template>
  </div>
</template>
