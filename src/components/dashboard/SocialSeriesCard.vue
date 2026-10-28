<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { Instagram, Facebook, Music2, Clapperboard, CalendarClock, Pause, Play, X, RefreshCw, ImagePlus, MessageCircle, Check, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { CANVA_REEL_URL } from '../../lib/socialPlatforms'

// Difusión automática (docs/specs/historias-automaticas.md): el productor aprueba una vez y AI Tickets publica
// historias (y posts la última semana) en Instagram hasta el día del evento, con el link por DM a quien responda la
// palabra clave. Por evento puede sumar la página de Facebook y TikTok (misma cadencia; cada red con su estado, una que
// falla no frena a las otras) y un reel con el video vertical del evento. Habla con /api/events/social-series
// (herramientas *_social_series de la API de productores).

const props = defineProps({
  eventId: { type: Number, required: true },
  eventName: { type: String, default: '' },
})

const view = ref(null)
const loading = ref(true)
const busy = ref('')
const error = ref('')
const configuring = ref(false)
const previewVersion = ref(Date.now())
const form = ref({ feed_posts_enabled: true, sold_out_story_enabled: false, keyword: 'ENTRADAS', dm_message: '', base_image_url: '', facebook_enabled: false, tiktok_enabled: false, reel_enabled: true })
const NETWORKS = [
  { id: 'facebook', name: 'Facebook', icon: Facebook, what: 'Las mismas historias y posts en tu página' },
  { id: 'tiktok', name: 'TikTok', icon: Music2, what: 'Un post de foto vertical cada día de la última semana' },
]
const PLATFORM_ICON = { instagram: Instagram, facebook: Facebook, tiktok: Music2 }

const series = computed(() => view.value?.series || null)
const status = computed(() => series.value?.status || 'none')
const isLive = computed(() => status.value === 'active' || status.value === 'paused')
const plan = computed(() => view.value?.plan || null)

const STATUS_CLASS = {
  active: 'bg-green-100 text-green-700',
  paused: 'bg-amber-100 text-amber-700',
  draft: 'bg-gray-100 text-gray-600',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-gray-100 text-gray-500',
}
const SLOT_CLASS = {
  published: 'bg-green-100 text-green-700',
  queued: 'bg-blue-100 text-blue-700',
  rendering: 'bg-blue-100 text-blue-700',
  planned: 'bg-gray-100 text-gray-600',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-gray-100 text-gray-400',
}
const fmt = (local) => {
  if (!local) return ''
  const [date, time] = local.split('T')
  const d = new Date(`${date}T12:00:00Z`)
  return `${d.toLocaleDateString('es-CL', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })} · ${time}`
}
const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CL')}`
const previewUrl = (s) =>
  `/api/events/social-series-preview?event_id=${props.eventId}&kind=${s.kind}&days=${s.days_to_event}${s.variant === 'sold_out' ? '&variant=sold_out' : ''}${s.platform && s.platform !== 'instagram' ? `&platform=${s.platform}` : ''}&v=${previewVersion.value}`
const track = (name, data) => { try { window.aitTrack?.(name, data) } catch { /* bitácora opcional */ } }

const api = async (method, body) => {
  const res = await fetch(method === 'GET' ? `/api/events/social-series?event_id=${props.eventId}` : '/api/events/social-series', {
    method,
    headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify({ event_id: props.eventId, ...body }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.ok) throw new Error(json.error?.message || 'No se pudo completar la acción.')
  return json.data
}

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    view.value = await api('GET')
    const s = view.value.series
    if (s && s.status === 'draft') {
      form.value = {
        feed_posts_enabled: s.feed_posts_enabled,
        sold_out_story_enabled: s.sold_out_story_enabled,
        keyword: s.keyword,
        dm_message: s.dm_message || '',
        base_image_url: s.base_image_url || '',
        facebook_enabled: Boolean(s.networks?.facebook?.enabled),
        tiktok_enabled: Boolean(s.networks?.tiktok?.enabled),
        reel_enabled: s.reel_enabled !== false,
      }
    }
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

// Vista previa ampliada: { items: [{ src, alt, kind, title, subtitle, caption }], index }. Flechas para recorrer el
// calendario y Escape para cerrar.
const zoom = ref(null)
const zoomItem = computed(() => zoom.value?.items[zoom.value.index] || null)
const openZoom = (items, index = 0) => (zoom.value = { items, index })
const closeZoom = () => (zoom.value = null)
const stepZoom = (d) => {
  if (!zoom.value) return
  const n = zoom.value.items.length
  zoom.value.index = (zoom.value.index + d + n) % n
}
const slotZoomItem = (s, src = previewUrl(s)) => ({
  src,
  alt: `${s.kind_label} ${s.stage || ''}`.trim(),
  kind: s.kind,
  title: s.stage ? `${s.kind_label} · ${s.stage}` : s.kind_label,
  subtitle: fmt(s.publish_local),
  caption: s.caption_example || '',
})
const onZoomKey = (e) => {
  if (!zoom.value) return
  if (e.key === 'Escape') closeZoom()
  else if (e.key === 'ArrowRight') stepZoom(1)
  else if (e.key === 'ArrowLeft') stepZoom(-1)
}
onMounted(() => window.addEventListener('keydown', onZoomKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onZoomKey))

/** Guarda el borrador con la configuración del formulario y refresca el calendario. */
const savePreview = async () => {
  busy.value = 'prepare'
  error.value = ''
  try {
    view.value = await api('POST', {
      action: 'prepare',
      feed_posts_enabled: form.value.feed_posts_enabled,
      sold_out_story_enabled: form.value.sold_out_story_enabled,
      keyword: form.value.keyword.trim().toUpperCase(),
      dm_message: form.value.dm_message.trim(),
      base_image_url: form.value.base_image_url,
      facebook_enabled: form.value.facebook_enabled,
      tiktok_enabled: form.value.tiktok_enabled,
      reel_enabled: form.value.reel_enabled,
    })
    previewVersion.value = Date.now()
    track('difusion_preview', { piezas: view.value.plan?.slots?.length || 0 })
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = ''
  }
}

const start = async () => {
  configuring.value = true
  track('difusion_configurar')
  if (!series.value || series.value.status !== 'draft') await savePreview()
}

/** Acciones con confirmación en el servidor: primero el resumen, luego se repite con el token. */
const confirmAction = async (action, eventName) => {
  busy.value = action
  error.value = ''
  try {
    const first = await api('POST', { action })
    if (first?.status === 'confirmation_required') {
      const lines = [first.summary, ...(first.warnings || []).map((w) => `⚠️ ${w}`)].join('\n\n')
      if (!window.confirm(lines)) {
        track(`${eventName}_cancelado`)
        return
      }
      view.value = await api('POST', { action, confirmation_token: first.confirmation_token })
    } else view.value = first
    configuring.value = false
    previewVersion.value = Date.now()
    track(eventName, { estado: view.value?.series?.status })
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = ''
  }
}

const pause = async () => {
  busy.value = 'pause'
  error.value = ''
  try {
    view.value = await api('POST', { action: 'pause' })
    track('difusion_pausada')
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = ''
  }
}

const uploadPhoto = async (event) => {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  busy.value = 'photo'
  error.value = ''
  try {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/promote/upload-image', { method: 'POST', body: fd })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.url) throw new Error(data.message || 'No se pudo subir la foto')
    form.value.base_image_url = data.url
    await savePreview()
    track('difusion_foto_cambiada')
  } catch (e) {
    error.value = e.message
  } finally {
    if (busy.value === 'photo') busy.value = ''
  }
}

const upcoming = computed(() => (view.value?.slots || []).filter((s) => ['planned', 'rendering', 'queued'].includes(s.status)))
// Redes donde publica la serie viva, con su estado (una desconectada se muestra en ámbar; las demás siguen)
const liveNetworks = computed(() => {
  const nets = series.value?.networks || {}
  return [
    { id: 'instagram', name: 'Instagram', ok: true, label: view.value?.instagram?.account || 'Instagram' },
    ...NETWORKS.filter((n) => nets[n.id]?.enabled).map((n) => ({
      id: n.id,
      name: n.name,
      ok: nets[n.id].status === 'active',
      label: nets[n.id].status === 'active' ? view.value?.networks?.[n.id]?.account || n.name : `${n.name}: desconectado`,
    })),
  ]
})
const extraSummary = computed(() => {
  const p = plan.value
  if (!p) return ''
  const parts = []
  if (p.facebook_posts) parts.push(`${p.facebook_posts} en Facebook`)
  if (p.tiktok_posts) parts.push(`${p.tiktok_posts} en TikTok`)
  if (p.reels?.length) parts.push(`un reel el ${fmt(p.reels[0].publish_local)}`)
  return parts.join(', ')
})
const done = computed(() => (view.value?.slots || []).filter((s) => ['published', 'failed'].includes(s.status)).reverse())
</script>

<template>
  <section class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" data-track-section="Difusión automática" data-testid="social-series">
    <div class="p-4 sm:p-6 border-b border-gray-100 flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h3 class="font-bold text-lg flex items-center gap-2"><Instagram :size="18" /> Difusión automática</h3>
        <p class="text-sm text-gray-500 mt-1">
          Historias en tu Instagram hasta el día del evento, sin que tengas que hacer nada. Quien responde la historia recibe el link por DM.
          Si quieres, también en tu página de Facebook y en TikTok.
        </p>
      </div>
      <span v-if="series && status !== 'draft'" class="px-2 py-1 rounded text-xs font-medium shrink-0" :class="STATUS_CLASS[status]">{{ series.status_label }}</span>
    </div>

    <div class="p-4 sm:p-6 space-y-4">
      <p v-if="loading" class="text-sm text-gray-500">Cargando…</p>

      <template v-else-if="view">
        <div v-if="series?.notice" class="flex gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900" role="status">
          <AlertTriangle :size="16" class="shrink-0 mt-0.5" /> <span>{{ series.notice }}</span>
        </div>

        <!-- Sin activar -->
        <template v-if="!isLive">
          <div v-if="view.blockers.length" class="space-y-2">
            <p v-for="b in view.blockers" :key="b" class="text-sm text-gray-700 flex gap-2"><span class="text-gray-400">•</span>{{ b }}</p>
            <a
              v-if="!view.instagram.connected"
              href="/dashboard/promote"
              data-track="Conectar Instagram (difusión)"
              class="inline-flex items-center gap-2 px-4 py-2 bg-black text-white rounded-lg text-sm font-medium hover:bg-gray-900"
            >
              <Instagram :size="16" /> Conectar Instagram
            </a>
          </div>

          <div v-else-if="!configuring" class="space-y-3">
            <p v-if="plan" class="text-sm text-gray-700">
              Se publicarían <strong>{{ plan.stories }} historias</strong><template v-if="plan.feed_posts"> y <strong>{{ plan.feed_posts }} posts</strong></template>
              en <strong>{{ view.instagram.account || 'tu Instagram' }}</strong>, cada vez más seguido a medida que se acerca el evento, a las {{ plan.publish_time }}.
              Puedes sumar Facebook y TikTok.
            </p>
            <p v-if="status === 'completed' || status === 'cancelled'" class="text-xs text-gray-500">La difusión anterior quedó {{ series.status_label.toLowerCase() }}.</p>
            <button
              type="button"
              data-track="Activar historias automáticas"
              :disabled="busy !== ''"
              @click="start"
              class="w-full py-2.5 bg-black text-white rounded-lg font-medium text-sm hover:bg-gray-900 transition disabled:opacity-60 flex items-center justify-center gap-2"
            >
              <CalendarClock :size="16" /> {{ busy === 'prepare' ? 'Preparando…' : 'Activar historias automáticas' }}
            </button>
          </div>

          <!-- Configuración mínima + vista previa -->
          <div v-else class="space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label class="block">
                <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Palabra clave del DM</span>
                <input v-model="form.keyword" maxlength="30" class="w-full bg-gray-50 border border-gray-200 text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-black uppercase" />
              </label>
              <div class="flex flex-col justify-end gap-2 text-sm text-gray-700">
                <label class="flex items-center gap-2 cursor-pointer"><input v-model="form.feed_posts_enabled" type="checkbox" /> Posts de feed la última semana</label>
                <label class="flex items-center gap-2 cursor-pointer"><input v-model="form.sold_out_story_enabled" type="checkbox" /> Historia "agotado" si se agota</label>
              </div>
            </div>
            <label class="block">
              <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Mensaje del DM (opcional)</span>
              <textarea
                v-model="form.dm_message"
                rows="2"
                maxlength="600"
                :placeholder="view.dm_preview"
                class="w-full bg-gray-50 border border-gray-200 text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-black"
              ></textarea>
              <span class="block text-xs text-gray-400 mt-1">Escribe {link} donde va el link (si no, va al final). Vacío = el mensaje de ejemplo.</span>
            </label>

            <fieldset class="space-y-2" data-testid="social-series-networks">
              <legend class="block text-xs font-bold text-gray-500 uppercase mb-1">Dónde publicar</legend>
              <p class="flex items-center gap-2 text-sm text-gray-700"><Instagram :size="16" /> Instagram <span class="text-gray-400">· {{ view.instagram.account || 'conectado' }} (siempre)</span></p>
              <div v-for="n in NETWORKS" :key="n.id" class="flex items-start gap-2 text-sm text-gray-700">
                <input
                  :id="`series-${n.id}`"
                  v-model="form[`${n.id}_enabled`]"
                  type="checkbox"
                  class="mt-1"
                  :disabled="!view.networks?.[n.id]?.connected"
                  @change="savePreview"
                />
                <label :for="`series-${n.id}`" class="cursor-pointer">
                  <span class="inline-flex items-center gap-1 font-medium"><component :is="n.icon" :size="16" /> {{ n.name }}</span>
                  <span v-if="view.networks?.[n.id]?.connected" class="text-gray-500"> · {{ view.networks[n.id].account || 'conectado' }}. {{ n.what }}.</span>
                  <span v-else class="text-gray-500"> · <a href="/dashboard/promote" class="underline">Conéctalo en Promocionar</a> para sumarlo.</span>
                </label>
              </div>
              <div class="flex items-start gap-2 text-sm text-gray-700">
                <input id="series-reel" v-model="form.reel_enabled" type="checkbox" class="mt-1" :disabled="!view.reel?.available" @change="savePreview" />
                <label for="series-reel" class="cursor-pointer">
                  <span class="inline-flex items-center gap-1 font-medium"><Clapperboard :size="16" /> Reel antes de la función</span>
                  <span class="text-gray-500"> · {{ view.reel?.note }}</span>
                  <span v-if="!view.reel?.available" class="text-gray-500">
                    ¿No tienes video? Hazlo en <a :href="CANVA_REEL_URL" target="_blank" rel="noopener" class="underline" data-track="Hacer reel en Canva">Canva</a>
                    con tu afiche y súbelo como video del evento (Portada o Galería).
                  </span>
                </label>
              </div>
            </fieldset>

            <div class="flex flex-wrap items-center gap-2">
              <label class="inline-flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm cursor-pointer hover:bg-gray-50" data-track="Cambiar foto base">
                <ImagePlus :size="16" /> {{ busy === 'photo' ? 'Subiendo…' : 'Cambiar foto base' }}
                <input type="file" accept="image/jpeg,image/png,image/webp" class="hidden" @change="uploadPhoto" />
              </label>
              <button type="button" data-track="Regenerar vista previa" :disabled="busy !== ''" @click="savePreview" class="inline-flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-60">
                <RefreshCw :size="16" /> {{ busy === 'prepare' ? 'Generando…' : 'Regenerar vista previa' }}
              </button>
              <span class="text-xs text-gray-500">Foto: {{ view.base_image?.source || 'sin foto (fondo liso)' }}</span>
            </div>

            <div v-if="plan" class="space-y-2">
              <p class="text-sm text-gray-700">
                <strong>{{ plan.stories }} historias</strong><template v-if="plan.feed_posts"> y <strong>{{ plan.feed_posts }} posts</strong></template>
                a las {{ plan.publish_time }} <span class="text-gray-500">({{ plan.publish_time_source }})</span><template v-if="extraSummary">; además {{ extraSummary }}</template>.
                La cuenta de entradas se actualiza al publicar.
              </p>
              <div class="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1" data-track-section="Calendario de la difusión">
                <figure v-for="(s, i) in plan.slots" :key="`${s.kind}-${s.publish_at}`" class="shrink-0 w-28">
                  <button
                    type="button"
                    class="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-black cursor-zoom-in"
                    :aria-label="`Ampliar ${s.kind_label} ${s.stage}`"
                    @click="openZoom(plan.slots.map((x) => slotZoomItem(x)), i)"
                  >
                    <img
                      :src="previewUrl(s)"
                      :alt="`${s.kind_label} ${s.stage}`"
                      loading="lazy"
                      class="w-28 rounded-lg border border-gray-200 bg-gray-100 hover:opacity-90 transition"
                      :class="s.kind === 'story' ? 'aspect-[9/16]' : 'aspect-[4/5]'"
                    />
                  </button>
                  <figcaption class="mt-1 text-[11px] leading-tight text-gray-600">
                    <span class="font-semibold text-gray-800">{{ s.kind_label }}</span><br />{{ fmt(s.publish_local) }}
                    <details v-if="s.caption_example" class="mt-1">
                      <summary class="cursor-pointer text-gray-500">Caption</summary>
                      <p class="whitespace-pre-line text-gray-600">{{ s.caption_example }}</p>
                    </details>
                  </figcaption>
                </figure>
              </div>
              <p class="text-xs text-gray-500 flex gap-1"><MessageCircle :size="14" class="shrink-0" /> DM: "{{ view.dm_preview }}"</p>
            </div>

            <div class="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                data-track="Aprobar y programar difusión"
                :disabled="busy !== '' || !plan?.slots?.length"
                @click="confirmAction('approve', 'difusion_aprobada')"
                class="flex-1 py-2.5 bg-black text-white rounded-lg font-medium text-sm hover:bg-gray-900 transition disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <Check :size="16" /> {{ busy === 'approve' ? 'Programando…' : 'Aprobar y programar' }}
              </button>
              <button type="button" data-track="Cerrar configuración de difusión" @click="configuring = false" class="py-2.5 px-4 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">Ahora no</button>
            </div>
          </div>
        </template>

        <!-- Activa o pausada -->
        <template v-else>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div class="p-3 rounded-lg bg-gray-50">
              <p class="text-xl font-bold">{{ view.slot_counts.published || 0 }}</p>
              <p class="text-xs text-gray-500">Publicadas</p>
            </div>
            <div class="p-3 rounded-lg bg-gray-50">
              <p class="text-xl font-bold">{{ upcoming.length }}</p>
              <p class="text-xs text-gray-500">Por publicar</p>
            </div>
            <div class="p-3 rounded-lg bg-gray-50">
              <p class="text-xl font-bold">{{ view.dms?.sent ?? '—' }}</p>
              <p class="text-xs text-gray-500">DMs enviados</p>
            </div>
            <div class="p-3 rounded-lg bg-gray-50">
              <p class="text-xl font-bold">{{ view.attributed_sales.tickets }}</p>
              <p class="text-xs text-gray-500">Entradas por DM</p>
            </div>
          </div>
          <p v-if="view.attributed_sales.orders" class="text-xs text-gray-500">
            {{ view.attributed_sales.orders }} compras por la difusión ({{ clp(view.attributed_sales.gross_clp) }}). Aparecen como canales ig-story-dm, ig-post-dm, fb-post-dm, fb-serie y tiktok-serie en la analítica.
          </p>
          <ul class="flex flex-wrap gap-2" data-testid="social-series-live-networks">
            <li
              v-for="n in liveNetworks"
              :key="n.id"
              class="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium"
              :class="n.ok ? 'bg-gray-100 text-gray-700' : 'bg-amber-100 text-amber-800'"
            >
              <component :is="PLATFORM_ICON[n.id]" :size="14" /> {{ n.label }}
            </li>
          </ul>

          <div v-if="view.next_slot && status === 'active'" class="flex items-center gap-3 p-3 rounded-lg border border-gray-200">
            <button
              type="button"
              class="shrink-0 rounded cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
              aria-label="Ampliar la próxima publicación"
              @click="openZoom([slotZoomItem(view.next_slot, view.next_slot.image_url || previewUrl(view.next_slot))])"
            >
              <img :src="view.next_slot.image_url || previewUrl(view.next_slot)" alt="Próxima publicación" class="w-14 rounded border border-gray-200 hover:opacity-90 transition" :class="view.next_slot.kind === 'story' ? 'aspect-[9/16]' : 'aspect-[4/5]'" />
            </button>
            <div class="text-sm">
              <p class="font-semibold">Próxima: {{ view.next_slot.kind_label }} en {{ view.next_slot.platform_label }} · {{ view.next_slot.stage }}</p>
              <p class="text-gray-500">{{ fmt(view.next_slot.publish_local) }} · {{ view.next_slot.status_label }}</p>
            </div>
          </div>

          <details class="text-sm">
            <summary class="cursor-pointer font-medium">Calendario ({{ view.slots.length }} piezas)</summary>
            <ul class="mt-2 divide-y divide-gray-100">
              <li v-for="s in [...done, ...upcoming]" :key="s.id" class="py-2 flex items-center justify-between gap-2">
                <div class="min-w-0">
                  <p class="font-medium text-gray-800 flex items-center gap-1"><component :is="PLATFORM_ICON[s.platform || 'instagram']" :size="14" class="shrink-0" /> {{ s.kind_label }} · {{ s.stage }}</p>
                  <p class="text-xs text-gray-500">{{ fmt(s.publish_local) }}<template v-if="s.error"> · <span class="text-red-600">{{ s.error }}</span></template></p>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <a v-if="s.post_url" :href="s.post_url" target="_blank" rel="noopener" class="text-xs underline">Ver</a>
                  <span class="px-2 py-0.5 rounded text-xs font-medium" :class="SLOT_CLASS[s.status]">{{ s.status_label }}</span>
                </div>
              </li>
            </ul>
          </details>

          <p class="text-xs text-gray-500">
            Palabra clave: <strong>{{ series.keyword }}</strong> · a las {{ series.publish_time }} · DM: "{{ view.dm_preview }}"
          </p>

          <div class="flex flex-col sm:flex-row gap-2">
            <button
              v-if="status === 'active'"
              type="button"
              data-track="Pausar difusión"
              :disabled="busy !== ''"
              @click="pause"
              class="flex-1 py-2 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              <Pause :size="16" /> {{ busy === 'pause' ? 'Pausando…' : 'Pausar' }}
            </button>
            <button
              v-else
              type="button"
              data-track="Reanudar difusión"
              :disabled="busy !== ''"
              @click="confirmAction('resume', 'difusion_reanudada')"
              class="flex-1 py-2 bg-black text-white rounded-lg text-sm font-medium hover:bg-gray-900 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              <Play :size="16" /> {{ busy === 'resume' ? 'Reanudando…' : 'Reanudar desde hoy' }}
            </button>
            <button
              type="button"
              data-track="Cancelar difusión"
              :disabled="busy !== ''"
              @click="confirmAction('cancel', 'difusion_cancelada')"
              class="py-2 px-4 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              <X :size="16" /> Cancelar
            </button>
          </div>
        </template>
      </template>

      <p v-if="error" class="text-sm text-red-600" role="alert">{{ error }}</p>
    </div>

    <!-- Vista previa ampliada (fixed; sin Teleport para no complicar la hidratación de la isla) -->
    <div
      v-if="zoomItem"
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      :aria-label="zoomItem.title"
      data-testid="social-series-zoom"
      @click.self="closeZoom"
    >
      <button type="button" class="absolute top-3 right-3 p-2 rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="Cerrar" @click="closeZoom">
        <X :size="22" />
      </button>
      <button
        v-if="zoom.items.length > 1"
        type="button"
        class="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 text-white hover:bg-white/20"
        aria-label="Anterior"
        @click="stepZoom(-1)"
      >
        <ChevronLeft :size="26" />
      </button>
      <figure class="flex flex-col items-center max-h-full" @click.self="closeZoom">
        <img
          :src="zoomItem.src"
          :alt="zoomItem.alt"
          class="rounded-xl shadow-2xl bg-gray-900 object-contain max-w-[min(90vw,420px)]"
          :class="zoomItem.kind === 'story' ? 'max-h-[78vh] aspect-[9/16]' : 'max-h-[70vh] aspect-[4/5]'"
        />
        <figcaption class="mt-3 text-center text-white max-w-md">
          <p class="font-semibold">{{ zoomItem.title }}</p>
          <p class="text-sm text-white/70">
            {{ zoomItem.subtitle }}<template v-if="zoom.items.length > 1"> · {{ zoom.index + 1 }} de {{ zoom.items.length }}</template>
          </p>
          <p v-if="zoomItem.caption" class="mt-2 text-sm text-white/80 whitespace-pre-line max-h-24 overflow-y-auto">{{ zoomItem.caption }}</p>
        </figcaption>
      </figure>
      <button
        v-if="zoom.items.length > 1"
        type="button"
        class="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 text-white hover:bg-white/20"
        aria-label="Siguiente"
        @click="stepZoom(1)"
      >
        <ChevronRight :size="26" />
      </button>
    </div>
  </section>
</template>
