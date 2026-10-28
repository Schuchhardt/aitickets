<script setup>
import { ref, computed, onMounted } from 'vue'
import { 
  Megaphone, Plus, Instagram, Facebook, Send, Calendar, 
  TrendingUp, Clock, AlertCircle, CheckCircle, XCircle,
  ExternalLink, Unplug, Target, DollarSign, Share2, ArrowRight
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
    const platformName = props.connectedPlatform === 'ads' ? 'Cuenta publicitaria de Meta' : ({ instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', linkedin: 'LinkedIn' })[props.connectedPlatform] || 'Cuenta'
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

// "Promociona un evento": cada evento a la venta con su difusión automática y anuncios, y los atajos a la pestaña
// Difusión del evento (/dashboard/events/:id#difusion), a crear post y a crear anuncio (?event=<id>)
const SERIES_LABEL = { active: 'Historias activas', paused: 'Historias en pausa', draft: 'Historias por aprobar' }
const SERIES_CLASS = { active: 'bg-green-50 text-green-700', paused: 'bg-amber-50 text-amber-700', draft: 'bg-amber-50 text-amber-700' }
const fmtEventDate = (iso) => (iso ? new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'medium', timeStyle: 'short' }) : 'Fecha por definir')

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
        <p class="text-gray-600">Comparte tus eventos, publica en redes y crea anuncios pagados.</p>
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

    <!-- Promociona un evento -->
    <section class="mb-8" data-testid="promote-events">
      <h2 class="font-bold text-lg mb-1">Promociona un evento</h2>
      <p class="text-sm text-gray-500 mb-4">
        Cada evento tiene su pestaña <strong>Difusión</strong> con el link para compartir, links por canal o promotor e
        difusión automática en Instagram, Facebook y TikTok. Desde aquí también puedes publicar un post (también en LinkedIn) o
        crear un anuncio pagado.
      </p>
      <div v-if="events.length" class="bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-100">
        <div
          v-for="e in events"
          :key="e.id"
          class="p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4"
        >
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <img v-if="e.image_url" :src="e.image_url" alt="" class="w-12 h-12 rounded-lg object-cover shrink-0" loading="lazy" />
            <div v-else class="w-12 h-12 rounded-lg bg-gray-100 shrink-0" />
            <div class="min-w-0">
              <p class="font-bold text-gray-900 truncate">{{ e.name }}</p>
              <p class="text-xs text-gray-500">{{ fmtEventDate(e.start_date) }}</p>
              <div class="flex flex-wrap gap-1.5 mt-1">
                <span
                  class="px-2 py-0.5 rounded text-xs font-medium"
                  :class="SERIES_CLASS[e.series] || 'bg-gray-100 text-gray-500'"
                >
                  <Instagram :size="12" class="inline -mt-0.5" /> {{ SERIES_LABEL[e.series] || 'Sin historias automáticas' }}
                </span>
                <span v-if="e.activeAds" class="px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                  {{ e.activeAds }} {{ e.activeAds === 1 ? 'anuncio activo' : 'anuncios activos' }}
                </span>
              </div>
            </div>
          </div>
          <div class="grid grid-cols-3 sm:flex gap-2 shrink-0">
            <a
              :href="`/dashboard/events/${e.id}#difusion`"
              class="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-black text-white text-sm font-medium hover:bg-gray-800 transition"
            >
              <Share2 :size="16" /> Difusión
            </a>
            <a
              :href="`/dashboard/promote/create?event=${e.id}`"
              class="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium hover:bg-gray-50 transition"
            >
              <Send :size="16" /> Post
            </a>
            <a
              v-if="adsEnabled && canManageAds"
              :href="`/dashboard/promote/ads/create?event=${e.id}`"
              class="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium hover:bg-gray-50 transition"
            >
              <Target :size="16" /> Anuncio
            </a>
          </div>
        </div>
      </div>
      <div v-else class="bg-white rounded-xl border border-dashed border-gray-300 p-6 text-center">
        <p class="text-gray-600 mb-3">No tienes eventos a la venta. Publica uno para empezar a promocionarlo.</p>
        <a href="/dashboard/events" class="inline-flex items-center gap-1.5 text-sm font-medium text-black hover:underline">
          Ir a mis eventos <ArrowRight :size="16" />
        </a>
      </div>
    </section>

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
        Historial de posts<span v-if="stats.totalPosts" class="text-gray-400"> · {{ stats.totalPosts }}</span>
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
