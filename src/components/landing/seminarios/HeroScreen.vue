<script setup>
// La sala del hero (SPEC_landing_seminarios §4.1): la foto sobria (LCP: AVIF/WebP, fetchpriority alto, sin lazy-load)
// sin recorte, para que el telón calce con HERO_SCREEN_RECT, y sobre el telón una lámina que se proyecta (opacity .94 y un
// brillo interior suave). Tres láminas (programa, inscritos, acreditación) que avanzan cada HERO_SLIDE_MS solo mientras
// se ven y sin hover ni foco (C3), con controles bajo la foto: ‹ 1 / 3 › y Pausa / Seguir (WCAG 2.2.2) y una barra de
// progreso de 2 px. Un puntero decorativo (punto turquesa con halo, aria-hidden) se mueve a la cifra de cada lámina (C6).
// - SSR / sin JS: la primera lámina, sin auto-avance.
// - Mobile (< 1024 px): la foto recortada 4:3 sin overlay y, debajo, las tres láminas en un carrusel con scroll-snap,
//   sin auto-avance. Las dos versiones salen en el SSR y la media query muestra una u otra (sin saltos, CLS §7).
// - Con "reducir movimiento": sin auto-avance (solo con los botones), sin puntero, sin revelado ni parpadeo.
// C2 (html.lp-motion): la foto se revela con clip-path (700 ms) y la pantalla "se enciende" con un parpadeo corto.
// El contador "1 / 3" se anuncia solo cuando no rota solo (aria-live="off" mientras avanza: el patrón de carrusel
// accesible); con el foco o el mouse en la sala la rotación para, así que los cambios con ‹ › sí se anuncian.
// Analítica: se_slide {index, via: 'manual'} (el avance automático no se envía).
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import HeroSlide from './HeroSlide.vue'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { DESK_START, HERO_SCREEN_RECT, HERO_SLIDES, HERO_SLIDE_MS } from './seminariosLanding.js'

const props = defineProps({
  photo: { type: Object, required: true },
  alt: { type: String, required: true },
  caption: { type: String, required: true },
})

const LABELS = { programa: 'Programa del día 1', inscritos: 'Inscritos', acreditacion: 'Acreditación' }
/** Hacia dónde va el puntero en cada lámina (en % de la lámina) */
const POINTER = { programa: [12, 52], inscritos: [32, 36], acreditacion: [44, 40] }
const VALIDATED = DESK_START + 4

const root = ref(null)
const index = ref(0)
const paused = ref(false)
const hovering = ref(false)
const visible = ref(false)
const reduced = ref(false)
const cycle = ref(0)
const direction = ref(1)
const slide = computed(() => HERO_SLIDES[index.value])
const rect = HERO_SCREEN_RECT
const screenStyle = { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }
const pointerStyle = computed(() => {
  const [x, y] = POINTER[slide.value]
  return { transform: `translate(${x}cqw, ${(y * rect.h * 688) / (rect.w * 1024)}cqw)` }
})
const running = computed(() => !reduced.value && !paused.value && !hovering.value && visible.value)

let timer = null
function schedule() {
  clearTimeout(timer)
  if (running.value) timer = setTimeout(() => go(1, 'auto'), HERO_SLIDE_MS)
}
function go(step, via = 'manual') {
  direction.value = step
  index.value = (index.value + step + HERO_SLIDES.length) % HERO_SLIDES.length
  cycle.value += 1
  if (via === 'manual') trackEvent('se_slide', { index: index.value + 1, via })
}
watch([running, index], schedule)

let io = null
let mq = null
const onMq = () => (reduced.value = mq.matches)
onMounted(async () => {
  mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  onMq()
  mq.addEventListener?.('change', onMq)
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver(([entry]) => (visible.value = entry.isIntersecting), { threshold: 0.4 })
    await nextTick()
    if (root.value) io.observe(root.value)
  }
})
onBeforeUnmount(() => {
  clearTimeout(timer)
  io?.disconnect()
  mq?.removeEventListener?.('change', onMq)
})
</script>

<template>
  <div ref="root" class="seh" data-testid="seminar-hero-screen" @mouseenter="hovering = true" @mouseleave="hovering = false" @focusin="hovering = true" @focusout="hovering = false">
    <figure class="se-figure seh-figure">
      <span class="se-figure-frame seh-frame">
        <picture>
          <source v-for="s in props.photo.sources" :key="s.type" :type="s.type" :srcset="s.srcset" sizes="(min-width: 1024px) 680px, 100vw" />
          <img class="se-figure-img seh-img" :src="props.photo.src" :alt="props.alt" :width="props.photo.width" :height="props.photo.height" fetchpriority="high" decoding="sync" />
        </picture>
        <!-- La pantalla de la sala (desktop): la lámina sobre el telón -->
        <span class="seh-screen" :style="screenStyle" aria-hidden="true">
          <Transition :name="direction > 0 ? 'seh-next' : 'seh-prev'">
            <span :key="slide" class="seh-slide"><HeroSlide :slide="slide" :validated="VALIDATED" /></span>
          </Transition>
          <span v-if="!reduced" class="seh-pointer" :style="pointerStyle"><span :key="cycle" class="seh-halo"></span></span>
        </span>
      </span>
      <figcaption class="seh-caption">
        <span>{{ props.caption }}</span>
        <span class="seh-controls">
          <button type="button" class="seh-btn" aria-label="Lámina anterior" data-testid="seminar-slide-prev" @click="go(-1)">‹</button>
          <span class="seh-count" :aria-live="running ? 'off' : 'polite'" data-testid="seminar-slide-count"><span class="lp-sr-only">{{ LABELS[slide] }}, lámina </span>{{ index + 1 }} / {{ HERO_SLIDES.length }}</span>
          <button type="button" class="seh-btn" aria-label="Lámina siguiente" data-testid="seminar-slide-next" @click="go(1)">›</button>
          <button v-if="!reduced" type="button" class="seh-btn seh-pause" :aria-pressed="paused ? 'true' : 'false'" data-testid="seminar-slide-pause" @click="paused = !paused">
            {{ paused ? 'Seguir' : 'Pausa' }}
          </button>
        </span>
      </figcaption>
      <span class="seh-progress" aria-hidden="true"><span v-if="running" :key="`p${cycle}`" :style="{ animationDuration: `${HERO_SLIDE_MS}ms` }"></span></span>
    </figure>

    <!-- Mobile: las láminas en un carrusel con scroll-snap, sin auto-avance -->
    <ul class="seh-carousel" aria-label="Láminas de ejemplo">
      <li v-for="(s, i) in HERO_SLIDES" :key="s" class="se-slide seh-card">
        <div class="seh-card-body"><HeroSlide :slide="s" :validated="VALIDATED" /></div>
        <div class="se-slide-foot"><span class="se-meta">{{ LABELS[s] }} · ejemplo</span><span class="se-meta">{{ i + 1 }} / {{ HERO_SLIDES.length }}</span></div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.seh {
  min-width: 0;
}
.seh-frame {
  aspect-ratio: 4 / 3;
}
.seh-img {
  object-position: 60% 30%;
}
.seh-screen {
  display: none;
}
.seh-caption {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
}
.seh-controls {
  display: none;
  align-items: center;
  gap: 4px;
}
.seh-btn {
  min-width: 44px;
  min-height: 44px;
  padding: 0 10px;
  border: 1px solid var(--se-filete);
  border-radius: 4px;
  background: var(--se-blanco);
  font-family: var(--se-font);
  font-size: 13px;
  font-weight: 600;
  font-stretch: 75%;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--se-grafito);
  cursor: pointer;
}
.seh-btn:focus-visible {
  outline: 3px solid var(--se-cordon-ink);
  outline-offset: 2px;
}
.seh-count {
  min-width: 48px;
  text-align: center;
  font-family: var(--se-font);
  font-size: 13px;
  font-weight: 600;
  font-stretch: 75%;
  font-variant-numeric: tabular-nums;
  color: var(--se-grafito);
}
.seh-progress {
  display: none;
  height: 2px;
  margin-top: 8px;
  background: var(--se-filete);
}
.seh-progress span {
  display: block;
  height: 100%;
  background: var(--se-cordon);
  transform-origin: left center;
  animation: seh-progress linear both;
}
@keyframes seh-progress {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}
.seh-carousel {
  display: flex;
  gap: 12px;
  margin-top: 16px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  padding-bottom: 4px;
}
.seh-carousel::-webkit-scrollbar {
  display: none;
}
.seh-card {
  flex: 0 0 86%;
  scroll-snap-align: start;
}
.seh-card-body {
  aspect-ratio: 16 / 10;
}
@media (min-width: 1024px) {
  .seh-frame {
    aspect-ratio: 1024 / 688;
  }
  .seh-img {
    object-position: 50% 50%;
  }
  .seh-screen {
    position: absolute;
    display: block;
    container-type: inline-size;
    overflow: hidden;
  }
  .seh-slide {
    position: absolute;
    inset: 0;
    background: #ffffff;
    opacity: 0.94;
    box-shadow: inset 0 0 40px rgba(255, 255, 255, 0.6);
  }
  .seh-pointer {
    position: absolute;
    top: 0;
    left: 0;
    width: 10px;
    height: 10px;
    margin: -5px 0 0 -5px;
    border-radius: 50%;
    background: var(--se-proyector);
    box-shadow: 0 0 0 3px rgba(79, 209, 197, 0.35);
    transition: transform 500ms ease-out;
  }
  .seh-halo {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: var(--se-proyector);
    animation: seh-halo 600ms ease-out 2 both;
  }
  .seh-controls {
    display: inline-flex;
  }
  .seh-progress {
    display: block;
  }
  .seh-carousel {
    display: none;
  }
  /* C3: la saliente se va a la izquierda y la entrante llega desde la derecha (al revés con ‹) */
  .seh-next-enter-active,
  .seh-next-leave-active,
  .seh-prev-enter-active,
  .seh-prev-leave-active {
    transition: opacity 360ms var(--se-ease), transform 360ms var(--se-ease);
  }
  .seh-next-enter-from,
  .seh-prev-leave-to {
    opacity: 0;
    transform: translateX(4%);
  }
  .seh-next-leave-to,
  .seh-prev-enter-from {
    opacity: 0;
    transform: translateX(-4%);
  }
}
@keyframes seh-halo {
  from {
    transform: scale(1);
    opacity: 0.5;
  }
  to {
    transform: scale(1.6);
    opacity: 0;
  }
}
/* C2: revelado de la foto y la pantalla que se enciende (solo con movimiento). En Vue, todo lo que sigue a :global() se
   descarta: el selector completo va dentro (las clases seh- son de este componente). */
:global(.lp-motion .seh-frame) {
  animation: se-reveal-x 700ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
@media (min-width: 1024px) {
  :global(.lp-motion .seh-screen) {
    animation: se-power-full 240ms linear 700ms both;
  }
}
@media (prefers-reduced-motion: reduce) {
  .seh-pointer,
  .seh-halo {
    display: none;
  }
  .seh-next-enter-active,
  .seh-next-leave-active,
  .seh-prev-enter-active,
  .seh-prev-leave-active {
    transition: none;
  }
}
</style>
