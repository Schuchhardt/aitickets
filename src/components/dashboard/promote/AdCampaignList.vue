<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  Megaphone, Plus, TrendingUp, DollarSign, Eye, Play, Pause,
  AlertCircle, CheckCircle, Clock, BarChart3, Unplug, ExternalLink,
  ArrowLeft, RefreshCw, Target
} from 'lucide-vue-next'

const props = defineProps({
  connectionsJson: { type: String, default: '[]' },
  campaignsJson: { type: String, default: '[]' },
  statsJson: { type: String, default: '{}' },
  connectedPlatform: { type: String, default: '' },
  errorType: { type: String, default: '' },
})

const connections = ref(JSON.parse(props.connectionsJson))
const campaigns = ref(JSON.parse(props.campaignsJson))
const stats = ref(JSON.parse(props.statsJson))
const activeFilter = ref('all')
const loading = ref({})
const syncing = ref(false)

const notification = ref({ show: false, type: '', message: '' })

onMounted(() => {
  if (props.connectedPlatform === 'meta') {
    showNotification('success', 'Meta Ads conectado exitosamente')
  }
  if (props.errorType) {
    const messages = {
      meta_oauth_failed: 'Error al conectar Meta Ads. Intenta nuevamente.',
      missing_params: 'Error en los parámetros de conexión.',
      token_exchange: 'Error al obtener token de acceso de Meta.',
      no_ad_account: 'No se encontró una cuenta de anuncios en Meta. Crea una en business.facebook.com.',
      db_error: 'Error al guardar la conexión.',
      invalid_state: 'Estado de sesión inválido.',
      internal: 'Error interno. Intenta nuevamente.',
    }
    showNotification('error', messages[props.errorType] || 'Error desconocido.')
  }
})

function showNotification(type, message) {
  notification.value = { show: true, type, message }
  setTimeout(() => { notification.value.show = false }, 5000)
}

const hasConnection = computed(() => connections.value.some(c => c.status === 'active'))

// Fix #4: Token expiration detection
const expiringConnections = computed(() => {
  const now = new Date()
  const warnThreshold = 7 * 24 * 60 * 60 * 1000 // 7 days before expiry
  return connections.value.filter(c => {
    if (!c.token_expires_at) return false
    const expiresAt = new Date(c.token_expires_at)
    return expiresAt.getTime() - now.getTime() < warnThreshold
  })
})

const expiredConnections = computed(() => {
  const now = new Date()
  return connections.value.filter(c => {
    if (!c.token_expires_at) return false
    return new Date(c.token_expires_at) < now
  })
})

const getTokenStatus = (conn) => {
  if (!conn.token_expires_at) return 'active'
  const now = new Date()
  const expiresAt = new Date(conn.token_expires_at)
  if (expiresAt < now) return 'expired'
  const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  if (daysLeft <= 7) return 'expiring'
  return 'active'
}

const getDaysUntilExpiry = (conn) => {
  if (!conn.token_expires_at) return null
  const now = new Date()
  const expiresAt = new Date(conn.token_expires_at)
  return Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

const reconnectMeta = async () => {
  await connectMeta()
}

const filteredCampaigns = computed(() => {
  if (activeFilter.value === 'all') return campaigns.value
  return campaigns.value.filter(c => c.status === activeFilter.value)
})

const statusLabels = {
  active: 'Activa',
  paused: 'Pausada',
  completed: 'Completada',
  rejected: 'Rechazada',
  pending_review: 'En revisión',
  draft: 'Borrador',
}

const statusColors = {
  active: 'bg-green-50 text-green-700',
  paused: 'bg-yellow-50 text-yellow-700',
  completed: 'bg-blue-50 text-blue-700',
  rejected: 'bg-red-50 text-red-700',
  pending_review: 'bg-orange-50 text-orange-700',
  draft: 'bg-gray-50 text-gray-600',
}

const formatCurrency = (amount) => {
  if (!amount) return '$0'
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(amount)
}

const formatNumber = (num) => {
  if (!num) return '0'
  return new Intl.NumberFormat('es-CL').format(num)
}

const connectMeta = async () => {
  try {
    loading.value.connect = true
    const res = await fetch('/api/promote/ads/connect', { method: 'POST' })
    const data = await res.json()
    if (data.redirect_url) {
      window.location.href = data.redirect_url
    } else {
      showNotification('error', data.message || 'Error al iniciar conexión')
    }
  } catch (e) {
    showNotification('error', 'Error al conectar con Meta')
  } finally {
    loading.value.connect = false
  }
}

const disconnectMeta = async (connectionId) => {
  if (!confirm('¿Desconectar cuenta de Meta Ads? Las campañas activas deben pausarse primero.')) return
  try {
    const res = await fetch('/api/promote/ads/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId }),
    })
    const data = await res.json()
    if (res.ok) {
      connections.value = connections.value.filter(c => c.id !== connectionId)
      showNotification('success', 'Cuenta desconectada')
    } else {
      showNotification('error', data.message)
    }
  } catch (e) {
    showNotification('error', 'Error al desconectar')
  }
}

const toggleCampaign = async (campaign) => {
  const action = campaign.status === 'active' ? 'pause' : 'activate'
  loading.value[campaign.id] = true
  try {
    const res = await fetch('/api/promote/ads/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaignId: campaign.id, action }),
    })
    const data = await res.json()
    if (res.ok) {
      campaign.status = data.status
      showNotification('success', data.message)
    } else {
      showNotification('error', data.message)
    }
  } catch (e) {
    showNotification('error', 'Error al cambiar estado')
  } finally {
    loading.value[campaign.id] = false
  }
}

const syncStats = async () => {
  syncing.value = true
  try {
    const res = await fetch('/api/promote/ads/stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const data = await res.json()
    if (res.ok && data.campaigns) {
      // Update local campaigns with fresh stats
      for (const updated of data.campaigns) {
        const idx = campaigns.value.findIndex(c => c.id === updated.id)
        if (idx !== -1) {
          campaigns.value[idx] = { ...campaigns.value[idx], ...updated }
        }
      }
      // Recalculate stats
      stats.value.activeCampaigns = campaigns.value.filter(c => c.status === 'active').length
      stats.value.totalSpend = campaigns.value.reduce((sum, c) => sum + (c.spend || 0), 0)
      stats.value.totalImpressions = campaigns.value.reduce((sum, c) => sum + (c.impressions || 0), 0)
      showNotification('success', 'Estadísticas actualizadas')
    }
  } catch (e) {
    showNotification('error', 'Error al sincronizar estadísticas')
  } finally {
    syncing.value = false
  }
}
</script>

<template>
  <div>
    <!-- Notification -->
    <Transition name="slide-down">
      <div
        v-if="notification.show"
        class="fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium"
        :class="notification.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'"
      >
        <CheckCircle v-if="notification.type === 'success'" :size="16" />
        <AlertCircle v-else :size="16" />
        {{ notification.message }}
        <button @click="notification.show = false" class="ml-2 text-current opacity-60 hover:opacity-100">&times;</button>
      </div>
    </Transition>

    <!-- Header -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
      <div class="flex items-center gap-3">
        <a href="/dashboard/promote" class="text-gray-400 hover:text-gray-600 transition">
          <ArrowLeft :size="20" />
        </a>
        <div>
          <h1 class="text-3xl font-bold font-[Unbounded] mb-1">Meta Ads</h1>
          <p class="text-gray-600">Crea y gestiona campañas de anuncios en Facebook e Instagram.</p>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <button
          v-if="campaigns.length > 0"
          @click="syncStats"
          :disabled="syncing"
          class="inline-flex items-center gap-2 border border-gray-200 text-gray-700 px-4 py-2.5 rounded-lg hover:bg-gray-50 transition font-medium text-sm"
        >
          <RefreshCw :size="16" :class="{ 'animate-spin': syncing }" />
          Sincronizar
        </button>
        <a
          v-if="hasConnection"
          href="/dashboard/promote/ads/create"
          class="inline-flex items-center gap-2 bg-black text-white px-5 py-2.5 rounded-lg hover:bg-gray-800 transition font-medium"
        >
          <Plus :size="20" />
          Crear Campaña
        </a>
      </div>
    </div>

    <!-- Stats Cards -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
      <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div class="flex items-center gap-3 mb-2">
          <div class="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
            <Target :size="20" class="text-green-600" />
          </div>
          <span class="text-sm text-gray-500">Campañas Activas</span>
        </div>
        <p class="text-2xl font-bold">{{ stats.activeCampaigns }}</p>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div class="flex items-center gap-3 mb-2">
          <div class="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center">
            <DollarSign :size="20" class="text-purple-600" />
          </div>
          <span class="text-sm text-gray-500">Gasto Total</span>
        </div>
        <p class="text-2xl font-bold">{{ formatCurrency(stats.totalSpend) }}</p>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div class="flex items-center gap-3 mb-2">
          <div class="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
            <Eye :size="20" class="text-blue-600" />
          </div>
          <span class="text-sm text-gray-500">Impresiones</span>
        </div>
        <p class="text-2xl font-bold">{{ formatNumber(stats.totalImpressions) }}</p>
      </div>
    </div>

    <!-- Meta Connection -->
    <div class="mb-8">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold">Cuentas de Meta Ads</h2>
        <button
          v-if="hasConnection"
          @click="reconnectMeta"
          :disabled="loading.connect"
          class="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
        >
          <RefreshCw :size="14" />
          Reconectar
        </button>
      </div>

      <!-- Token expiration warning -->
      <div
        v-if="expiredConnections.length > 0"
        class="mb-4 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3"
      >
        <AlertCircle :size="20" class="text-red-500 shrink-0 mt-0.5" />
        <div class="flex-1">
          <p class="text-sm font-medium text-red-800">Token de Meta expirado</p>
          <p class="text-xs text-red-600 mt-1">Tu conexión con Meta ha expirado. Reconecta tu cuenta para seguir gestionando campañas.</p>
        </div>
        <button
          @click="reconnectMeta"
          :disabled="loading.connect"
          class="shrink-0 text-sm bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition font-medium"
        >
          Reconectar
        </button>
      </div>

      <div
        v-else-if="expiringConnections.length > 0"
        class="mb-4 bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-start gap-3"
      >
        <Clock :size="20" class="text-yellow-600 shrink-0 mt-0.5" />
        <div class="flex-1">
          <p class="text-sm font-medium text-yellow-800">Token próximo a expirar</p>
          <p class="text-xs text-yellow-600 mt-1">
            Tu conexión con Meta expira en {{ getDaysUntilExpiry(expiringConnections[0]) }} días. Reconecta para renovar el acceso.
          </p>
        </div>
        <button
          @click="reconnectMeta"
          :disabled="loading.connect"
          class="shrink-0 text-sm bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 transition font-medium"
        >
          Renovar
        </button>
      </div>
      
      <div v-if="!hasConnection && expiredConnections.length === 0" class="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
        <div class="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Megaphone :size="32" class="text-blue-600" />
        </div>
        <h3 class="text-lg font-semibold mb-2">Conecta tu cuenta de Meta Ads</h3>
        <p class="text-gray-500 mb-6 max-w-md mx-auto">
          Vincula tu cuenta de Meta Business para crear campañas de anuncios en Facebook e Instagram directamente desde aquí.
        </p>
        <button
          @click="connectMeta"
          :disabled="loading.connect"
          class="inline-flex items-center gap-2 bg-[#1877F2] text-white px-6 py-3 rounded-lg hover:bg-[#1565C0] transition font-medium"
        >
          <svg v-if="!loading.connect" class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
          </svg>
          <span v-if="loading.connect" class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
          Conectar con Facebook
        </button>
      </div>

      <div v-if="connections.length > 0" class="space-y-3">
        <div
          v-for="conn in connections"
          :key="conn.id"
          class="bg-white rounded-xl shadow-sm border p-5 flex items-center justify-between"
          :class="getTokenStatus(conn) === 'expired' ? 'border-red-200' : getTokenStatus(conn) === 'expiring' ? 'border-yellow-200' : 'border-gray-100'"
        >
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 bg-gradient-to-br from-[#1877F2] to-[#0866FF] rounded-xl flex items-center justify-center">
              <svg class="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
              </svg>
            </div>
            <div>
              <p class="font-semibold">{{ conn.account_name }}</p>
              <p class="text-sm text-gray-500">
                {{ conn.meta_ad_account_id || 'Meta Ads' }}
                <template v-if="getDaysUntilExpiry(conn) !== null">
                  · {{ getDaysUntilExpiry(conn) > 0 ? `Expira en ${getDaysUntilExpiry(conn)} días` : 'Expirado' }}
                </template>
              </p>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <span 
              class="text-xs px-2 py-1 rounded-full"
              :class="{
                'bg-green-50 text-green-700': getTokenStatus(conn) === 'active',
                'bg-yellow-50 text-yellow-700': getTokenStatus(conn) === 'expiring',
                'bg-red-50 text-red-700': getTokenStatus(conn) === 'expired',
              }"
            >
              {{ getTokenStatus(conn) === 'active' ? 'Activa' : getTokenStatus(conn) === 'expiring' ? 'Por expirar' : 'Expirada' }}
            </span>
            <button
              @click="disconnectMeta(conn.id)"
              class="p-2 text-gray-400 hover:text-red-500 transition"
              title="Desconectar"
            >
              <Unplug :size="18" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Campaigns -->
    <div>
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold">Campañas</h2>
        
        <!-- Status Filter -->
        <div class="flex gap-1 bg-gray-100 rounded-lg p-1">
          <button
            v-for="filter in ['all', 'active', 'paused', 'completed']"
            :key="filter"
            @click="activeFilter = filter"
            class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            :class="activeFilter === filter ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-700'"
          >
            {{ filter === 'all' ? 'Todas' : statusLabels[filter] || filter }}
          </button>
        </div>
      </div>

      <div v-if="filteredCampaigns.length === 0" class="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
        <BarChart3 :size="40" class="text-gray-300 mx-auto mb-3" />
        <p class="text-gray-500">
          {{ campaigns.length === 0 ? 'No hay campañas creadas aún.' : 'Sin campañas con este filtro.' }}
        </p>
        <a
          v-if="hasConnection && campaigns.length === 0"
          href="/dashboard/promote/ads/create"
          class="inline-flex items-center gap-2 mt-4 bg-black text-white px-5 py-2.5 rounded-lg hover:bg-gray-800 transition font-medium text-sm"
        >
          <Plus :size="16" />
          Crear primera campaña
        </a>
      </div>

      <div v-else class="space-y-4">
        <div
          v-for="campaign in filteredCampaigns"
          :key="campaign.id"
          class="bg-white rounded-xl shadow-sm border border-gray-100 p-5"
        >
          <div class="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <!-- Campaign Info -->
            <div class="flex-1">
              <div class="flex items-center gap-3 mb-2">
                <h3 class="font-semibold text-lg">{{ campaign.name }}</h3>
                <span
                  class="text-xs px-2 py-0.5 rounded-full font-medium"
                  :class="statusColors[campaign.status] || 'bg-gray-50 text-gray-600'"
                >
                  {{ statusLabels[campaign.status] || campaign.status }}
                </span>
              </div>
              
              <p v-if="campaign.events" class="text-sm text-gray-500 mb-3">
                {{ campaign.events.title || campaign.events.name }}
              </p>

              <!-- Metrics Row -->
              <div v-if="campaign.impressions || campaign.clicks || campaign.spend" class="flex flex-wrap gap-6 text-sm">
                <div>
                  <span class="text-gray-400">Impresiones</span>
                  <p class="font-semibold">{{ formatNumber(campaign.impressions) }}</p>
                </div>
                <div>
                  <span class="text-gray-400">Clicks</span>
                  <p class="font-semibold">{{ formatNumber(campaign.clicks) }}</p>
                </div>
                <div>
                  <span class="text-gray-400">Alcance</span>
                  <p class="font-semibold">{{ formatNumber(campaign.reach) }}</p>
                </div>
                <div>
                  <span class="text-gray-400">Gasto</span>
                  <p class="font-semibold">{{ formatCurrency(campaign.spend) }}</p>
                </div>
                <div>
                  <span class="text-gray-400">CPC</span>
                  <p class="font-semibold">{{ formatCurrency(campaign.cpc) }}</p>
                </div>
                <div>
                  <span class="text-gray-400">CPM</span>
                  <p class="font-semibold">{{ formatCurrency(campaign.cpm) }}</p>
                </div>
              </div>

              <!-- Budget info -->
              <div class="flex flex-wrap items-center gap-4 mt-3 text-xs text-gray-400">
                <span>Presupuesto diario: {{ formatCurrency(campaign.daily_budget) }}</span>
                <span v-if="campaign.total_budget">Total: {{ formatCurrency(campaign.total_budget) }}</span>
                <span v-if="campaign.start_date">Inicio: {{ new Date(campaign.start_date).toLocaleDateString('es-CL') }}</span>
                <span v-if="campaign.end_date">Fin: {{ new Date(campaign.end_date).toLocaleDateString('es-CL') }}</span>
              </div>

              <p v-if="campaign.error_message" class="text-xs text-red-500 mt-2 flex items-center gap-1">
                <AlertCircle :size="12" />
                {{ campaign.error_message }}
              </p>
            </div>

            <!-- Actions -->
            <div class="flex items-center gap-2 shrink-0">
              <button
                v-if="campaign.status === 'active' || campaign.status === 'paused'"
                @click="toggleCampaign(campaign)"
                :disabled="loading[campaign.id]"
                class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition"
                :class="campaign.status === 'active' 
                  ? 'border-yellow-200 text-yellow-700 hover:bg-yellow-50' 
                  : 'border-green-200 text-green-700 hover:bg-green-50'"
              >
                <span v-if="loading[campaign.id]" class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
                <Pause v-else-if="campaign.status === 'active'" :size="14" />
                <Play v-else :size="14" />
                {{ campaign.status === 'active' ? 'Pausar' : 'Activar' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.3s ease;
}
.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
