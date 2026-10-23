<script setup>
import { ref, computed, onMounted } from 'vue'
import { Star, Lock, Eye, EyeOff, Trash2, Download, Send, Gift, ChevronDown } from 'lucide-vue-next'

// Reseñas del evento (panel): resumen, configuración (correo de 24 h, premio por calificar, moderación de fotos),
// comentarios públicos y privados, fotos de los asistentes e invitación masiva al próximo evento.
// API: /api/events/reviews (lectura y moderación) y /api/events/invitations (invitaciones).

const props = defineProps({
  eventId: { type: Number, required: true },
  publicUrl: { type: String, default: '' },
})

const loading = ref(true)
const loadError = ref('')
const data = ref(null)
const unavailable = computed(() => Boolean(data.value?.unavailable))

const post = async (url, body) => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: props.eventId, ...body }) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.message || 'No se pudo completar la acción')
  return json
}

const load = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const res = await fetch(`/api/events/reviews?eventId=${props.eventId}`)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.message || 'No se pudieron cargar las reseñas')
    data.value = json
    form.value = {
      enabled: json.settings.enabled,
      rewardOn: Boolean(json.settings.reward),
      rewardValue: json.settings.reward?.value ?? json.reward_limits.defaultValue,
      rewardDays: json.settings.reward?.valid_days ?? json.reward_limits.defaultDays,
      moderate: json.settings.moderate_photos,
    }
    if (!invite.value.target && json.upcoming_events?.length) invite.value.target = String(json.upcoming_events[0].id)
  } catch (e) {
    loadError.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ---- Resumen ----
const summary = computed(() => data.value?.summary || { count: 0, average: null, distribution: {} })
const bars = computed(() => [5, 4, 3, 2, 1].map((n) => {
  const count = Number(summary.value.distribution?.[n]) || 0
  return { n, count, pct: summary.value.count ? Math.round((count / summary.value.count) * 100) : 0 }
}))
const fmtAvg = (v) => (v == null ? '—' : Number(v).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'medium', timeStyle: 'short' }) : '')

// ---- Configuración ----
const form = ref({ enabled: true, rewardOn: false, rewardValue: 10, rewardDays: 60, moderate: false })
const showSettings = ref(false)
const savingSettings = ref(false)
const settingsMsg = ref('')
const settingsError = ref(false)
const settingsSummary = computed(() => {
  const s = data.value?.settings
  if (!s) return ''
  return [
    s.enabled ? 'correo a las 24 h' : 'sin correo',
    s.reward ? `premio ${s.reward.value}% por ${s.reward.valid_days} días` : 'sin premio',
    s.moderate_photos ? 'fotos con revisión' : 'fotos al tiro',
  ].join(' · ')
})
const saveSettings = async () => {
  savingSettings.value = true
  settingsMsg.value = ''
  settingsError.value = false
  try {
    const f = form.value
    const res = await post('/api/events/reviews', {
      action: 'settings',
      enabled: f.enabled,
      moderate_photos: f.moderate,
      reward: f.rewardOn ? { value: Number(f.rewardValue), valid_days: Number(f.rewardDays) } : null,
    })
    data.value = { ...data.value, settings: res.settings }
    settingsMsg.value = 'Configuración guardada.'
  } catch (e) {
    settingsError.value = true
    settingsMsg.value = e.message
  } finally {
    savingSettings.value = false
  }
}

// ---- Reseñas ----
const filter = ref('all')
const FILTERS = [
  { key: 'all', label: 'Todas' },
  { key: 'private', label: 'Con mensaje privado' },
  { key: 'low', label: '1-2 estrellas' },
  { key: 'public', label: 'Con comentario público' },
]
const reviews = computed(() => {
  const list = data.value?.reviews || []
  if (filter.value === 'private') return list.filter((r) => r.private_comment)
  if (filter.value === 'low') return list.filter((r) => r.rating <= 2)
  if (filter.value === 'public') return list.filter((r) => r.public_comment)
  return list
})
const busyId = ref(null)
const toggleReview = async (r) => {
  busyId.value = r.id
  try {
    const next = r.public_status === 'visible' ? 'hidden' : 'visible'
    await post('/api/events/reviews', { action: 'review_status', id: r.id, public_status: next })
    r.public_status = next
  } catch (e) {
    alert(e.message)
  } finally {
    busyId.value = null
  }
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
const downloadCsv = () => {
  const rows = [['Fecha', 'Nombre', 'Email', 'Estrellas', 'Comentario público', 'Mensaje privado', 'Comentario visible', 'Código de premio']]
  for (const r of data.value?.reviews || []) {
    rows.push([fmtDate(r.created_at), r.name, r.email, r.rating, r.public_comment, r.private_comment, r.public_status === 'visible' ? 'sí' : 'no', r.reward_code])
  }
  const blob = new Blob(['﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `resenas-evento-${props.eventId}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

// ---- Fotos ----
const photos = computed(() => data.value?.photos || [])
const pendingPhotos = computed(() => photos.value.filter((p) => p.status === 'pending').length)
const setPhoto = async (p, status) => {
  busyId.value = p.id
  try {
    await post('/api/events/reviews', { action: 'photo_status', id: p.id, status })
    p.status = status
  } catch (e) {
    alert(e.message)
  } finally {
    busyId.value = null
  }
}
const deletePhoto = async (p) => {
  if (!confirm('¿Borrar esta foto de la galería? No se puede deshacer.')) return
  busyId.value = p.id
  try {
    await post('/api/events/reviews', { action: 'photo_delete', id: p.id })
    data.value = { ...data.value, photos: photos.value.filter((x) => x.id !== p.id) }
  } catch (e) {
    alert(e.message)
  } finally {
    busyId.value = null
  }
}

// ---- Invitación al próximo evento ----
const invite = ref({ target: '', audience: 'all', subject: '', message: '' })
const preview = ref(null)
const inviteBusy = ref(false)
const inviteMsg = ref('')
const inviteError = ref(false)
const upcoming = computed(() => data.value?.upcoming_events || [])
const audiences = computed(() => Object.entries(data.value?.audiences || {}).map(([key, label]) => ({ key, label })))
const STATUS_LABELS = { scheduled: 'En cola', sending: 'Enviando', sent: 'Enviada', failed: 'Falló', cancelled: 'Cancelada' }
const resetPreview = () => {
  preview.value = null
  inviteMsg.value = ''
}
const previewInvite = async () => {
  inviteBusy.value = true
  inviteMsg.value = ''
  inviteError.value = false
  try {
    const res = await post('/api/events/invitations', { action: 'preview', targetEventId: Number(invite.value.target), audience: invite.value.audience })
    preview.value = res.counts
  } catch (e) {
    inviteError.value = true
    inviteMsg.value = e.message
  } finally {
    inviteBusy.value = false
  }
}
const sendInvite = async () => {
  const target = upcoming.value.find((e) => String(e.id) === String(invite.value.target))
  if (!confirm(`¿Enviar la invitación a "${target?.name || 'el evento'}" a ${preview.value?.recipients || 0} personas? Cada correo incluye un enlace para darse de baja.`)) return
  inviteBusy.value = true
  inviteMsg.value = ''
  inviteError.value = false
  try {
    const res = await post('/api/events/invitations', {
      action: 'send',
      targetEventId: Number(invite.value.target),
      audience: invite.value.audience,
      subject: invite.value.subject,
      message: invite.value.message,
    })
    inviteMsg.value = res.dispatched
      ? `Enviando a ${res.counts.recipients} personas. Llegará en los próximos minutos.`
      : `Quedó en cola para ${res.counts.recipients} personas: se enviará en los próximos 10 minutos.`
    preview.value = null
    await load()
  } catch (e) {
    inviteError.value = true
    inviteMsg.value = e.message
  } finally {
    inviteBusy.value = false
  }
}
</script>

<template>
  <section class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" data-testid="event-reviews-manager">
    <div class="p-4 md:p-6 border-b border-gray-100">
      <h3 class="font-bold text-lg flex items-center gap-2"><Star size="18" /> Reseñas y fotos de asistentes</h3>
      <p class="text-sm text-gray-500 mt-1">
        24 h después de cada función les pedimos calificar de 1 a 5 estrellas. Pueden dejar un comentario público
        (se ve en la página del evento terminado), un mensaje privado solo para ti y subir fotos a la galería compartida.
      </p>
    </div>

    <div v-if="loading" class="p-6 text-sm text-gray-500">Cargando reseñas…</div>
    <div v-else-if="loadError" class="p-6 text-sm text-red-600">{{ loadError }}</div>
    <div v-else-if="unavailable" class="p-4 md:p-6 text-sm text-amber-700 bg-amber-50">Las reseñas se están activando. Vuelve a intentarlo en unos minutos.</div>

    <template v-else-if="data">
      <!-- Resumen -->
      <div class="p-4 md:p-6 grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-6 border-b border-gray-100">
        <div>
          <p class="text-4xl font-bold font-[Unbounded]">{{ fmtAvg(summary.average) }}</p>
          <p class="text-amber-500 text-lg tracking-wider" aria-hidden="true">{{ '★'.repeat(Math.round(summary.average || 0)) }}<span class="text-gray-200">{{ '★'.repeat(5 - Math.round(summary.average || 0)) }}</span></p>
          <p class="text-sm text-gray-500">{{ summary.count }} {{ summary.count === 1 ? 'reseña' : 'reseñas' }}</p>
        </div>
        <div class="space-y-1 min-w-0">
          <div v-for="b in bars" :key="b.n" class="grid grid-cols-[2rem_1fr_2.5rem] items-center gap-2 text-xs text-gray-500">
            <span>{{ b.n }}★</span>
            <span class="h-2 rounded-full bg-gray-100 overflow-hidden"><span class="block h-full bg-amber-400 rounded-full" :style="{ width: `${b.pct}%` }"></span></span>
            <span class="text-right tabular-nums">{{ b.count }}</span>
          </div>
          <p class="text-xs text-gray-400 pt-2">
            {{ data.stats.requests_sent }} correos de reseña enviados
            <template v-if="data.stats.rewards_granted"> · {{ data.stats.rewards_granted }} códigos de premio entregados ({{ data.stats.rewards_used }} usados)</template>
          </p>
        </div>
      </div>

      <!-- Configuración -->
      <div class="p-4 md:p-6 border-b border-gray-100">
        <button type="button" class="flex items-center gap-1 text-sm font-semibold text-gray-700 hover:text-black" @click="showSettings = !showSettings">
          <ChevronDown size="16" class="transition" :class="showSettings ? 'rotate-180' : ''" /> Configuración
          <span class="font-normal text-gray-400">({{ settingsSummary }})</span>
        </button>
        <form v-if="showSettings" class="mt-4 space-y-4" @submit.prevent="saveSettings">
          <label class="flex items-start gap-3 text-sm">
            <input v-model="form.enabled" type="checkbox" class="mt-1" />
            <span><strong>Enviar el correo “¿Cómo estuvo?”</strong> 24 horas después de cada función.</span>
          </label>
          <div class="rounded-lg border border-gray-200 p-3 space-y-3">
            <label class="flex items-start gap-3 text-sm">
              <input v-model="form.rewardOn" type="checkbox" class="mt-1" />
              <span><strong class="inline-flex items-center gap-1"><Gift size="14" /> Premiar a quien califique</strong> con un código de descuento de un solo uso para cualquiera de tus eventos.</span>
            </label>
            <div v-if="form.rewardOn" class="flex flex-wrap gap-3 pl-7">
              <label class="text-xs font-bold text-gray-500 uppercase">Descuento (%)
                <input v-model="form.rewardValue" type="number" :min="data.reward_limits.minValue" :max="data.reward_limits.maxValue" class="block mt-1 w-24 px-3 py-2 rounded-lg border border-gray-300 text-sm font-normal" />
              </label>
              <label class="text-xs font-bold text-gray-500 uppercase">Válido por (días)
                <input v-model="form.rewardDays" type="number" :min="data.reward_limits.minDays" :max="data.reward_limits.maxDays" class="block mt-1 w-24 px-3 py-2 rounded-lg border border-gray-300 text-sm font-normal" />
              </label>
              <p class="text-xs text-gray-500 w-full">El descuento sale de tus ventas (como cualquier código). Los códigos de premio no aparecen en tu lista de códigos de descuento.</p>
            </div>
          </div>
          <label class="flex items-start gap-3 text-sm">
            <input v-model="form.moderate" type="checkbox" class="mt-1" />
            <span><strong>Revisar las fotos antes de publicarlas.</strong> Si no, se publican al tiro y puedes ocultarlas después.</span>
          </label>
          <div class="flex items-center gap-3">
            <button type="submit" :disabled="savingSettings" class="px-4 py-2 bg-black text-white rounded-lg font-medium hover:bg-gray-900 disabled:opacity-60">
              {{ savingSettings ? 'Guardando…' : 'Guardar configuración' }}
            </button>
            <p v-if="settingsMsg" class="text-sm" :class="settingsError ? 'text-red-600' : 'text-green-700'">{{ settingsMsg }}</p>
          </div>
        </form>
      </div>

      <!-- Comentarios -->
      <div class="p-4 md:p-6 border-b border-gray-100">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div class="flex flex-wrap gap-2">
            <button v-for="f in FILTERS" :key="f.key" type="button" class="px-3 py-1 rounded-full text-xs font-semibold border"
              :class="filter === f.key ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-600 hover:border-gray-400'" @click="filter = f.key">
              {{ f.label }}
            </button>
          </div>
          <button v-if="data.reviews.length" type="button" class="flex items-center gap-1 text-sm text-gray-600 hover:text-black" @click="downloadCsv">
            <Download size="15" /> CSV
          </button>
        </div>
        <p v-if="!data.reviews.length" class="text-sm text-gray-500 py-4">
          {{ data.ended ? 'Aún no hay reseñas. Llegan a partir de 24 h después de que termina cada función.' : 'Las reseñas llegarán cuando termine el evento.' }}
        </p>
        <p v-else-if="!reviews.length" class="text-sm text-gray-500 py-4">No hay reseñas con ese filtro.</p>
        <ul v-else class="divide-y divide-gray-100">
          <li v-for="r in reviews" :key="r.id" class="py-4 space-y-2">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <p class="text-sm">
                <span class="text-amber-500 tracking-wider">{{ '★'.repeat(r.rating) }}<span class="text-gray-200">{{ '★'.repeat(5 - r.rating) }}</span></span>
                <strong class="ml-2">{{ r.name }}</strong>
                <span class="text-gray-400 break-all"> · {{ r.email }}</span>
              </p>
              <p class="text-xs text-gray-400">{{ fmtDate(r.created_at) }}</p>
            </div>
            <div v-if="r.public_comment" class="flex items-start justify-between gap-3">
              <p class="text-sm text-gray-800 whitespace-pre-line" :class="r.public_status === 'hidden' ? 'line-through text-gray-400' : ''">{{ r.public_comment }}</p>
              <button type="button" :disabled="busyId === r.id" class="shrink-0 flex items-center gap-1 text-xs text-gray-500 hover:text-black disabled:opacity-50" @click="toggleReview(r)">
                <component :is="r.public_status === 'visible' ? EyeOff : Eye" size="14" />
                {{ r.public_status === 'visible' ? 'Ocultar' : 'Mostrar' }}
              </button>
            </div>
            <p v-if="r.private_comment" class="text-sm bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 whitespace-pre-line">
              <span class="inline-flex items-center gap-1 text-xs font-bold text-amber-700 uppercase mr-1"><Lock size="12" /> Privado</span>{{ r.private_comment }}
            </p>
            <p v-if="r.reward_code" class="text-xs text-gray-400">Premio: <span class="font-mono">{{ r.reward_code }}</span></p>
          </li>
        </ul>
        <p class="text-xs text-gray-400 mt-2">Ocultar un comentario lo saca de la página pública, pero su calificación sigue contando en el promedio.</p>
      </div>

      <!-- Fotos -->
      <div class="p-4 md:p-6 border-b border-gray-100">
        <h4 class="font-semibold text-sm mb-1">Fotos de los asistentes ({{ photos.length }})</h4>
        <p v-if="pendingPhotos" class="text-xs text-amber-700 mb-3">{{ pendingPhotos }} {{ pendingPhotos === 1 ? 'foto espera' : 'fotos esperan' }} tu revisión.</p>
        <p v-if="!photos.length" class="text-sm text-gray-500">Todavía no suben fotos.</p>
        <ul v-else class="grid grid-cols-3 sm:grid-cols-4 gap-2">
          <li v-for="p in photos" :key="p.id" class="relative group rounded-lg overflow-hidden bg-gray-100 aspect-square">
            <a :href="p.url" target="_blank" rel="noopener"><img :src="p.thumb_url || p.url" :alt="p.name ? `Foto de ${p.name}` : 'Foto de asistente'" class="w-full h-full object-cover" :class="p.status === 'hidden' ? 'opacity-40' : ''" loading="lazy" /></a>
            <span v-if="p.status !== 'visible'" class="absolute top-1 left-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/70 text-white">{{ p.status === 'pending' ? 'Por revisar' : 'Oculta' }}</span>
            <div class="absolute inset-x-0 bottom-0 flex justify-between p-1 bg-gradient-to-t from-black/70 to-transparent">
              <button type="button" :disabled="busyId === p.id" class="text-[11px] font-semibold text-white px-1.5 py-0.5 rounded hover:bg-white/20" @click="setPhoto(p, p.status === 'visible' ? 'hidden' : 'visible')">
                {{ p.status === 'visible' ? 'Ocultar' : 'Publicar' }}
              </button>
              <button type="button" :disabled="busyId === p.id" class="text-white p-1 rounded hover:bg-white/20" aria-label="Borrar foto" @click="deletePhoto(p)"><Trash2 size="13" /></button>
            </div>
          </li>
        </ul>
      </div>

      <!-- Invitar al próximo evento -->
      <div class="p-4 md:p-6 space-y-3">
        <h4 class="font-semibold flex items-center gap-2"><Send size="16" /> Invitar a estos asistentes a tu próximo evento</h4>
        <p class="text-sm text-gray-500">Un correo individual a cada asistente con tu próximo evento. Se omite a quienes ya tienen entradas, a quienes ya invitaste a ese evento y a quienes se dieron de baja de tus invitaciones.</p>
        <p v-if="!upcoming.length" class="text-sm text-gray-500 bg-gray-50 rounded-lg p-3">Publica tu próximo evento para poder invitar a estos asistentes.</p>
        <form v-else class="space-y-3" @submit.prevent="preview ? sendInvite() : previewInvite()">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label class="text-xs font-bold text-gray-500 uppercase">Evento al que invitas
              <select v-model="invite.target" class="block mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 text-sm font-normal normal-case" @change="resetPreview">
                <option v-for="e in upcoming" :key="e.id" :value="String(e.id)">{{ e.name }}{{ e.date_label ? ` · ${e.date_label}` : '' }}</option>
              </select>
            </label>
            <label class="text-xs font-bold text-gray-500 uppercase">A quiénes
              <select v-model="invite.audience" class="block mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 text-sm font-normal normal-case" @change="resetPreview">
                <option v-for="a in audiences" :key="a.key" :value="a.key">{{ a.label }}</option>
              </select>
            </label>
          </div>
          <label class="block text-xs font-bold text-gray-500 uppercase">Asunto <span class="font-normal normal-case">(opcional)</span>
            <input v-model="invite.subject" type="text" maxlength="150" placeholder="Por defecto: “<Tu productora> te invita a <evento>”" class="block mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 text-sm font-normal normal-case" />
          </label>
          <label class="block text-xs font-bold text-gray-500 uppercase">Mensaje <span class="font-normal normal-case">(opcional)</span>
            <textarea v-model="invite.message" rows="3" maxlength="2000" placeholder="¡Gracias por venir! Te guardamos un lugar en la próxima…" class="block mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 text-sm font-normal normal-case"></textarea>
          </label>
          <div v-if="preview" class="text-sm bg-gray-50 rounded-lg p-3" data-testid="invite-preview">
            <p><strong>{{ preview.recipients }}</strong> de {{ preview.attendees }} asistentes recibirán la invitación.</p>
            <p class="text-xs text-gray-500 mt-1">
              Se omiten: {{ preview.already_have_tickets }} que ya tienen entradas · {{ preview.already_invited }} ya invitados · {{ preview.opted_out }} dados de baja.
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <button type="submit" :disabled="inviteBusy || !invite.target || (preview && !preview.recipients)" class="px-4 py-2 bg-black text-white rounded-lg font-medium hover:bg-gray-900 disabled:opacity-60">
              {{ inviteBusy ? 'Procesando…' : preview ? `Enviar a ${preview.recipients} personas` : 'Calcular destinatarios' }}
            </button>
            <button v-if="preview" type="button" class="text-sm text-gray-500 hover:text-black" @click="resetPreview">Cambiar</button>
          </div>
          <p v-if="inviteMsg" class="text-sm" :class="inviteError ? 'text-red-600' : 'text-green-700'">{{ inviteMsg }}</p>
        </form>
        <div v-if="data.invitations?.length" class="pt-2">
          <p class="text-xs font-bold text-gray-500 uppercase mb-1">Invitaciones enviadas</p>
          <ul class="text-sm divide-y divide-gray-100">
            <li v-for="m in data.invitations" :key="m.id" class="py-2 flex flex-wrap justify-between gap-2">
              <span class="min-w-0">{{ m.target_event_name || m.subject }} <span class="text-gray-400">· {{ fmtDate(m.created_at) }}</span></span>
              <span class="text-xs text-gray-500">{{ STATUS_LABELS[m.status] || m.status }}<template v-if="m.recipients_count != null"> · {{ m.recipients_count - (m.failed_count || 0) }} enviados</template></span>
            </li>
          </ul>
        </div>
      </div>
    </template>
  </section>
</template>
