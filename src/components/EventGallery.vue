<script setup>
// Galería al final de la página pública del evento (aitickets_event_gallery_images, src/lib/eventGallery.ts).
// Grilla de miniaturas (WebP) y visor a pantalla completa: flechas, Esc, swipe en mobile.
// También muestra las fotos de los asistentes (EventReviews.vue) con otro título y otro id de sección.
// Con `video` (events.gallery_video) muestra arriba de las fotos el video de portada (GalleryVideo.vue).
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import GalleryVideo from './event/GalleryVideo.vue'

const props = defineProps({
  images: { type: Array, default: () => [] },
  video: { type: Object, default: null },
  eventName: { type: String, default: '' },
  title: { type: String, default: 'Galería' },
  sectionId: { type: String, default: 'galeria' },
  testId: { type: String, default: 'event-gallery' },
  // Sin margen superior propio (cuando va dentro de otra sección)
  embedded: { type: Boolean, default: false },
})

const INITIAL = 8
const expanded = ref(false)
const current = ref(-1)
const closeButton = ref(null)
let lastFocus = null
let touchX = null

const visible = computed(() => (expanded.value ? props.images : props.images.slice(0, INITIAL)))
const hiddenCount = computed(() => Math.max(0, props.images.length - INITIAL))
const active = computed(() => (current.value >= 0 ? props.images[current.value] : null))
const altFor = (img, i) => img.caption || `${props.eventName ? `${props.eventName} – ` : ''}foto ${i + 1}`

function open(i) {
  lastFocus = document.activeElement
  current.value = i
}
function close() {
  current.value = -1
}
function step(delta) {
  const n = props.images.length
  if (!n) return
  current.value = (current.value + delta + n) % n
}

function onKey(e) {
  if (current.value < 0) return
  if (e.key === 'Escape') close()
  else if (e.key === 'ArrowRight') step(1)
  else if (e.key === 'ArrowLeft') step(-1)
}
function onTouchStart(e) {
  touchX = e.touches[0]?.clientX ?? null
}
function onTouchEnd(e) {
  if (touchX === null) return
  const dx = (e.changedTouches[0]?.clientX ?? touchX) - touchX
  touchX = null
  if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1)
}

watch(current, async (value, previous) => {
  if (typeof document === 'undefined') return
  if (value >= 0 && previous < 0) {
    document.addEventListener('keydown', onKey)
    document.documentElement.style.overflow = 'hidden'
    await nextTick()
    closeButton.value?.focus()
  } else if (value < 0 && previous >= 0) {
    document.removeEventListener('keydown', onKey)
    document.documentElement.style.overflow = ''
    lastFocus?.focus?.()
  }
  // Precarga la siguiente para que el paso sea instantáneo
  const next = value >= 0 ? props.images[(value + 1) % props.images.length] : null
  if (next) new Image().src = next.url
})

onBeforeUnmount(() => {
  if (typeof document === 'undefined') return
  document.removeEventListener('keydown', onKey)
  document.documentElement.style.overflow = ''
})
</script>

<template>
  <section v-if="images.length || video" :id="sectionId" class="scroll-mt-24 font-['Prompt']" :class="embedded ? '' : 'mt-12'" :data-testid="testId">
    <h2 class="font-bold mb-4 font-['Unbounded']" :class="embedded ? 'text-lg' : 'text-2xl'">{{ title }}</h2>
    <GalleryVideo v-if="video" :video="video" :eventName="eventName" />
    <ul v-if="images.length" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
      <li v-for="(img, i) in visible" :key="img.id">
        <button type="button" class="group block w-full aspect-square overflow-hidden rounded-lg bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
          :aria-label="`Ver ${altFor(img, i)}`" @click="open(i)">
          <img :src="img.thumb_url || img.url" :alt="altFor(img, i)" loading="lazy" decoding="async"
            width="640" height="640"
            class="w-full h-full object-cover transition duration-300 group-hover:scale-105" />
        </button>
      </li>
    </ul>
    <div v-if="hiddenCount && !expanded" class="mt-4 text-center">
      <button type="button" class="px-5 py-2 rounded-full border border-gray-300 text-sm font-semibold hover:border-black transition" @click="expanded = true">
        Ver las {{ images.length }} fotos
      </button>
    </div>

    <!-- Visor (fixed; sin Teleport para no complicar la hidratación de la isla de Astro) -->
    <div v-if="active" class="fixed inset-0 z-[100] bg-black/95 flex flex-col font-['Prompt']" role="dialog" aria-modal="true"
      :aria-label="`Galería de ${eventName || 'el evento'}`" @click.self="close" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
      <div class="flex items-center justify-between px-4 py-3 text-white/80 text-sm">
        <span>{{ current + 1 }} / {{ images.length }}</span>
        <button ref="closeButton" type="button" class="p-2 rounded-full hover:bg-white/10 text-white text-2xl leading-none" aria-label="Cerrar" @click="close">×</button>
      </div>
      <div class="relative flex-1 min-h-0 flex items-center justify-center px-2 sm:px-16" @click.self="close">
        <img :key="active.id" :src="active.url" :alt="altFor(active, current)" class="max-h-full max-w-full object-contain select-none" />
        <template v-if="images.length > 1">
          <button type="button" class="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl"
            aria-label="Foto anterior" @click="step(-1)">‹</button>
          <button type="button" class="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl"
            aria-label="Foto siguiente" @click="step(1)">›</button>
        </template>
      </div>
      <p class="px-4 py-4 min-h-[3.5rem] text-center text-white/90 text-sm">{{ active.caption }}</p>
    </div>
  </section>
</template>
