<script setup>
// Link con seguimiento (utm_* / ref): un botón por canal o un nombre propio; las ventas se ven en
// Analíticas → "Ventas por canal".
import { computed, ref } from 'vue'
import { Copy, Check, ChevronDown } from 'lucide-vue-next'

const props = defineProps({
  baseUrl: { type: String, required: true },
  analyticsUrl: { type: String, default: '' },
})

const CHANNELS = [
  { key: 'ig-bio', label: 'Instagram bio', source: 'instagram', medium: 'bio' },
  { key: 'ig-story', label: 'Instagram historia', source: 'instagram', medium: 'historia' },
  { key: 'facebook', label: 'Facebook', source: 'facebook', medium: 'post' },
  { key: 'whatsapp', label: 'WhatsApp', source: 'whatsapp', medium: 'mensaje' },
  { key: 'tiktok', label: 'TikTok', source: 'tiktok', medium: 'bio' },
  { key: 'email', label: 'Email', source: 'email', medium: 'newsletter' },
  { key: 'afiche', label: 'Afiche / QR', source: 'afiche', medium: 'qr' },
]

const selected = ref('')
const custom = ref('')
const showMore = ref(false)
const campaign = ref('')
const promoter = ref('')
const copied = ref(false)

const slug = (v) => v.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)

const pick = (key) => {
  selected.value = selected.value === key ? '' : key
  custom.value = ''
}
const onCustom = () => { if (custom.value) selected.value = '' }

const link = computed(() => {
  const url = new URL(props.baseUrl)
  const channel = CHANNELS.find((c) => c.key === selected.value)
  if (channel) {
    url.searchParams.set('utm_source', channel.source)
    url.searchParams.set('utm_medium', channel.medium)
  } else if (slug(custom.value)) {
    url.searchParams.set('utm_source', slug(custom.value))
  }
  if (slug(campaign.value)) url.searchParams.set('utm_campaign', slug(campaign.value))
  if (slug(promoter.value)) url.searchParams.set('ref', slug(promoter.value))
  return url.toString()
})
const hasTracking = computed(() => link.value !== new URL(props.baseUrl).toString())

const copy = async () => {
  try {
    await navigator.clipboard.writeText(link.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    prompt('Copia el link:', link.value)
  }
}
</script>

<template>
  <div class="bg-white p-6 rounded-xl border border-gray-200 shadow-sm" data-testid="tracking-link">
    <h3 class="font-bold text-lg mb-1">Link con seguimiento</h3>
    <p class="text-sm text-gray-500 mb-4">
      Elige dónde lo vas a compartir y copia el link. Así sabrás qué canal vende más
      <template v-if="analyticsUrl">(<a :href="analyticsUrl" class="underline hover:text-black">Analíticas → Ventas por canal</a>)</template>.
    </p>

    <div class="flex flex-wrap gap-2 mb-3">
      <button v-for="c in CHANNELS" :key="c.key" type="button" @click="pick(c.key)"
        class="px-3 py-1.5 rounded-full text-sm font-medium border transition"
        :class="selected === c.key ? 'bg-black text-white border-black' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'">
        {{ c.label }}
      </button>
    </div>
    <input v-model="custom" @input="onCustom" type="text" maxlength="64"
      placeholder="Otro canal o promotor (ej: radio-futuro, juan-perez)"
      class="w-full bg-gray-50 border border-gray-200 text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-black" />

    <button type="button" @click="showMore = !showMore" class="mt-2 flex items-center gap-1 text-xs text-gray-500 hover:text-black">
      <ChevronDown size="14" :class="showMore ? 'rotate-180' : ''" class="transition" /> Más opciones
    </button>
    <div v-if="showMore" class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
      <input v-model="campaign" type="text" maxlength="64" placeholder="Campaña (ej: preventa)"
        class="w-full bg-gray-50 border border-gray-200 text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-black" />
      <input v-model="promoter" type="text" maxlength="64" placeholder="Código de promotor (ref)"
        class="w-full bg-gray-50 border border-gray-200 text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-black" />
    </div>

    <div class="mt-4 rounded-lg border p-3" :class="hasTracking ? 'border-black bg-gray-50' : 'border-dashed border-gray-200'">
      <p class="text-xs font-medium mb-1" :class="hasTracking ? 'text-gray-500' : 'text-gray-400'">
        {{ hasTracking ? 'Tu link' : 'Elige un canal para armar el link' }}
      </p>
      <p class="font-mono text-xs break-all" :class="hasTracking ? 'text-gray-900' : 'text-gray-400'">{{ link }}</p>
      <button type="button" :disabled="!hasTracking" @click="copy"
        class="mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition disabled:opacity-40"
        :class="copied ? 'bg-green-600 text-white' : 'bg-black text-white hover:bg-gray-900'">
        <component :is="copied ? Check : Copy" size="15" /> {{ copied ? '¡Copiado!' : 'Copiar link' }}
      </button>
    </div>
  </div>
</template>
