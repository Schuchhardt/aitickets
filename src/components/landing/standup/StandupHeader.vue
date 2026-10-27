<script setup>
// Header de la landing de stand-up (SPEC_landing_standup §3). Fijo y transparente sobre el hero; pasados 40 px de
// scroll, negro cálido al 82 % con blur y borde. Links: Eventos · Marketing (#redes) · Precio (#precio) · Ingresar y el
// botón lima "Publicar función". En mobile: logo y botón de menú circular sobre el hero. Lleva la barra de progreso
// de lectura (S16). Con sesión de productor, "Ingresar" pasa a "Ir a mi panel" (igual que LandingHeader).
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Menu, X } from 'lucide-vue-next'
import logo from '../../../images/logo.png'
import { fetchSession } from '../../../lib/sessionHints.js'
import ReadingProgress from './ReadingProgress.vue'

const props = defineProps({
  publishHref: { type: String, required: true },
})

const scrolled = ref(false)
const menuOpen = ref(false)
const menuButton = ref(null)
const sheet = ref(null)
const producer = ref(null)
const accountHref = computed(() => (producer.value ? '/dashboard' : '/organizadores/login'))
const accountLabel = computed(() => (producer.value ? 'Ir a mi panel' : 'Ingresar'))

const links = [
  { href: '/eventos', label: 'Eventos' },
  { href: '#redes', label: 'Marketing' },
  { href: '#precio', label: 'Precio' },
]

const onScroll = () => {
  scrolled.value = window.scrollY > 40
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
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
  document.addEventListener('keydown', onKeydown)
  fetchSession().then((s) => {
    producer.value = s?.producer || null
  })
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <!-- Una sola raíz (la página le pasa atributos de Astro): la barra de lectura y el header van adentro, ambos fijos -->
  <div class="sh-root">
  <ReadingProgress />
  <header class="sh" :class="{ 'is-scrolled': scrolled || menuOpen }" data-testid="standup-header">
    <div class="sh-inner">
      <a href="/" class="sh-logo" aria-label="AI Tickets, inicio">
        <img :src="logo.src" alt="" width="152" height="32" />
      </a>

      <nav class="sh-nav" aria-label="Principal">
        <a v-for="l in links" :key="l.href" :href="l.href" class="sh-link">{{ l.label }}</a>
        <a :href="accountHref" class="sh-link">{{ accountLabel }}</a>
        <a :href="props.publishHref" class="sh-cta" data-cta="publish" data-section="header">Publicar función</a>
      </nav>

      <button
        ref="menuButton"
        type="button"
        class="sh-menu-btn"
        :aria-label="menuOpen ? 'Cerrar menú' : 'Abrir menú'"
        :aria-expanded="menuOpen ? 'true' : 'false'"
        aria-controls="standup-menu"
        @click="toggleMenu"
      >
        <X v-if="menuOpen" :size="18" aria-hidden="true" />
        <Menu v-else :size="18" aria-hidden="true" />
      </button>
    </div>

    <Transition name="sh-sheet">
      <div v-if="menuOpen" id="standup-menu" ref="sheet" class="sh-sheet">
        <a v-for="l in links" :key="l.href" :href="l.href" class="sh-sheet-link" @click="closeMenu()">{{ l.label }}</a>
        <a href="/mis-entradas" class="sh-sheet-link" @click="closeMenu()">Mis entradas</a>
        <a :href="accountHref" class="sh-sheet-link" @click="closeMenu()">{{ accountLabel }}</a>
        <a :href="props.publishHref" class="su-btn su-btn-lime sh-sheet-cta" data-cta="publish" data-section="header_menu">Publicar función</a>
      </div>
    </Transition>
  </header>
  </div>
</template>

<style scoped>
.sh {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 40;
  border-bottom: 1px solid transparent;
  background: rgba(14, 11, 9, 0);
  font-family: "Prompt", system-ui, sans-serif;
  transition: background-color 240ms var(--ease-out), border-color 240ms var(--ease-out);
}
.sh.is-scrolled {
  background: rgba(14, 11, 9, 0.82);
  border-bottom-color: var(--sb-line);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
}
.sh-inner {
  max-width: 1280px;
  height: 64px;
  margin: 0 auto;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.sh-logo {
  display: inline-flex;
  border-radius: 6px;
}
/* El logo es negro: invertido queda crema sobre el fondo oscuro (como el del prototipo) */
.sh-logo img {
  height: 26px;
  width: auto;
  filter: invert(1);
}
.sh-logo:focus-visible,
.sh-link:focus-visible,
.sh-sheet-link:focus-visible {
  outline: 2px solid #f4ede4;
  outline-offset: 3px;
}
.sh-nav {
  display: none;
  align-items: center;
  gap: 30px;
}
.sh-link {
  font-size: 14px;
  font-weight: 500;
  color: #d9d0c5;
  text-decoration: none;
  border-radius: 4px;
  transition: color var(--dur-1) var(--ease-out);
}
.sh-link:hover {
  color: #fff;
}
.sh-cta {
  display: inline-flex;
  align-items: center;
  height: 40px;
  padding: 0 18px;
  border-radius: 999px;
  background: var(--brand-lime);
  color: #0e0b09;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  transition: transform var(--dur-1) var(--ease-out), box-shadow var(--dur-2) var(--ease-out);
}
.sh-cta:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 30px rgba(154, 230, 0, 0.25);
}
.sh-cta:focus-visible,
.sh-menu-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px #0e0b09, 0 0 0 6px var(--brand-lime);
}
.sh-menu-btn {
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(244, 237, 228, 0.24);
  border-radius: 50%;
  background: rgba(14, 11, 9, 0.35);
  color: #f4ede4;
  cursor: pointer;
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}
.sh-sheet {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  padding: 8px 16px 20px;
  display: flex;
  flex-direction: column;
  background: #0e0b09;
  border-bottom: 1px solid rgba(244, 237, 228, 0.12);
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.4);
}
.sh-sheet-link {
  padding: 14px 0;
  border-bottom: 1px solid rgba(244, 237, 228, 0.12);
  font-size: 16px;
  font-weight: 500;
  color: #f4ede4;
  text-decoration: none;
}
.sh-sheet-cta {
  margin-top: 16px;
}
.sh-sheet-enter-active,
.sh-sheet-leave-active {
  transition: opacity var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out);
}
.sh-sheet-enter-from,
.sh-sheet-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
@media (min-width: 900px) {
  .sh-inner {
    height: 72px;
    padding: 0 40px;
  }
  .sh-logo img {
    height: 30px;
  }
  .sh-nav {
    display: flex;
  }
  .sh-menu-btn,
  .sh-sheet {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sh,
  .sh-cta,
  .sh-sheet-enter-active,
  .sh-sheet-leave-active {
    transition-duration: 1ms;
  }
}
</style>
