<script setup>
// Pestaña "Anuncios" de /dashboard/promote: cuenta publicitaria de Meta conectada vía Zernio y anuncios creados desde
// AI Tickets con sus métricas (Meta) y las entradas que vendieron (utm_campaign=ad-<id>). Al abrirla se sincroniza
// con Zernio (POST /api/promote/ads/stats).
import { ref, computed, onMounted } from 'vue'
import {
  Megaphone, Plus, Play, Pause, XCircle, AlertCircle, CheckCircle, Loader2, Unplug, RefreshCw, Ticket, ExternalLink,
} from 'lucide-vue-next'

const props = defineProps({
  adsJson: { type: String, default: '{}' },
  canManage: { type: Boolean, default: false },
})

const initial = JSON.parse(props.adsJson)
const enabled = ref(Boolean(initial.enabled))
const connections = ref(initial.connections || [])
const campaigns = ref(initial.campaigns || [])
const syncing = ref(false)
const busy = ref({})
const notice = ref({ type: '', message: '' })

const show = (type, message) => {
  notice.value = { type, message }
  setTimeout(() => { if (notice.value.message === message) notice.value = { type: '', message: '' } }, 6000)
}

const sync = async () => {
  syncing.value = true
  try {
    const res = await fetch('/api/promote/ads/stats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      enabled.value = Boolean(data.enabled)
      connections.value = data.connections || []
      campaigns.value = data.campaigns || []
    }
  } finally {
    syncing.value = false
  }
}
onMounted(() => { if (enabled.value) sync() })

const activeConnections = computed(() => connections.value.filter((c) => c.status === 'active'))

const connect = async () => {
  busy.value.connect = true
  try {
    const res = await fetch('/api/promote/ads/connect', { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    if (data.redirect_url) { window.location.href = data.redirect_url; return }
    if (res.ok && data.connected) { show('success', 'Cuenta publicitaria conectada'); await sync() }
    else show('error', data.message || 'No se pudo conectar la cuenta')
  } catch {
    show('error', 'No se pudo conectar la cuenta')
  } finally {
    busy.value.connect = false
  }
}

const disconnect = async (conn) => {
  if (!confirm(`¿Desconectar ${conn.account_name} de AI Tickets? Tus anuncios anteriores y sus resultados se mantienen.`)) return
  busy.value[`c${conn.id}`] = true
  try {
    const res = await fetch('/api/promote/ads/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connectionId: conn.id }) })
    const data = await res.json().catch(() => ({}))
    if (res.ok) { connections.value = connections.value.filter((c) => c.id !== conn.id); show('success', data.message) }
    else show('error', data.message || 'No se pudo desconectar')
  } finally {
    busy.value[`c${conn.id}`] = false
  }
}

const changeStatus = async (ad, action) => {
  if (action === 'cancel' && !confirm('¿Cancelar este anuncio? Deja de mostrarse y no se puede reactivar.')) return
  busy.value[ad.id] = true
  try {
    const res = await fetch('/api/promote/ads/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaignId: ad.id, action }) })
    const data = await res.json().catch(() => ({}))
    if (res.ok) { ad.status = data.status; show('success', data.message) }
    else show('error', data.message || 'No se pudo cambiar el anuncio')
  } finally {
    busy.value[ad.id] = false
  }
}

const STATUS = {
  creating: { label: 'Creando', cls: 'bg-gray-100 text-gray-600' },
  pending_review: { label: 'En revisión de Meta', cls: 'bg-orange-50 text-orange-700' },
  active: { label: 'Activo', cls: 'bg-green-50 text-green-700' },
  paused: { label: 'Pausado', cls: 'bg-yellow-50 text-yellow-700' },
  completed: { label: 'Terminado', cls: 'bg-blue-50 text-blue-700' },
  rejected: { label: 'Rechazado por Meta', cls: 'bg-red-50 text-red-700' },
  cancelled: { label: 'Cancelado', cls: 'bg-gray-100 text-gray-500' },
  error: { label: 'Con error', cls: 'bg-red-50 text-red-700' },
}

const money = (n, currency = 'CLP') => {
  const v = Number(n) || 0
  return !currency || currency === 'CLP' ? `$${Math.round(v).toLocaleString('es-CL')}` : `${currency} ${v.toLocaleString('es-CL', { maximumFractionDigits: 2 })}`
}
const num = (n) => (Number(n) || 0).toLocaleString('es-CL')
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }) : '')

// Totales (solo anuncios en CLP para no mezclar monedas)
const totals = computed(() => {
  const clp = campaigns.value.filter((c) => !c.currency || c.currency === 'CLP')
  const spend = clp.reduce((s, c) => s + (Number(c.spend) || 0), 0)
  const tickets = campaigns.value.reduce((s, c) => s + (c.sales?.tickets || 0), 0)
  const revenue = campaigns.value.reduce((s, c) => s + (c.sales?.revenue_clp || 0), 0)
  const clpTickets = clp.reduce((s, c) => s + (c.sales?.tickets || 0), 0)
  return { spend, tickets, revenue, costPerTicket: clpTickets && spend ? Math.round(spend / clpTickets) : null }
})
</script>

<template>
  <div class="space-y-6">
    <div v-if="notice.message" class="flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium" :class="notice.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'">
      <CheckCircle v-if="notice.type === 'success'" :size="16" /><AlertCircle v-else :size="16" />
      {{ notice.message }}
    </div>

    <div v-if="!enabled" class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 md:p-10 text-center">
      <Megaphone :size="32" class="mx-auto text-gray-400 mb-3" />
      <h3 class="text-lg font-bold mb-1">Anuncios en Facebook e Instagram</h3>
      <p class="text-gray-500">Muy pronto podrás crear anuncios pagados para tus eventos desde aquí.</p>
    </div>

    <template v-else>
      <!-- Cuenta publicitaria -->
      <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 class="font-semibold">Cuenta publicitaria de Meta</h3>
            <p class="text-sm text-gray-500">Meta le cobra el gasto de tus anuncios directo a esta cuenta. AI Tickets mide cuántas entradas vende cada anuncio.</p>
          </div>
          <button v-if="canManage" type="button" @click="connect" :disabled="busy.connect" class="shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 text-sm font-medium disabled:opacity-50">
            <Loader2 v-if="busy.connect" :size="16" class="animate-spin" />
            {{ connections.length ? 'Actualizar cuentas' : 'Conectar con Meta' }}
          </button>
        </div>
        <div v-if="connections.length" class="mt-4 divide-y divide-gray-100">
          <div v-for="c in connections" :key="c.id" class="py-2 flex items-center justify-between gap-3 text-sm">
            <div class="min-w-0">
              <p class="font-medium truncate">{{ c.account_name }} <span class="text-gray-400 font-normal">· {{ c.currency || 'CLP' }}</span></p>
              <p v-if="c.status === 'unusable'" class="text-xs text-red-600">{{ c.unusable_reason || 'Meta no permite anunciar con esta cuenta' }}</p>
              <p v-else-if="c.minimum_daily_budget" class="text-xs text-gray-500">Mínimo diario: {{ money(c.minimum_daily_budget, c.currency) }}</p>
            </div>
            <button v-if="canManage" type="button" @click="disconnect(c)" :disabled="busy[`c${c.id}`]" class="shrink-0 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-600">
              <Unplug :size="14" /> Desconectar
            </button>
          </div>
        </div>
        <p v-else-if="!canManage" class="mt-3 text-sm text-gray-500">Pídele al dueño de la productora que conecte la cuenta publicitaria.</p>
      </div>

      <!-- Resumen -->
      <div v-if="campaigns.length" class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <p class="text-sm text-gray-500">Invertido</p>
          <p class="text-2xl font-bold">{{ money(totals.spend) }}</p>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <p class="text-sm text-gray-500">Entradas vendidas por anuncios</p>
          <p class="text-2xl font-bold">{{ num(totals.tickets) }} <span class="text-sm font-normal text-gray-500">· {{ money(totals.revenue) }}</span></p>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <p class="text-sm text-gray-500">Costo por entrada</p>
          <p class="text-2xl font-bold">{{ totals.costPerTicket != null ? money(totals.costPerTicket) : '—' }}</p>
        </div>
      </div>

      <!-- Anuncios -->
      <div class="flex items-center justify-between gap-3">
        <h3 class="font-semibold">Tus anuncios</h3>
        <div class="flex items-center gap-2">
          <button type="button" @click="sync" :disabled="syncing" class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 disabled:opacity-50">
            <RefreshCw :size="14" :class="syncing ? 'animate-spin' : ''" /> Actualizar
          </button>
          <a v-if="canManage && activeConnections.length" href="/dashboard/promote/ads/create" class="inline-flex items-center gap-1.5 bg-black text-white px-4 py-2 rounded-lg hover:bg-gray-800 transition text-sm font-medium">
            <Plus :size="16" /> Crear anuncio
          </a>
        </div>
      </div>

      <div v-if="!campaigns.length" class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-center text-gray-500 text-sm">
        {{ activeConnections.length ? 'Aún no creas anuncios. Empieza con un presupuesto chico (3 a 5 días) y mira cuántas entradas vende.' : 'Conecta tu cuenta publicitaria para crear tu primer anuncio.' }}
      </div>

      <div v-for="ad in campaigns" :key="ad.id" class="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-5">
        <div class="flex gap-4">
          <img v-if="ad.image_urls?.[0]" :src="ad.image_urls[0]" alt="" class="w-16 h-16 rounded-lg object-cover shrink-0 hidden sm:block" />
          <div class="flex-1 min-w-0">
            <div class="flex flex-wrap items-center gap-2 mb-1">
              <span class="text-xs px-2 py-0.5 rounded-full font-medium" :class="(STATUS[ad.status] || STATUS.creating).cls">{{ (STATUS[ad.status] || STATUS.creating).label }}</span>
              <span class="text-xs text-gray-400">{{ ad.ad_type === 'boost' ? 'Publicación promocionada' : 'Anuncio' }} · #{{ ad.id }}</span>
            </div>
            <p class="font-semibold truncate">{{ ad.event?.name || ad.name }}</p>
            <p class="text-sm text-gray-600 truncate">{{ ad.headline || ad.ad_copy }}</p>
            <p class="text-xs text-gray-500 mt-1">
              {{ money(ad.daily_budget, ad.currency) }}/día · {{ day(ad.start_date) }} al {{ day(ad.end_date) }} · máx. {{ money(ad.total_budget, ad.currency) }}
            </p>
            <p v-if="ad.error_message && ['error', 'rejected', 'creating'].includes(ad.status)" class="text-xs text-red-600 mt-1">{{ ad.error_message }}</p>
          </div>
        </div>

        <div class="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
          <div><p class="text-xs text-gray-500">Gastado</p><p class="font-semibold">{{ money(ad.spend, ad.currency) }}</p></div>
          <div><p class="text-xs text-gray-500">Personas</p><p class="font-semibold">{{ num(ad.reach) }}</p></div>
          <div><p class="text-xs text-gray-500">Clics</p><p class="font-semibold">{{ num(ad.clicks) }}<span v-if="ad.ctr" class="text-xs text-gray-400"> · {{ Number(ad.ctr).toFixed(1) }}%</span></p></div>
          <div><p class="text-xs text-gray-500 flex items-center gap-1"><Ticket :size="12" /> Entradas</p><p class="font-semibold">{{ num(ad.sales?.tickets) }}<span class="text-xs text-gray-400"> · {{ money(ad.sales?.revenue_clp) }}</span></p></div>
          <div><p class="text-xs text-gray-500">Costo por entrada</p><p class="font-semibold">{{ ad.cost_per_ticket != null ? money(ad.cost_per_ticket, ad.currency) : '—' }}<span v-if="ad.roas" class="text-xs text-gray-400"> · {{ ad.roas }}x</span></p></div>
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-2">
          <button v-if="['active', 'pending_review'].includes(ad.status)" type="button" @click="changeStatus(ad, 'pause')" :disabled="busy[ad.id]" class="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
            <Pause :size="14" /> Pausar
          </button>
          <button v-if="ad.status === 'paused' && canManage" type="button" @click="changeStatus(ad, 'activate')" :disabled="busy[ad.id]" class="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
            <Play :size="14" /> Activar
          </button>
          <button v-if="['active', 'paused', 'pending_review'].includes(ad.status)" type="button" @click="changeStatus(ad, 'cancel')" :disabled="busy[ad.id]" class="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-50">
            <XCircle :size="14" /> Cancelar
          </button>
          <a v-if="ad.destination_url" :href="ad.destination_url" target="_blank" rel="noopener" class="ml-auto inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800">
            Link del anuncio <ExternalLink :size="12" />
          </a>
        </div>
      </div>
    </template>
  </div>
</template>
