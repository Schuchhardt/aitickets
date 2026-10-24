<script setup>
// Asistente para crear un anuncio en Meta (Facebook e Instagram) vía Zernio: POST /api/promote/ads/create.
// Pasos: 1) evento, tipo (anuncio nuevo o promocionar un post publicado) y cuenta publicitaria; 2) texto e imagen o el
// post; 3) público (todo Chile o una ciudad con radio, edad); 4) presupuesto diario y días, con el gasto máximo
// confirmado explícitamente. El servidor vuelve a validar todo (netlify/lib/zernio-ads.mjs validateAdInput).
import { ref, computed, watch } from 'vue'
import {
  ArrowLeft, ArrowRight, Check, Sparkles, Loader2, AlertCircle, MapPin, Users,
  Image as ImageIcon, Upload, Megaphone, CheckCircle, Search,
} from 'lucide-vue-next'

const props = defineProps({
  eventsJson: { type: String, default: '[]' },
  connectionsJson: { type: String, default: '[]' },
  postsJson: { type: String, default: '[]' },
  preSelectedEventId: { type: String, default: '' },
  preSelectedPostId: { type: String, default: '' },
  limitsJson: { type: String, default: '{}' },
})

const events = JSON.parse(props.eventsJson)
const connections = JSON.parse(props.connectionsJson).filter((c) => c.status === 'active')
const posts = JSON.parse(props.postsJson)
const limits = JSON.parse(props.limitsJson)
const radii = limits.cityRadiiKm || [17, 25, 40, 80]
const ctas = limits.callsToAction || { BUY_TICKETS: 'Comprar entradas' }
const DAY_MS = 86400000

const preEvent = events.find((e) => String(e.id) === props.preSelectedEventId)
const prePost = posts.find((p) => String(p.id) === props.preSelectedPostId)

const step = ref(1)
const totalSteps = 4
const error = ref('')
const done = ref(null)
const submitting = ref(false)
const generating = ref({ text: false, image: false, upload: false })

const form = ref({
  eventId: prePost?.event_id || preEvent?.id || (events.length === 1 ? events[0].id : null),
  type: prePost ? 'boost' : 'standalone',
  socialPostId: prePost?.id || null,
  connectionId: connections.length ? connections[0].id : null,
  headline: '',
  body: '',
  imageUrl: '',
  callToAction: 'BUY_TICKETS',
  geoType: 'country',
  city: null,
  radiusKm: 25,
  ageMin: 18,
  ageMax: 65,
  dailyBudget: null,
  days: 5,
  launch: 'now',
  confirmSpend: false,
})

const event = computed(() => events.find((e) => e.id === form.value.eventId) || null)
const connection = computed(() => connections.find((c) => c.id === form.value.connectionId) || null)
const eventPosts = computed(() => posts.filter((p) => p.event_id === form.value.eventId))
const post = computed(() => posts.find((p) => p.id === form.value.socialPostId) || null)
const currency = computed(() => connection.value?.currency || 'CLP')
const minDaily = computed(() => Number(connection.value?.minimum_daily_budget) || (currency.value === 'CLP' ? 1000 : 1))
const budgetPresets = computed(() => (currency.value === 'CLP' ? [5000, 10000, 20000, 40000] : [5, 10, 20, 40]).filter((n) => n >= minDaily.value))

// Días posibles: hasta que termina el evento (máx. 30)
const maxDays = computed(() => {
  const ends = Date.parse(event.value?.end_date || event.value?.start_date)
  if (!Number.isFinite(ends)) return 30
  return Math.max(0, Math.min(30, Math.floor((ends - Date.now()) / DAY_MS)))
})
const dayPresets = computed(() => [3, 5, 7, 14].filter((d) => d <= maxDays.value))

const money = (n) => {
  const v = Number(n) || 0
  return currency.value === 'CLP' ? `$${Math.round(v).toLocaleString('es-CL')}` : `${currency.value} ${v.toLocaleString('es-CL', { maximumFractionDigits: 2 })}`
}
const roundBudget = (v) => (currency.value === 'CLP' ? Math.round(v) : Math.round(v * 100) / 100)
const total = computed(() => (form.value.dailyBudget > 0 && form.value.days > 0 ? roundBudget(form.value.dailyBudget * form.value.days) : 0))
const endsOn = computed(() => new Date(Date.now() + form.value.days * DAY_MS).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }))

// Buscador de ciudad (declarado antes de los watch inmediatos que lo usan)
const citySearch = ref('')
const cityResults = ref([])
const searchingCity = ref(false)

watch(() => form.value.eventId, (id, prev) => {
  const ev = events.find((e) => e.id === id)
  if (!ev) return
  if (!form.value.imageUrl || prev) form.value.imageUrl = ev.image_url || ''
  if (prev) { form.value.headline = ''; form.value.body = ''; form.value.socialPostId = null }
  if (form.value.days > maxDays.value) form.value.days = Math.max(1, maxDays.value)
  citySearch.value = ev.city || ''
}, { immediate: true })

watch(connection, () => {
  if (!form.value.dailyBudget || form.value.dailyBudget < minDaily.value) form.value.dailyBudget = budgetPresets.value[0] || minDaily.value
}, { immediate: true })

// Cualquier cambio del gasto obliga a confirmar de nuevo
watch(() => [form.value.dailyBudget, form.value.days, form.value.connectionId], () => { form.value.confirmSpend = false })

const canProceed = computed(() => {
  const f = form.value
  switch (step.value) {
    case 1: return Boolean(event.value && connection.value && maxDays.value >= 1 && (f.type === 'standalone' || eventPosts.value.length))
    case 2: return f.type === 'boost' ? Boolean(post.value) : Boolean(f.headline.trim() && f.body.trim() && f.imageUrl)
    case 3: return (f.geoType === 'country' || Boolean(f.city)) && f.ageMin <= f.ageMax
    case 4: return f.dailyBudget >= minDaily.value && f.days >= 1 && f.days <= maxDays.value && f.confirmSpend
    default: return false
  }
})

const next = () => { error.value = ''; if (canProceed.value && step.value < totalSteps) step.value += 1 }
const back = () => { error.value = ''; if (step.value > 1) step.value -= 1 }

// ---- IA e imagen ----
const generateCopy = async () => {
  if (!event.value) return
  generating.value.text = true
  error.value = ''
  try {
    const res = await fetch('/api/promote/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: event.value.id, type: 'ad' }) })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data.headline) { form.value.headline = data.headline; form.value.body = data.body }
    else error.value = data.message || 'No se pudo generar el texto'
  } catch { error.value = 'No se pudo generar el texto' } finally { generating.value.text = false }
}

const generateImage = async () => {
  if (!event.value) return
  generating.value.image = true
  error.value = ''
  try {
    const res = await fetch('/api/promote/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: event.value.id, type: 'image' }) })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data.imageUrl) form.value.imageUrl = data.imageUrl
    else error.value = data.message || 'No se pudo generar la imagen'
  } catch { error.value = 'No se pudo generar la imagen' } finally { generating.value.image = false }
}

const fileInput = ref(null)
const uploadImage = async (e) => {
  const file = e.target.files?.[0]
  if (!file) return
  generating.value.upload = true
  error.value = ''
  try {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/promote/upload-image', { method: 'POST', body: fd })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data.url) form.value.imageUrl = data.url
    else error.value = data.message || 'No se pudo subir la imagen'
  } catch { error.value = 'No se pudo subir la imagen' } finally { generating.value.upload = false; e.target.value = '' }
}

// ---- Ciudad ----
const searchCity = async () => {
  if (!connection.value || citySearch.value.trim().length < 2) return
  searchingCity.value = true
  error.value = ''
  try {
    const qs = new URLSearchParams({ connectionId: String(connection.value.id), q: citySearch.value.trim() })
    const res = await fetch(`/api/promote/ads/targeting?${qs}`)
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      cityResults.value = data.results || []
      if (!cityResults.value.length) error.value = 'No encontramos esa ciudad en Chile. Prueba con otro nombre.'
    } else error.value = data.message || 'No se pudo buscar la ciudad'
  } catch { error.value = 'No se pudo buscar la ciudad' } finally { searchingCity.value = false }
}
const pickCity = (c) => { form.value.city = c; cityResults.value = [] }

const audienceLabel = computed(() => {
  const f = form.value
  const geo = f.geoType === 'city' && f.city ? `${f.city.name} y ${f.radiusKm} km a la redonda` : 'Todo Chile'
  return `${geo} · ${f.ageMin} a ${f.ageMax}${f.ageMax === 65 ? '+' : ''} años`
})

// ---- Enviar ----
const submit = async () => {
  if (!canProceed.value || submitting.value) return
  submitting.value = true
  error.value = ''
  const f = form.value
  try {
    const res = await fetch('/api/promote/ads/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: f.eventId,
        connectionId: f.connectionId,
        type: f.type,
        socialPostId: f.type === 'boost' ? f.socialPostId : undefined,
        headline: f.headline,
        body: f.body,
        imageUrl: f.imageUrl,
        callToAction: f.callToAction,
        geo: f.geoType === 'city' && f.city ? { type: 'city', key: f.city.key, name: f.city.name, radiusKm: f.radiusKm } : { type: 'country' },
        ageMin: f.ageMin,
        ageMax: f.ageMax,
        dailyBudget: f.dailyBudget,
        days: f.days,
        launch: f.launch,
        confirmSpend: f.confirmSpend,
        confirmTotal: total.value,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok || res.status === 202 || (res.status === 409 && data.duplicate)) done.value = data
    else error.value = data.message || 'No se pudo crear el anuncio'
  } catch {
    error.value = 'Error de conexión. Revisa la lista de anuncios antes de reintentar.'
  } finally {
    submitting.value = false
  }
}

const ageOptions = Array.from({ length: 65 - 13 + 1 }, (_, i) => 13 + i)
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' }) : '')
</script>

<template>
  <div class="max-w-3xl mx-auto">
    <div class="flex items-center gap-3 mb-6 md:mb-8">
      <a href="/dashboard/promote?tab=ads" class="shrink-0 text-gray-400 hover:text-gray-600 transition" aria-label="Volver a anuncios">
        <ArrowLeft :size="20" />
      </a>
      <div>
        <h1 class="text-2xl font-bold font-[Unbounded]">Crear anuncio</h1>
        <p class="text-sm text-gray-500 mt-1">Facebook e Instagram · Paso {{ done ? totalSteps : step }} de {{ totalSteps }}</p>
      </div>
    </div>

    <!-- Listo -->
    <div v-if="done" class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 md:p-10 text-center">
      <div class="w-14 h-14 bg-lime-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <CheckCircle :size="28" class="text-lime-700" />
      </div>
      <h2 class="text-xl font-bold mb-2">{{ done.duplicate ? 'Este anuncio ya estaba creado' : 'Listo' }}</h2>
      <p class="text-gray-600 mb-6">{{ done.message }}</p>
      <p class="text-sm text-gray-500 mb-6">Cada venta que llegue desde este anuncio aparecerá en tu panel y en tu reporte de los domingos.</p>
      <a href="/dashboard/promote?tab=ads" class="inline-flex items-center gap-2 bg-black text-white px-6 py-3 rounded-lg hover:bg-gray-800 transition font-medium">Ver mis anuncios</a>
    </div>

    <div v-else-if="!events.length" class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-center text-gray-600">
      No tienes eventos publicados por venir. Publica un evento para anunciarlo.
    </div>

    <div v-else-if="!connections.length" class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-center">
      <p class="text-gray-700 mb-4">Primero conecta tu cuenta publicitaria de Meta.</p>
      <a href="/dashboard/promote?tab=ads" class="inline-flex bg-black text-white px-5 py-2.5 rounded-lg hover:bg-gray-800 transition font-medium">Conectar cuenta</a>
    </div>

    <div v-else class="bg-white rounded-xl shadow-sm border border-gray-100 p-5 md:p-8">
      <!-- Paso 1 -->
      <section v-if="step === 1" class="space-y-6">
        <div>
          <h2 class="text-lg font-semibold mb-3">¿Qué evento quieres anunciar?</h2>
          <div class="grid gap-2">
            <button
              v-for="ev in events" :key="ev.id" type="button" @click="form.eventId = ev.id"
              class="flex items-center gap-3 p-3 rounded-lg border text-left transition"
              :class="form.eventId === ev.id ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-gray-400'"
            >
              <img v-if="ev.image_url" :src="ev.image_url" alt="" class="w-12 h-12 rounded object-cover shrink-0" />
              <div class="min-w-0 flex-1">
                <p class="font-medium truncate">{{ ev.title || ev.name }}</p>
                <p class="text-xs text-gray-500">{{ fmtDate(ev.start_date) }}<span v-if="ev.city"> · {{ ev.city }}</span></p>
              </div>
              <Check v-if="form.eventId === ev.id" :size="18" class="shrink-0" />
            </button>
          </div>
          <p v-if="event && maxDays < 1" class="mt-2 text-sm text-amber-700">Este evento es en menos de un día: ya no alcanza a correr un anuncio.</p>
        </div>

        <div>
          <h2 class="text-lg font-semibold mb-3">Tipo de anuncio</h2>
          <div class="grid sm:grid-cols-2 gap-2">
            <button type="button" @click="form.type = 'standalone'" class="p-4 rounded-lg border text-left transition" :class="form.type === 'standalone' ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-gray-400'">
              <p class="font-medium">Anuncio nuevo</p>
              <p class="text-sm text-gray-500">Imagen y texto pensados para vender, con IA.</p>
            </button>
            <button type="button" @click="eventPosts.length && (form.type = 'boost')" :disabled="!eventPosts.length" class="p-4 rounded-lg border text-left transition disabled:opacity-50 disabled:cursor-not-allowed" :class="form.type === 'boost' ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-gray-400'">
              <p class="font-medium">Promocionar un post</p>
              <p class="text-sm text-gray-500">{{ eventPosts.length ? 'Usa un post que ya publicaste desde AI Tickets.' : 'Aún no publicas posts de este evento.' }}</p>
            </button>
          </div>
        </div>

        <div v-if="connections.length > 1">
          <h2 class="text-lg font-semibold mb-3">Cuenta publicitaria</h2>
          <select v-model="form.connectionId" class="w-full border border-gray-300 rounded-lg px-3 py-2">
            <option v-for="c in connections" :key="c.id" :value="c.id">{{ c.account_name }} ({{ c.currency || 'CLP' }})</option>
          </select>
        </div>
        <p v-else-if="connection" class="text-sm text-gray-500">Cuenta publicitaria: <strong>{{ connection.account_name }}</strong> ({{ connection.currency || 'CLP' }}). Meta le cobra el gasto directo a esta cuenta.</p>
      </section>

      <!-- Paso 2 -->
      <section v-if="step === 2" class="space-y-5">
        <template v-if="form.type === 'standalone'">
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-lg font-semibold">Texto e imagen</h2>
            <button type="button" @click="generateCopy" :disabled="generating.text" class="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
              <Loader2 v-if="generating.text" :size="16" class="animate-spin" /><Sparkles v-else :size="16" />
              Escribir con IA
            </button>
          </div>
          <label class="block">
            <span class="text-sm font-medium">Título <span class="text-gray-400">({{ form.headline.length }}/40)</span></span>
            <input v-model="form.headline" maxlength="40" class="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="Ej: Fiesta Techno · sábado 7 nov" />
          </label>
          <label class="block">
            <span class="text-sm font-medium">Texto <span class="text-gray-400">({{ form.body.length }}/1000)</span></span>
            <textarea v-model="form.body" maxlength="1000" rows="4" class="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="Qué se va a vivir, cuándo y dónde, y un llamado a comprar."></textarea>
          </label>
          <div>
            <span class="text-sm font-medium">Imagen</span>
            <div class="mt-2 flex flex-col sm:flex-row gap-4 items-start">
              <div class="w-40 h-40 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center shrink-0">
                <img v-if="form.imageUrl" :src="form.imageUrl" alt="Imagen del anuncio" class="w-full h-full object-cover" />
                <ImageIcon v-else :size="28" class="text-gray-400" />
              </div>
              <div class="flex flex-wrap gap-2">
                <button v-if="event?.image_url && form.imageUrl !== event.image_url" type="button" @click="form.imageUrl = event.image_url" class="text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50">Usar la portada</button>
                <button type="button" @click="generateImage" :disabled="generating.image" class="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                  <Loader2 v-if="generating.image" :size="16" class="animate-spin" /><Sparkles v-else :size="16" /> Generar con IA
                </button>
                <button type="button" @click="fileInput?.click()" :disabled="generating.upload" class="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                  <Loader2 v-if="generating.upload" :size="16" class="animate-spin" /><Upload v-else :size="16" /> Subir imagen
                </button>
                <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" class="hidden" @change="uploadImage" />
              </div>
            </div>
          </div>
          <label class="block">
            <span class="text-sm font-medium">Botón</span>
            <select v-model="form.callToAction" class="mt-1 w-full sm:w-64 border border-gray-300 rounded-lg px-3 py-2">
              <option v-for="(label, value) in ctas" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
        </template>

        <template v-else>
          <h2 class="text-lg font-semibold">¿Qué post promocionas?</h2>
          <div class="grid gap-2">
            <button
              v-for="p in eventPosts" :key="p.id" type="button" @click="form.socialPostId = p.id"
              class="flex gap-3 p-3 rounded-lg border text-left transition"
              :class="form.socialPostId === p.id ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-gray-400'"
            >
              <img v-if="p.image_urls?.[0]" :src="p.image_urls[0]" alt="" class="w-14 h-14 rounded object-cover shrink-0" />
              <p class="text-sm text-gray-700 line-clamp-3 flex-1">{{ p.content }}</p>
              <Check v-if="form.socialPostId === p.id" :size="18" class="shrink-0" />
            </button>
          </div>
          <p class="text-sm text-gray-500">Se agrega un botón "{{ ctas[form.callToAction] }}" que lleva a la página del evento.</p>
        </template>
      </section>

      <!-- Paso 3 -->
      <section v-if="step === 3" class="space-y-6">
        <div>
          <h2 class="text-lg font-semibold mb-3 flex items-center gap-2"><MapPin :size="18" /> ¿Dónde?</h2>
          <div class="flex flex-wrap gap-2 mb-3">
            <button type="button" @click="form.geoType = 'country'" class="px-4 py-2 rounded-lg border text-sm" :class="form.geoType === 'country' ? 'border-black bg-gray-50 font-medium' : 'border-gray-200'">Todo Chile</button>
            <button type="button" @click="form.geoType = 'city'" class="px-4 py-2 rounded-lg border text-sm" :class="form.geoType === 'city' ? 'border-black bg-gray-50 font-medium' : 'border-gray-200'">Cerca de una ciudad</button>
          </div>
          <div v-if="form.geoType === 'city'" class="space-y-3">
            <div v-if="form.city" class="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-200">
              <span class="text-sm"><strong>{{ form.city.name }}</strong><span v-if="form.city.path?.length" class="text-gray-500"> · {{ form.city.path.slice(1).join(', ') }}</span></span>
              <button type="button" class="text-sm underline text-gray-500" @click="form.city = null">Cambiar</button>
            </div>
            <form v-else class="flex gap-2" @submit.prevent="searchCity">
              <input v-model="citySearch" class="flex-1 border border-gray-300 rounded-lg px-3 py-2" placeholder="Ej: Valparaíso" />
              <button type="submit" :disabled="searchingCity" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-black text-white text-sm disabled:opacity-50">
                <Loader2 v-if="searchingCity" :size="16" class="animate-spin" /><Search v-else :size="16" /> Buscar
              </button>
            </form>
            <div v-if="cityResults.length" class="grid gap-1">
              <button v-for="c in cityResults" :key="c.key" type="button" @click="pickCity(c)" class="text-left text-sm px-3 py-2 rounded-lg hover:bg-gray-50 border border-gray-100">
                <strong>{{ c.name }}</strong><span v-if="c.path?.length" class="text-gray-500"> · {{ c.path.slice(1).join(', ') }}</span>
              </button>
            </div>
            <label class="block">
              <span class="text-sm font-medium">Radio</span>
              <select v-model.number="form.radiusKm" class="mt-1 w-full sm:w-48 border border-gray-300 rounded-lg px-3 py-2">
                <option v-for="r in radii" :key="r" :value="r">{{ r }} km</option>
              </select>
            </label>
          </div>
        </div>
        <div>
          <h2 class="text-lg font-semibold mb-3 flex items-center gap-2"><Users :size="18" /> Edad</h2>
          <div class="flex items-center gap-2">
            <select v-model.number="form.ageMin" class="border border-gray-300 rounded-lg px-3 py-2">
              <option v-for="a in ageOptions" :key="a" :value="a">{{ a }}</option>
            </select>
            <span class="text-gray-500">a</span>
            <select v-model.number="form.ageMax" class="border border-gray-300 rounded-lg px-3 py-2">
              <option v-for="a in ageOptions" :key="a" :value="a">{{ a }}{{ a === 65 ? '+' : '' }}</option>
            </select>
            <span class="text-gray-500">años</span>
          </div>
          <p class="text-xs text-gray-500 mt-2">Meta busca a las personas con más probabilidad de hacer clic dentro de este público.</p>
        </div>
      </section>

      <!-- Paso 4 -->
      <section v-if="step === 4" class="space-y-6">
        <div>
          <h2 class="text-lg font-semibold mb-3">Presupuesto diario</h2>
          <div class="flex flex-wrap gap-2 mb-3">
            <button v-for="b in budgetPresets" :key="b" type="button" @click="form.dailyBudget = b" class="px-4 py-2 rounded-lg border text-sm" :class="form.dailyBudget === b ? 'border-black bg-gray-50 font-medium' : 'border-gray-200'">{{ money(b) }}</button>
          </div>
          <label class="inline-flex items-center gap-2 text-sm">
            Otro monto ({{ currency }}):
            <input v-model.number="form.dailyBudget" type="number" :min="minDaily" :step="currency === 'CLP' ? 500 : 1" class="w-32 border border-gray-300 rounded-lg px-3 py-1.5" />
          </label>
          <p class="text-xs text-gray-500 mt-1">Mínimo de tu cuenta: {{ money(minDaily) }} al día.</p>
        </div>
        <div>
          <h2 class="text-lg font-semibold mb-3">Duración</h2>
          <div class="flex flex-wrap gap-2 mb-3">
            <button v-for="d in dayPresets" :key="d" type="button" @click="form.days = d" class="px-4 py-2 rounded-lg border text-sm" :class="form.days === d ? 'border-black bg-gray-50 font-medium' : 'border-gray-200'">{{ d }} días</button>
          </div>
          <label class="inline-flex items-center gap-2 text-sm">
            Días:
            <input v-model.number="form.days" type="number" min="1" :max="maxDays" class="w-24 border border-gray-300 rounded-lg px-3 py-1.5" />
          </label>
          <p class="text-xs text-gray-500 mt-1">Termina el {{ endsOn }}. Máximo {{ maxDays }} días (hasta el evento).</p>
        </div>

        <div class="rounded-xl bg-gray-50 border border-gray-200 p-4 text-sm space-y-1">
          <p class="font-semibold mb-2 flex items-center gap-2"><Megaphone :size="16" /> Resumen</p>
          <p><span class="text-gray-500">Evento:</span> {{ event?.title || event?.name }}</p>
          <p><span class="text-gray-500">Anuncio:</span> {{ form.type === 'boost' ? 'Post promocionado' : form.headline }}</p>
          <p><span class="text-gray-500">Público:</span> {{ audienceLabel }}</p>
          <p><span class="text-gray-500">Presupuesto:</span> {{ money(form.dailyBudget) }} al día × {{ form.days }} días</p>
          <p class="text-base pt-1"><span class="text-gray-500">Gasto máximo:</span> <strong>{{ money(total) }}</strong></p>
        </div>

        <div class="flex flex-wrap gap-2">
          <button type="button" @click="form.launch = 'now'" class="px-4 py-2 rounded-lg border text-sm" :class="form.launch === 'now' ? 'border-black bg-gray-50 font-medium' : 'border-gray-200'">Publicar ahora</button>
          <button type="button" @click="form.launch = 'paused'" class="px-4 py-2 rounded-lg border text-sm" :class="form.launch === 'paused' ? 'border-black bg-gray-50 font-medium' : 'border-gray-200'">Crear pausado</button>
        </div>

        <label class="flex items-start gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50 text-sm cursor-pointer">
          <input v-model="form.confirmSpend" type="checkbox" class="mt-0.5" data-testid="ads-confirm-spend" />
          <span>Entiendo que Meta cobrará hasta <strong>{{ money(total) }}</strong> a la cuenta publicitaria <strong>{{ connection?.account_name }}</strong>. Puedo pausar o cancelar el anuncio cuando quiera desde AI Tickets.</span>
        </label>
      </section>

      <div v-if="error" class="mt-5 flex items-start gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
        <AlertCircle :size="16" class="mt-0.5 shrink-0" /> {{ error }}
      </div>

      <div class="mt-8 flex items-center justify-between gap-3">
        <button v-if="step > 1" type="button" @click="back" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100">
          <ArrowLeft :size="16" /> Atrás
        </button>
        <span v-else></span>
        <button v-if="step < totalSteps" type="button" @click="next" :disabled="!canProceed" class="inline-flex items-center gap-1.5 bg-black text-white px-5 py-2.5 rounded-lg hover:bg-gray-800 transition font-medium disabled:opacity-40">
          Siguiente <ArrowRight :size="16" />
        </button>
        <button v-else type="button" @click="submit" :disabled="!canProceed || submitting" data-testid="ads-submit" class="inline-flex items-center gap-1.5 bg-black text-white px-5 py-2.5 rounded-lg hover:bg-gray-800 transition font-medium disabled:opacity-40">
          <Loader2 v-if="submitting" :size="16" class="animate-spin" />
          {{ form.launch === 'paused' ? 'Crear anuncio pausado' : `Publicar anuncio (${money(total)})` }}
        </button>
      </div>
    </div>
  </div>
</template>
