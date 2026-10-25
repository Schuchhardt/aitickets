<script setup>
import { ref, computed, onMounted } from 'vue'
import { 
  Megaphone, Plus, Instagram, Facebook, Send, Calendar, 
  TrendingUp, Clock, AlertCircle, CheckCircle, XCircle,
  ExternalLink, Unplug, Target, DollarSign
} from 'lucide-vue-next'
import ConnectedAccounts from './ConnectedAccounts.vue'
import PostHistory from './PostHistory.vue'
import AdCampaignList from './AdCampaignList.vue'

const props = defineProps({
  accountsJson: { type: String, default: '[]' },
  postsJson: { type: String, default: '[]' },
  eventsJson: { type: String, default: '[]' },
  statsJson: { type: String, default: '{}' },
  connectedPlatform: { type: String, default: '' },
  errorType: { type: String, default: '' },
  initialTab: { type: String, default: '' },
  adsJson: { type: String, default: '{}' },
  canManageAds: { type: Boolean, default: false },
})

const accounts = ref(JSON.parse(props.accountsJson))
const posts = ref(JSON.parse(props.postsJson))
const events = ref(JSON.parse(props.eventsJson))
const stats = ref(JSON.parse(props.statsJson))
const ads = JSON.parse(props.adsJson)
const adsEnabled = Boolean(ads.enabled)
const activeTab = ref(['posts', 'ads'].includes(props.initialTab) ? props.initialTab : 'overview')

const notification = ref({ show: false, type: '', message: '' })

onMounted(() => {
  if (props.connectedPlatform) {
    const platformName = props.connectedPlatform === 'ads' ? 'Cuenta publicitaria de Meta' : props.connectedPlatform === 'instagram' ? 'Instagram' : 'Facebook'
    notification.value = { show: true, type: 'success', message: `${platformName} conectada exitosamente` }
    setTimeout(() => { notification.value.show = false }, 5000)
  }
  if (props.errorType) {
    const messages = {
      oauth_failed: 'Error al conectar la cuenta. Intenta nuevamente.',
      missing_params: 'Error en los parámetros de conexión.',
      invalid_platform: 'Plataforma no válida.',
      db_error: 'Error al guardar la cuenta.',
      internal: 'Error interno. Intenta nuevamente.',
      invalid_state: 'La conexión no es válida. Vuelve a iniciarla desde este panel.',
      expired_state: 'La conexión expiró. Vuelve a intentarlo.',
      invalid_profile: 'La cuenta no corresponde a tu organización.',
      invalid_account: 'No pudimos verificar la cuenta conectada. Intenta nuevamente.',
      forbidden: 'No tienes permisos para conectar cuentas.',
      ads_failed: 'No pudimos conectar tu cuenta publicitaria de Meta. Intenta nuevamente.',
      ads_denied: 'Cancelaste la autorización en Meta. Para crear anuncios, vuelve a conectar y acepta los permisos.',
      ads_no_pages: 'Meta pide una página de Facebook para anunciar. Selecciona tu página al conectar.',
      ads_no_accounts: 'Tu cuenta de Meta no tiene cuentas publicitarias autorizadas. Crea una en business.facebook.com o márcala al conectar.',
      ads_unavailable: 'Los anuncios no están disponibles en este momento. Escríbenos y lo revisamos.',
    }
    notification.value = { show: true, type: 'error', message: messages[props.errorType] || 'Error desconocido.' }
    setTimeout(() => { notification.value.show = false }, 5000)
  }
})

const hasAccounts = computed(() => accounts.value.length > 0)

const handleDisconnect = async (accountId) => {
  try {
    const res = await fetch('/api/promote/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId }),
    })
    if (res.ok) {
      accounts.value = accounts.value.filter(a => a.id !== accountId)
      notification.value = { show: true, type: 'success', message: 'Cuenta desconectada' }
      setTimeout(() => { notification.value.show = false }, 3000)
    }
  } catch (e) {
    notification.value = { show: true, type: 'error', message: 'Error al desconectar' }
    setTimeout(() => { notification.value.show = false }, 3000)
  }
}
</script>

<template>
  <div>
    <!-- Notification -->
    <Transition name="slide-down">
      <div
        v-if="notification.show"
        class="fixed top-4 left-4 right-4 sm:left-auto z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium"
        :class="notification.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'"
      >
        <CheckCircle v-if="notification.type === 'success'" :size="16" />
        <AlertCircle v-else :size="16" />
        {{ notification.message }}
        <button @click="notification.show = false" class="ml-2 text-current opacity-60 hover:opacity-100">&times;</button>
      </div>
    </Transition>

    <!-- Header -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 md:mb-8">
      <div>
        <h1 class="text-2xl md:text-3xl font-bold font-[Unbounded] mb-2">Promocionar</h1>
        <p class="text-gray-600">Publica en redes sociales y promociona tus eventos.</p>
      </div>

      <div class="flex flex-wrap gap-2">
        <a
          v-if="adsEnabled && canManageAds"
          href="/dashboard/promote/ads/create"
          class="inline-flex items-center justify-center gap-2 border border-gray-300 bg-white px-5 py-2.5 rounded-lg hover:bg-gray-50 transition font-medium"
        >
          <Target :size="20" />
          Crear anuncio
        </a>
        <a
          href="/dashboard/promote/create"
          class="inline-flex items-center justify-center gap-2 bg-black text-white px-5 py-2.5 rounded-lg hover:bg-gray-800 transition font-medium"
        >
          <Plus :size="20" />
          Crear Post
        </a>
      </div>
    </div>

    <!-- Stats Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6 md:mb-8">
      <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div class="flex items-center gap-3 mb-2">
          <div class="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center">
            <Send :size="20" class="text-purple-600" />
          </div>
          <span class="text-sm text-gray-500">Posts Totales</span>
        </div>
        <p class="text-2xl font-bold">{{ stats.totalPosts }}</p>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div class="flex items-center gap-3 mb-2">
          <div class="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
            <CheckCircle :size="20" class="text-green-600" />
          </div>
          <span class="text-sm text-gray-500">Publicados</span>
        </div>
        <p class="text-2xl font-bold">{{ stats.publishedPosts }}</p>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div class="flex items-center gap-3 mb-2">
          <div class="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
            <Clock :size="20" class="text-blue-600" />
          </div>
          <span class="text-sm text-gray-500">Programados</span>
        </div>
        <p class="text-2xl font-bold">{{ stats.scheduledPosts }}</p>
      </div>

    </div>

    <!-- Tabs -->
    <div class="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit max-w-full overflow-x-auto whitespace-nowrap">
      <button
        @click="activeTab = 'overview'"
        class="shrink-0 px-4 py-2 rounded-md text-sm font-medium transition-colors"
        :class="activeTab === 'overview' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-700'"
      >
        Cuentas conectadas
      </button>
      <button
        @click="activeTab = 'posts'"
        class="shrink-0 px-4 py-2 rounded-md text-sm font-medium transition-colors"
        :class="activeTab === 'posts' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-700'"
      >
        Historial de Posts
      </button>
      <button
        v-if="adsEnabled"
        @click="activeTab = 'ads'"
        class="shrink-0 px-4 py-2 rounded-md text-sm font-medium transition-colors"
        :class="activeTab === 'ads' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-700'"
      >
        Anuncios
      </button>
      <span
        v-else
        class="shrink-0 px-4 py-2 rounded-md text-sm font-medium text-gray-400 cursor-not-allowed"
        title="Los anuncios pagados en Meta estarán disponibles pronto"
      >
        Anuncios · Próximamente
      </span>
    </div>

    <!-- Tab Content -->
    <div v-if="activeTab === 'overview'">
      <ConnectedAccounts
        :accounts="accounts"
        @disconnect="handleDisconnect"
      />
    </div>

    <div v-if="activeTab === 'posts'">
      <PostHistory :posts="posts" :can-boost="adsEnabled && canManageAds" />
    </div>

    <div v-if="activeTab === 'ads'">
      <AdCampaignList :ads-json="adsJson" :can-manage="canManageAds" />
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
