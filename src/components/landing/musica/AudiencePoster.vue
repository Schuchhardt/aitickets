<script setup>
// "Hecho para" (SPEC_landing_musica §4.2): cartel tipográfico de festival y selector "¿Quién eres?" (Banda o solista ·
// Productora · Sala o venue). Al cambiar, la palabra del cartel pasa a rojo tinta y cambian las tres líneas (M6:
// crossfade + translateY ±8 px, 240 ms). El selector es un radiogroup con flechas, como el de las calculadoras
// (usePayerToggle). Sin JS se ven las tres columnas apiladas, cada una con su título, y no hay selector. Con JS
// (html.mu-js, que pone MusicForWho antes de pintar) el HTML del servidor ya muestra el selector y solo la primera
// columna, sin título: al hidratar no cambia el alto (CLS, §7). Las líneas del cartel entran con stagger de 100 ms
// (data-lp-step dentro del [data-lp-reveal] de la sección); el cartel se lee entero en .lp-sr-only y las líneas
// visuales van aria-hidden. Analítica: mu_audience_tab { audience } (band, producer, venue).
import { computed, onMounted, ref } from 'vue'
import { usePayerToggle } from '../../../composables/usePriceCalculator.js'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { AUDIENCES, POSTER_LINES } from './musicaLanding.js'

const props = defineProps({
  /** PAYOUT_SHORT_TEXT de legal.mjs (la línea "Cobras cada fecha por separado") */
  payoutShort: { type: String, required: true },
  /** MAX_EVENT_FUNCTIONS de producerFaq.ts (la línea "Varias fechas y ciudades en un evento") */
  maxFunctions: { type: Number, required: true },
})

const options = AUDIENCES.map((a) => ({ value: a.id, label: a.label }))
const { payer: active, segButtons, onSegKey } = usePayerToggle(options, AUDIENCES[0].id)
const hydrated = ref(false)
onMounted(() => {
  hydrated.value = true
})

const audiences = AUDIENCES.map((a) => ({
  ...a,
  lines: a.lines.map((l) => ({
    ...l,
    text: l.text.replace('{payoutShort}', props.payoutShort).replace('{maxFunctions}', String(props.maxFunctions)),
  })),
}))
const activeIndex = computed(() => audiences.findIndex((a) => a.id === active.value))
const current = computed(() => audiences[activeIndex.value])
// Lo que leen los lectores de pantalla en vez de las líneas del cartel (aria-hidden)
const posterText = 'Bandas, solistas, productoras y salas: tocatas, ciclos, lanzamientos, festivales y giras'
const isLit = (word) => hydrated.value && current.value.words.includes(word)

function choose(id) {
  if (active.value === id) return
  active.value = id
  trackEvent('mu_audience_tab', { audience: id })
}
function onKey(e, i) {
  const before = active.value
  onSegKey(e, i)
  if (active.value !== before) trackEvent('mu_audience_tab', { audience: active.value })
}
</script>

<template>
  <div class="ap" data-testid="music-audience">
    <p class="ap-poster">
      <span class="lp-sr-only">{{ posterText }}</span>
      <span v-for="(line, i) in POSTER_LINES" :key="i" class="ap-line" :class="`ap-line-${i + 1}`" aria-hidden="true" data-lp-step>
        <template v-for="(word, j) in line" :key="word">
          <span v-if="j > 0" class="ap-dot"> · </span>
          <span class="ap-word" :class="{ 'is-lit': isLit(word) }">{{ word }}</span>
        </template>
      </span>
    </p>

    <div class="ap-pick" data-lp-step>
      <p id="mu-audience-label" class="mu-mono ap-label">¿Quién eres?</p>
      <div class="ap-seg" role="radiogroup" aria-labelledby="mu-audience-label">
        <span class="ap-seg-thumb" :style="{ transform: `translateX(${activeIndex * 100}%)` }" aria-hidden="true"></span>
        <button
          v-for="(o, i) in options"
          :key="o.value"
          :ref="(el) => (segButtons[i] = el)"
          type="button"
          role="radio"
          class="ap-seg-btn"
          :class="{ 'is-on': active === o.value }"
          :aria-checked="active === o.value ? 'true' : 'false'"
          :tabindex="active === o.value ? 0 : -1"
          :data-testid="`music-audience-${o.value}`"
          @click="choose(o.value)"
          @keydown="onKey($event, i)"
        >{{ o.label }}</button>
      </div>
    </div>

    <div class="ap-panels">
      <Transition v-if="hydrated" name="ap-swap" mode="out-in">
        <ol :key="current.id" class="ap-lines" data-testid="music-audience-lines">
          <li v-for="(line, n) in current.lines" :key="line.title" class="ap-item">
            <span class="mu-mono ap-n" aria-hidden="true">{{ n + 1 }}</span>
            <p>
              <strong class="ap-item-title">{{ line.title }}</strong> {{ line.text }}
              <a v-if="line.link" :href="line.link.href" class="mu-link ap-more">{{ line.link.label }}</a>
            </p>
          </li>
        </ol>
      </Transition>
      <template v-else>
        <div v-for="a in audiences" :key="a.id" class="ap-col">
          <h3 class="mu-mono ap-col-title">{{ a.label }}</h3>
          <ol class="ap-lines">
            <li v-for="(line, n) in a.lines" :key="line.title" class="ap-item">
              <span class="mu-mono ap-n" aria-hidden="true">{{ n + 1 }}</span>
                <p>
                <strong class="ap-item-title">{{ line.title }}</strong> {{ line.text }}
                <a v-if="line.link" :href="line.link.href" class="mu-link ap-more">{{ line.link.label }}</a>
              </p>
            </li>
          </ol>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.ap-poster {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-family: var(--mu-display);
  text-align: center;
  text-transform: uppercase;
  color: var(--mu-ink);
}
.ap-line {
  display: block;
  max-width: 100%;
}
.ap-line-1 {
  font-size: clamp(36px, 12vw, 48px);
  line-height: 1.04;
}
.ap-line-2 {
  font-size: clamp(28px, 9vw, 36px);
  line-height: 1.1;
}
.ap-line-3 {
  font-size: 24px;
  line-height: 30px;
}
.ap-dot {
  color: var(--mu-ink-3);
}
.ap-word {
  transition: color 200ms var(--ease-out);
}
.ap-word.is-lit {
  color: var(--mu-red-ink);
}
.ap-pick {
  max-width: 640px;
  margin: 40px auto 0;
}
.ap-label {
  text-align: center;
  color: var(--mu-ink-3);
}
.ap-seg {
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 12px;
  border: 2px solid var(--mu-ink);
  border-radius: 6px;
  background: var(--mu-paper);
}
.ap-seg-thumb {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: calc(100% / 3);
  background: var(--mu-ink);
  transition: transform 260ms var(--ease-in-out);
}
.ap-seg-btn {
  position: relative;
  min-height: 48px;
  padding: 6px 8px;
  border: 0;
  background: none;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 17px;
  color: var(--mu-ink);
  cursor: pointer;
  transition: color 260ms var(--ease-in-out);
}
.ap-seg-btn.is-on {
  color: var(--mu-paper);
}
.ap-seg-btn:focus-visible {
  outline: 3px solid var(--mu-red-ink);
  outline-offset: 2px;
  z-index: 1;
}
.ap-panels {
  max-width: 980px;
  margin: 32px auto 0;
}
.ap-col + .ap-col {
  margin-top: 32px;
}
.ap-col-title {
  margin-bottom: 12px;
  color: var(--mu-ink-3);
}
.ap-lines {
  display: grid;
  gap: 18px;
}
.ap-item {
  display: flex;
  gap: 14px;
  padding-top: 16px;
  border-top: 2px solid var(--mu-ink);
  font-size: 16px;
  line-height: 25px;
  color: var(--mu-ink-2);
}
.ap-n {
  flex: 0 0 auto;
  color: var(--mu-red-ink);
}
.ap-item-title {
  display: block;
  font-weight: 600;
  color: var(--mu-ink);
}
.ap-more {
  margin-left: 4px;
}
.ap-swap-enter-active,
.ap-swap-leave-active {
  transition: opacity 240ms var(--ease-out), transform 240ms var(--ease-out);
}
.ap-swap-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.ap-swap-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
@media (min-width: 768px) {
  .ap-line-1 {
    font-size: 88px;
    line-height: 88px;
  }
  .ap-line-2 {
    font-size: 60px;
    line-height: 64px;
  }
  .ap-line-3 {
    font-size: 34px;
    line-height: 42px;
  }
  .ap-seg-btn {
    font-size: 15px;
  }
  .ap-lines {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 32px;
  }
  .ap-item {
    flex-direction: column;
    gap: 8px;
  }
}
@media (min-width: 1280px) {
  .ap-line-1 {
    font-size: 120px;
    line-height: 116px;
  }
  .ap-line-2 {
    font-size: 80px;
    line-height: 84px;
  }
  .ap-line-3 {
    font-size: 48px;
    line-height: 56px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ap-word,
  .ap-seg-thumb,
  .ap-seg-btn,
  .ap-swap-enter-active,
  .ap-swap-leave-active {
    transition-duration: 1ms;
  }
}
</style>

<style>
/* Antes de hidratar (sin scoped: depende de html.mu-js). Sin JS no hay selector y se ven las tres columnas; con JS se
 * ve el selector y solo la primera columna, sin título, con el mismo alto que tendrá al hidratar. */
html:not(.mu-js) .ap-seg {
  display: none;
}
html.mu-js .ap-col-title,
html.mu-js .ap-col + .ap-col {
  display: none;
}
</style>
