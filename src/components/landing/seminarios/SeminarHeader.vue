<script setup>
// Header de la landing de seminarios (SPEC_landing_seminarios §3), con el patrón de StandupHeader / PartyHeader: fijo,
// papel al 92 % con blur y filete inferior desde el inicio (el hero es claro: no hay estado transparente). Links:
// Programa · Empresas · Acreditación · Precio · Ingresar y el botón grafito "Publicar mi seminario". En vez de la barra
// de lectura de stand-up, el reloj de clubs o la pulsera de fiestas lleva la pantalla que hay afuera de cada sala: en
// desktop ≥ 1180 px, un recuadro grafito con "AHORA" + la sección visible y "A CONTINUACIÓN" + la siguiente (nombres de
// [data-se-screen]); debajo, a lo ancho, un filete turquesa de 2 px que se llena con el scroll (scaleX). La pantalla es
// decorativa (aria-hidden): la navegación real son los links. Entre 768 y 1180 px solo el filete; en mobile, el filete.
// C16: el texto cambia con un deslizamiento vertical de 8 px (180 ms); el filete es estado (sin transición). Mobile:
// logo y botón de menú 44×44 (cuadrado grafito). Con sesión de productor, "Ingresar" pasa a "Ir a mi panel".
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Menu, X } from 'lucide-vue-next'
import logo from '../../../images/logo.png'
import { fetchSession } from '../../../lib/sessionHints.js'

const props = defineProps({
  publishHref: { type: String, required: true },
})

const menuOpen = ref(false)
const menuButton = ref(null)
const sheet = ref(null)
const producer = ref(null)
const progress = ref(0)
const now = ref('Apertura')
const next = ref('Para quién')
const accountHref = computed(() => (producer.value ? '/dashboard' : '/organizadores/login'))
const accountLabel = computed(() => (producer.value ? 'Ir a mi panel' : 'Ingresar'))

const links = [
  { href: '#programa', label: 'Programa' },
  { href: '#empresas', label: 'Empresas' },
  { href: '#acreditacion', label: 'Acreditación' },
  { href: '#precio', label: 'Precio' },
]

let sections = []
let frame = 0
function measure() {
  frame = 0
  const y = window.scrollY
  const max = document.documentElement.scrollHeight - window.innerHeight
  progress.value = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0
  // Sección visible: la última cuyo borde de arriba ya pasó bajo el header
  let index = 0
  sections.forEach((s, i) => {
    if (s.getBoundingClientRect().top <= 96) index = i
  })
  now.value = sections[index]?.dataset.seScreen || 'Apertura'
  next.value = sections[index + 1]?.dataset.seScreen || '—'
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
  sections = [...document.querySelectorAll('[data-se-screen]')]
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
  <header class="shd" data-testid="seminar-header">
    <div class="shd-inner">
      <a href="/" class="shd-logo" aria-label="AI Tickets, inicio">
        <img :src="logo.src" alt="" width="152" height="32" />
      </a>

      <!-- Pantalla de sala (C16): decorativa -->
      <div class="shd-screen" aria-hidden="true">
        <p class="shd-screen-row">
          <span class="shd-screen-key is-now">Ahora</span>
          <Transition name="shd-slide" mode="out-in"><span :key="now" class="shd-screen-val">{{ now }}</span></Transition>
        </p>
        <p class="shd-screen-row">
          <span class="shd-screen-key">A continuación</span>
          <Transition name="shd-slide" mode="out-in"><span :key="next" class="shd-screen-val is-next">{{ next }}</span></Transition>
        </p>
      </div>

      <div class="shd-actions">
        <nav class="shd-nav" aria-label="Principal">
          <a v-for="l in links" :key="l.href" :href="l.href" class="shd-link">{{ l.label }}</a>
          <a :href="accountHref" class="shd-link">{{ accountLabel }}</a>
        </nav>
        <a :href="props.publishHref" class="se-btn se-btn-solid shd-cta" data-cta="publish" data-section="header">Publicar mi seminario</a>
        <button
          ref="menuButton"
          type="button"
          class="shd-menu-btn"
          :aria-label="menuOpen ? 'Cerrar menú' : 'Abrir menú'"
          :aria-expanded="menuOpen ? 'true' : 'false'"
          aria-controls="seminar-menu"
          @click="toggleMenu"
        >
          <X v-if="menuOpen" :size="18" aria-hidden="true" />
          <Menu v-else :size="18" aria-hidden="true" />
        </button>
      </div>
    </div>

    <!-- Filete de progreso (estado: sin transición) -->
    <div class="shd-progress" aria-hidden="true"><span :style="{ transform: `scaleX(${progress})` }"></span></div>

    <Transition name="shd-sheet">
      <div v-if="menuOpen" id="seminar-menu" ref="sheet" class="shd-sheet">
        <a v-for="l in links" :key="l.href" :href="l.href" class="shd-sheet-link" @click="closeMenu()">{{ l.label }}</a>
        <a href="/mis-entradas" class="shd-sheet-link" @click="closeMenu()">Mis entradas</a>
        <a :href="accountHref" class="shd-sheet-link" @click="closeMenu()">{{ accountLabel }}</a>
        <a :href="props.publishHref" class="se-btn se-btn-solid shd-sheet-cta" data-cta="publish" data-section="header_menu">Publicar mi seminario</a>
      </div>
    </Transition>
  </header>
</template>

<style scoped>
.shd {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 40;
  border-bottom: 1px solid var(--border);
  background: rgba(245, 245, 240, 0.92);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  font-family: "Prompt", system-ui, sans-serif;
}
.shd-inner {
  max-width: 1280px;
  height: 64px;
  margin: 0 auto;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.shd-logo {
  display: inline-flex;
  flex: 0 0 auto;
  border-radius: 4px;
}
.shd-logo img {
  height: 26px;
  width: auto;
}
.shd-logo:focus-visible,
.shd-link:focus-visible,
.shd-sheet-link:focus-visible,
.shd-menu-btn:focus-visible {
  outline: 3px solid var(--se-cordon-ink);
  outline-offset: 3px;
}
.shd-screen {
  display: none;
}
.shd-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.shd-nav {
  display: none;
  align-items: center;
  gap: 22px;
}
.shd-link {
  font-size: 14px;
  font-weight: 600;
  color: var(--se-grafito);
  text-decoration: none;
  border-radius: 2px;
}
.shd-link:hover {
  text-decoration: underline;
  text-underline-offset: 4px;
}
.shd-cta {
  display: none;
  min-height: 42px;
  padding: 0 16px;
  font-size: 14px;
}
.shd-menu-btn {
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 2px;
  background: var(--se-grafito);
  color: #ffffff;
  cursor: pointer;
}
.shd-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  pointer-events: none;
}
.shd-progress span {
  position: absolute;
  inset: 0;
  background: var(--se-cordon);
  transform-origin: left center;
}
.shd-sheet {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  padding: 14px 20px 20px;
  display: flex;
  flex-direction: column;
  background: var(--se-papel);
  border-bottom: 1px solid var(--se-grafito);
  box-shadow: 0 16px 32px rgba(21, 25, 28, 0.14);
}
.shd-sheet-link {
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
  font-size: 16px;
  font-weight: 600;
  color: var(--se-grafito);
  text-decoration: none;
}
.shd-sheet-cta {
  margin-top: 16px;
  justify-content: center;
}
.shd-sheet-enter-active,
.shd-sheet-leave-active {
  transition: opacity var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out);
}
.shd-sheet-enter-from,
.shd-sheet-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
.shd-slide-enter-active,
.shd-slide-leave-active {
  transition: opacity 180ms var(--se-ease), transform 180ms var(--se-ease);
}
.shd-slide-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.shd-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
@media (min-width: 1024px) {
  .shd-inner {
    height: 72px;
    padding: 0 40px;
  }
  .shd-logo img {
    height: 30px;
  }
  .shd-actions {
    gap: 22px;
  }
  .shd-nav,
  .shd-cta {
    display: inline-flex;
  }
  .shd-menu-btn,
  .shd-sheet {
    display: none;
  }
}
@media (min-width: 1180px) {
  .shd-screen {
    display: flex;
    flex-direction: column;
    justify-content: center;
    width: 300px;
    height: 40px;
    margin-right: auto;
    margin-left: 12px;
    padding: 0 12px;
    border-radius: 4px;
    background: var(--se-grafito);
    overflow: hidden;
  }
  .shd-screen-row {
    display: flex;
    gap: 8px;
    font-family: var(--se-font);
    font-size: 11px;
    line-height: 16px;
    font-weight: 600;
    font-stretch: 75%;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .shd-screen-key {
    flex: 0 0 104px;
    color: #9aa4a8;
  }
  .shd-screen-key.is-now {
    color: var(--se-proyector);
  }
  .shd-screen-val {
    display: inline-block;
    color: #ffffff;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .shd-screen-val.is-next {
    color: #c9d1d0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .shd-sheet-enter-active,
  .shd-sheet-leave-active,
  .shd-slide-enter-active,
  .shd-slide-leave-active {
    transition-duration: 1ms;
  }
}
</style>
