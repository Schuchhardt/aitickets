<script setup>
// Comparador "¿Te suena familiar?" de la landing de academias (SPEC_landing_academias §3.3, AC5-AC8): segmented control
// "Antes | Con AI Tickets", el panel de la izquierda (chat del grupo o panel de AI Tickets) y la lista de la derecha.
// La raíz es display: contents: el control y el cuerpo se ubican en la grilla de la sección (AcademyCompare.astro),
// el control junto al título en desktop.
// Comportamiento:
// - Del servidor (y sin JS, o con "reducir movimiento") sale en "Con AI Tickets", sin animar (§4).
// - Con movimiento, al montarse pasa a "Antes"; cuando el cuerpo entra al 25% de la pantalla, los mensajes aparecen
//   uno a uno (AC5) y a los `autoSwitchMs` pasa solo a "Con AI Tickets", una vez (AC7). Si la persona tocó el control
//   antes, no hay cambio automático.
// - Si al hidratarse el cuerpo ya está en pantalla (recarga con el scroll restaurado, link a #precio, scroll rápido en
//   un equipo lento), se queda en "Con AI Tickets" sin animar: pasar a "Antes" se vería como un salto.
// - Paneles con crossfade + translateY ±12px + scale .98→1 (420 ms), indicador que se desliza (260 ms), filas con
//   stagger de 70 ms (AC6) y barras por curso al mostrarse el panel (AC8). El panel oculto queda inert.
// - El control es un radiogroup con flechas (usePayerToggle de usePriceCalculator.js sirve para cualquier par de
//   opciones). Analítica: ac_compare_toggle { to, auto }.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { usePayerToggle } from '../../../composables/usePriceCalculator.js'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import GroupChatMockup from './GroupChatMockup.vue'
import CourseBreakdown from './CourseBreakdown.vue'

const props = defineProps({
  chat: { type: Object, required: true },
  dashboard: { type: Object, required: true },
  // { before: [{ t, d, desktopOnly? }], after: [...] } con el mismo largo
  pains: { type: Object, required: true },
  autoSwitchMs: { type: Number, required: false, default: 2600 },
})

const modes = [
  { value: 'before', label: 'Antes' },
  { value: 'after', label: 'Con AI Tickets' },
]
const { payer: mode, segButtons, onSegKey } = usePayerToggle(modes, 'after')
const animated = ref(false)
const seen = ref(false)
const touched = ref(false)
const body = ref(null)
let observer = null
let timer = null

function choose(value, { auto = false } = {}) {
  if (!auto) touched.value = true
  if (mode.value === value) return
  mode.value = value
  trackEvent('ac_compare_toggle', { to: value, auto })
}
function onKey(e, i) {
  touched.value = true
  const before = mode.value
  onSegKey(e, i)
  if (mode.value !== before) trackEvent('ac_compare_toggle', { to: mode.value, auto: false })
}

function inViewport(el) {
  const r = el.getBoundingClientRect()
  return r.top < window.innerHeight && r.bottom > 0
}

onMounted(() => {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (reduced || !('IntersectionObserver' in window) || !body.value || inViewport(body.value)) {
    seen.value = true
    return
  }
  animated.value = true
  mode.value = 'before'
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      seen.value = true
      observer.disconnect()
      timer = setTimeout(() => {
        if (!touched.value) choose('after', { auto: true })
      }, props.autoSwitchMs)
    },
    { threshold: 0.25 },
  )
  observer.observe(body.value)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  clearTimeout(timer)
})
// Si la persona elige antes de que la sección entre, ya no se cambia sola
watch(touched, (v) => {
  if (v) clearTimeout(timer)
})
</script>

<template>
  <div class="cmp-root" data-testid="academy-compare" :data-mode="mode">
    <div class="cmp-seg" data-lp-step>
      <div class="cmp-seg-track" role="radiogroup" aria-label="Comparar la muestra antes y con AI Tickets">
        <span class="cmp-seg-thumb" :class="{ 'is-right': mode === 'after' }" aria-hidden="true"></span>
        <button
          v-for="(m, i) in modes"
          :key="m.value"
          :ref="(el) => (segButtons[i] = el)"
          type="button"
          role="radio"
          class="cmp-seg-btn"
          :class="{ 'is-on': mode === m.value }"
          :aria-checked="mode === m.value ? 'true' : 'false'"
          :tabindex="mode === m.value ? 0 : -1"
          aria-controls="ac-compare-body"
          :data-testid="`academy-compare-${m.value}`"
          @click="choose(m.value)"
          @keydown="onKey($event, i)"
        >{{ m.label }}</button>
      </div>
    </div>

    <div id="ac-compare-body" ref="body" class="cmp-body" :class="{ 'is-animated': animated }" data-lp-step>
      <div class="cmp-stage">
        <div class="cmp-pane" :class="{ 'is-on': mode === 'before' }" :aria-hidden="mode !== 'before' ? 'true' : undefined" :inert="mode !== 'before'">
          <GroupChatMockup :chat="props.chat" :played="seen" :animated="animated" />
        </div>
        <div class="cmp-pane cmp-pane-after" :class="{ 'is-on': mode === 'after' }" :aria-hidden="mode !== 'after' ? 'true' : undefined" :inert="mode !== 'after'">
          <CourseBreakdown :dashboard="props.dashboard" :active="seen && mode === 'after'" :animated="animated" />
        </div>
      </div>

      <ul :key="mode" class="cmp-list" :class="{ 'is-played': seen }" data-testid="academy-compare-list">
        <li
          v-for="(p, i) in props.pains[mode]"
          :key="p.t"
          class="cmp-row"
          :class="{ 'is-desktop': p.desktopOnly }"
          :style="{ '--cmp-d': `${i * 70}ms` }"
        >
          <span class="cmp-icon" :class="mode === 'before' ? 'is-bad' : 'is-good'" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <path :d="mode === 'before' ? 'M7 7l10 10M17 7L7 17' : 'M5 12.5l4.5 4.5L19 7.5'" />
            </svg>
          </span>
          <p>
            <span class="cmp-row-title">{{ p.t }}</span>
            <span class="cmp-row-text">{{ p.d }}</span>
          </p>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.cmp-root {
  display: contents;
}
.cmp-seg {
  grid-area: seg;
}
.cmp-seg-track {
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding: 4px;
  border-radius: 999px;
  background: var(--ac-sand);
}
.cmp-seg-thumb {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 4px;
  width: calc(50% - 4px);
  border-radius: 999px;
  background: var(--ac-chaos);
  transition: transform 260ms var(--ease-in-out), background-color 260ms var(--ease-in-out);
}
.cmp-seg-thumb.is-right {
  transform: translateX(100%);
  background: var(--ac-ink);
}
.cmp-seg-btn {
  position: relative;
  min-height: 44px;
  border: 0;
  border-radius: 999px;
  background: none;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--ac-text-3);
  cursor: pointer;
  transition: color 260ms var(--ease-in-out);
}
.cmp-seg-btn.is-on {
  color: #fff;
}
.cmp-seg-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--ac-card), 0 0 0 5px var(--ac-ink);
}
.cmp-body {
  grid-area: body;
  display: grid;
  gap: 10px;
}
/* Los dos paneles en la misma celda: el alto es el del más alto, sin alturas fijas */
.cmp-stage {
  display: grid;
}
.cmp-pane {
  grid-area: 1 / 1;
  opacity: 0;
  transform: translateY(12px) scale(0.98);
  pointer-events: none;
  transition: opacity 420ms var(--ease-out), transform 420ms var(--ease-out);
}
.cmp-pane:not(.cmp-pane-after) {
  transform: translateY(-12px) scale(0.98);
}
.cmp-pane.is-on {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}
.cmp-list {
  display: flex;
  flex-direction: column;
}
.cmp-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 12px 0;
  border-bottom: 1px solid var(--ac-line);
}
.cmp-row.is-desktop {
  display: none;
}
.cmp-icon {
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 13px;
  font-weight: 700;
}
.cmp-icon.is-bad {
  background: var(--ac-chaos-bg);
  color: var(--ac-chaos);
}
.cmp-icon.is-good {
  background: var(--brand-lime);
  color: var(--ac-ink);
}
.cmp-row-title {
  display: block;
  font-size: 15px;
  font-weight: 600;
}
.cmp-row-text {
  display: block;
  margin-top: 2px;
  font-size: 14px;
  line-height: 21px;
  color: var(--ac-text-3);
}
/* AC6: filas con stagger cada vez que cambia el modo (la lista se vuelve a montar con :key) */
.cmp-body.is-animated .cmp-list:not(.is-played) .cmp-row {
  opacity: 0;
}
.cmp-body.is-animated .cmp-list.is-played .cmp-row {
  animation: cmp-item 380ms var(--ease-out) var(--cmp-d) both;
}
@keyframes cmp-item {
  from {
    opacity: 0;
    transform: translateX(-8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (min-width: 768px) {
  .cmp-seg-track {
    width: 360px;
    padding: 5px;
  }
  .cmp-seg-thumb {
    top: 5px;
    bottom: 5px;
    left: 5px;
    width: calc(50% - 5px);
  }
  .cmp-seg-btn {
    min-height: 46px;
    font-size: 15px;
  }
  .cmp-row.is-desktop {
    display: flex;
  }
  .cmp-row {
    gap: 14px;
    padding: 16px 0;
  }
  .cmp-icon {
    width: 28px;
    height: 28px;
    font-size: 14px;
  }
  .cmp-row-title {
    font-size: 17px;
  }
  .cmp-row-text {
    font-size: 15px;
    line-height: 23px;
  }
}
@media (min-width: 1024px) {
  .cmp-body {
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    align-items: start;
    gap: 56px;
  }
  .cmp-stage {
    min-height: 520px;
  }
  .cmp-list {
    gap: 4px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .cmp-seg-thumb,
  .cmp-seg-btn,
  .cmp-pane {
    transition-duration: 1ms;
  }
  .cmp-body.is-animated .cmp-row {
    opacity: 1;
    animation: none;
  }
}
</style>
