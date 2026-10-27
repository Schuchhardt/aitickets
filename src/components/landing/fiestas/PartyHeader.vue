<script setup>
// Header de la landing de fiestas (SPEC_landing_fiestas §3), con el patrón de StandupHeader / ClubHeader: fijo y
// transparente sobre el hero (logo y links en tinta); pasados 40 px de scroll, crema al 92 % con blur y borde. Links:
// Preventa · Promotores · La puerta · Precio · Ingresar y el botón sticker tinta "Publicar mi fiesta". En vez de la barra
// de lectura de stand-up y del reloj de clubs lleva la pulsera de progreso: una banda de 6 px pegada al borde inferior
// que se llena con el scroll (scaleX) y toma el color de la pulsera de la sección visible ([data-fi-band-color]), con
// una pestaña en el extremo lleno y, en desktop, la etiqueta de la sección ([data-fi-band-label]). Es estado: también
// se actualiza con "reducir movimiento", sin transición de color (F17). Mobile: logo y botón de menú (44×44, sticker
// circle). Con sesión de productor, "Ingresar" pasa a "Ir a mi panel".
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Menu, X } from 'lucide-vue-next'
import logo from '../../../images/logo.png'
import { fetchSession } from '../../../lib/sessionHints.js'

const props = defineProps({
  publishHref: { type: String, required: true },
})

const scrolled = ref(false)
const menuOpen = ref(false)
const menuButton = ref(null)
const sheet = ref(null)
const producer = ref(null)
const progress = ref(0)
const bandColor = ref('naranja')
const bandLabel = ref('')
const accountHref = computed(() => (producer.value ? '/dashboard' : '/organizadores/login'))
const accountLabel = computed(() => (producer.value ? 'Ir a mi panel' : 'Ingresar'))

const links = [
  { href: '#preventa', label: 'Preventa' },
  { href: '#promotores', label: 'Promotores' },
  { href: '#puerta', label: 'La puerta' },
  { href: '#precio', label: 'Precio' },
]

let sections = []
let frame = 0
function measure() {
  frame = 0
  const y = window.scrollY
  scrolled.value = y > 40
  const max = document.documentElement.scrollHeight - window.innerHeight
  progress.value = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0
  // Sección visible: la última cuyo borde de arriba ya pasó bajo el header
  let current = null
  for (const s of sections) if (s.getBoundingClientRect().top <= 96) current = s
  bandColor.value = current?.dataset.fiBandColor || 'naranja'
  bandLabel.value = current?.dataset.fiBandLabel || ''
}
const onScroll = () => {
  if (!frame) frame = requestAnimationFrame(measure)
}
function toggleMenu() {
  menuOpen.value = !menuOpen.value
  if (menuOpen.value) nextTick(() => sheet.value?.querySelector('a')?.focus())
}
function closeMenu({ restoreFocus = false } = {}) {
  menuOpen.value = false
  if (restoreFocus) menuButton.value?.focus()
}
function onKeydown(e) {
  if (e.key === 'Escape' && menuOpen.value) closeMenu({ restoreFocus: true })
}

onMounted(() => {
  sections = [...document.querySelectorAll('[data-fi-band-color]')]
  measure()
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll, { passive: true })
  document.addEventListener('keydown', onKeydown)
  fetchSession().then((s) => {
    producer.value = s?.producer || null
  })
})
onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onScroll)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <header class="phd" :class="{ 'is-scrolled': scrolled || menuOpen }" data-testid="party-header">
    <div class="phd-inner">
      <a href="/" class="phd-logo" aria-label="AI Tickets, inicio">
        <img :src="logo.src" alt="" width="152" height="32" />
      </a>

      <div class="phd-actions">
        <nav class="phd-nav" aria-label="Principal">
          <a v-for="l in links" :key="l.href" :href="l.href" class="phd-link">{{ l.label }}</a>
          <a :href="accountHref" class="phd-link">{{ accountLabel }}</a>
        </nav>
        <a :href="props.publishHref" class="fi-btn fi-btn-tinta phd-cta" data-cta="publish" data-section="header">Publicar mi fiesta</a>
        <button
          ref="menuButton"
          type="button"
          class="phd-menu-btn"
          :aria-label="menuOpen ? 'Cerrar menú' : 'Abrir menú'"
          :aria-expanded="menuOpen ? 'true' : 'false'"
          aria-controls="party-menu"
          @click="toggleMenu"
        >
          <X v-if="menuOpen" :size="18" aria-hidden="true" />
          <Menu v-else :size="18" aria-hidden="true" />
        </button>
      </div>
    </div>

    <!-- Pulsera de progreso (F17) -->
    <div class="phd-band" :class="`is-${bandColor}`" aria-hidden="true">
      <span class="phd-band-fill" :style="{ transform: `scaleX(${progress})` }"></span>
      <span class="phd-band-tab" :style="{ left: `${progress * 100}%` }">
        <span v-if="bandLabel" class="phd-band-label">{{ bandLabel }}</span>
      </span>
    </div>

    <Transition name="phd-sheet">
      <div v-if="menuOpen" id="party-menu" ref="sheet" class="phd-sheet">
        <a v-for="l in links" :key="l.href" :href="l.href" class="phd-sheet-link" @click="closeMenu()">{{ l.label }}</a>
        <a href="/mis-entradas" class="phd-sheet-link" @click="closeMenu()">Mis entradas</a>
        <a :href="accountHref" class="phd-sheet-link" @click="closeMenu()">{{ accountLabel }}</a>
        <a :href="props.publishHref" class="fi-btn fi-btn-tinta phd-sheet-cta" data-cta="publish" data-section="header_menu">Publicar mi fiesta</a>
      </div>
    </Transition>
  </header>
</template>

<style scoped>
.phd {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 40;
  border-bottom: 1px solid transparent;
  background: rgba(255, 244, 228, 0);
  font-family: "Prompt", system-ui, sans-serif;
  transition: background-color 240ms var(--ease-out), border-color 240ms var(--ease-out);
}
.phd.is-scrolled {
  background: rgba(255, 244, 228, 0.92);
  border-bottom-color: var(--border);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
}
.phd-inner {
  max-width: 1280px;
  height: 64px;
  margin: 0 auto;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.phd-logo {
  display: inline-flex;
  border-radius: 4px;
}
.phd-logo img {
  height: 26px;
  width: auto;
}
.phd-logo:focus-visible,
.phd-link:focus-visible,
.phd-sheet-link:focus-visible {
  outline: 3px solid var(--fi-cobalto);
  outline-offset: 3px;
}
.phd-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.phd-nav {
  display: none;
  align-items: center;
  gap: 24px;
}
.phd-link {
  font-size: 14px;
  font-weight: 600;
  color: var(--fi-tinta);
  text-decoration: none;
  border-radius: 2px;
}
.phd-link:hover {
  text-decoration: underline;
  text-underline-offset: 4px;
  text-decoration-thickness: 2px;
}
.phd-cta {
  display: none;
  min-height: 42px;
  padding: 0 18px;
  font-size: 14px;
}
.phd-menu-btn {
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--fi-tinta);
  border-radius: 50%;
  background: var(--fi-crema);
  color: var(--fi-tinta);
  box-shadow: 2px 2px 0 var(--fi-tinta);
  cursor: pointer;
}
.phd-menu-btn:focus-visible {
  outline: 3px solid var(--fi-cobalto);
  outline-offset: 3px;
}
.phd-band {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -6px;
  height: 6px;
  pointer-events: none;
  --pb: var(--fi-amarillo);
}
.phd-band.is-naranja {
  --pb: var(--fi-naranja);
}
.phd-band.is-cobalto {
  --pb: var(--fi-cobalto);
}
.phd-band.is-crema {
  --pb: var(--fi-crema);
}
.phd-band.is-tinta {
  --pb: var(--fi-tinta);
}
/* Sobre el hero naranja, la pulsera de progreso va tinta para que se vea */
.phd:not(.is-scrolled) .phd-band.is-naranja {
  --pb: var(--fi-tinta);
}
.phd-band-fill {
  position: absolute;
  inset: 0;
  background: var(--pb);
  transform-origin: left center;
  box-shadow: inset 0 -1px 0 rgba(22, 17, 13, 0.25);
}
.phd-band-tab {
  position: absolute;
  top: -4px;
  width: 14px;
  height: 14px;
  margin-left: -14px;
  border: 2px solid var(--fi-tinta);
  border-radius: 3px;
  background: var(--pb);
}
.phd-band-label {
  display: none;
}
.phd-sheet {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  padding: 14px 20px 20px;
  display: flex;
  flex-direction: column;
  background: var(--fi-crema);
  border-bottom: 2px solid var(--fi-tinta);
  box-shadow: 0 16px 32px rgba(22, 17, 13, 0.18);
}
.phd-sheet-link {
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
  font-size: 16px;
  font-weight: 600;
  color: var(--fi-tinta);
  text-decoration: none;
}
.phd-sheet-cta {
  margin-top: 16px;
}
.phd-sheet-enter-active,
.phd-sheet-leave-active {
  transition: opacity var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out);
}
.phd-sheet-enter-from,
.phd-sheet-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
@media (min-width: 1024px) {
  .phd-inner {
    height: 72px;
    padding: 0 40px;
  }
  .phd-logo img {
    height: 30px;
  }
  .phd-actions {
    gap: 24px;
  }
  .phd-nav,
  .phd-cta {
    display: inline-flex;
  }
  .phd-menu-btn,
  .phd-sheet {
    display: none;
  }
  .phd-band-label {
    position: absolute;
    top: 0;
    right: 20px;
    display: block;
    font-size: 10px;
    line-height: 14px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    white-space: nowrap;
    color: var(--fi-tinta);
  }
}
@media (prefers-reduced-motion: reduce) {
  .phd,
  .phd-sheet-enter-active,
  .phd-sheet-leave-active {
    transition-duration: 1ms;
  }
}
</style>
