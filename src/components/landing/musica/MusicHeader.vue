<script setup>
// Header de la landing de música (SPEC_landing_musica §3), con el patrón de StandupHeader: fijo y transparente sobre
// el hero; pasados 40 px de scroll, negro escenario al 86 % con blur y borde. Links: Cómo se vende · Puerta · Precio ·
// Ingresar y el botón lima "Publicar fecha" (radio 6, no pill). En mobile: logo y botón de menú cuadrado. Lleva la
// barra de progreso de lectura en rojo de sala (M17). Con sesión de productor, "Ingresar" pasa a "Ir a mi panel".
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Menu, X } from 'lucide-vue-next'
import logo from '../../../images/logo.png'
import { fetchSession } from '../../../lib/sessionHints.js'
import ReadingProgress from '../standup/ReadingProgress.vue'

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
  { href: '#como-se-vende', label: 'Cómo se vende' },
  { href: '#puerta', label: 'Puerta' },
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
  <div class="mhd-root">
  <ReadingProgress color="var(--mu-red)" />
  <header class="mhd" :class="{ 'is-scrolled': scrolled || menuOpen }" data-testid="music-header">
    <div class="mhd-inner">
      <a href="/" class="mhd-logo" aria-label="AI Tickets, inicio">
        <img :src="logo.src" alt="" width="152" height="32" />
      </a>

      <nav class="mhd-nav" aria-label="Principal">
        <a v-for="l in links" :key="l.href" :href="l.href" class="mhd-link">{{ l.label }}</a>
        <a :href="accountHref" class="mhd-link">{{ accountLabel }}</a>
        <a :href="props.publishHref" class="mhd-cta" data-cta="publish" data-section="header">Publicar fecha</a>
      </nav>

      <button
        ref="menuButton"
        type="button"
        class="mhd-menu-btn"
        :aria-label="menuOpen ? 'Cerrar menú' : 'Abrir menú'"
        :aria-expanded="menuOpen ? 'true' : 'false'"
        aria-controls="music-menu"
        @click="toggleMenu"
      >
        <X v-if="menuOpen" :size="18" aria-hidden="true" />
        <Menu v-else :size="18" aria-hidden="true" />
      </button>
    </div>

    <Transition name="mhd-sheet">
      <div v-if="menuOpen" id="music-menu" ref="sheet" class="mhd-sheet">
        <a v-for="l in links" :key="l.href" :href="l.href" class="mhd-sheet-link" @click="closeMenu()">{{ l.label }}</a>
        <a href="/mis-entradas" class="mhd-sheet-link" @click="closeMenu()">Mis entradas</a>
        <a :href="accountHref" class="mhd-sheet-link" @click="closeMenu()">{{ accountLabel }}</a>
        <a :href="props.publishHref" class="mu-btn mu-btn-lime mhd-sheet-cta" data-cta="publish" data-section="header_menu">Publicar fecha</a>
      </div>
    </Transition>
  </header>
  </div>
</template>

<style scoped>
.mhd {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 40;
  border-bottom: 1px solid transparent;
  background: rgba(10, 10, 13, 0);
  font-family: "Prompt", system-ui, sans-serif;
  transition: background-color 240ms var(--ease-out), border-color 240ms var(--ease-out);
}
.mhd.is-scrolled {
  background: rgba(10, 10, 13, 0.86);
  border-bottom-color: var(--mu-line);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
}
.mhd-inner {
  max-width: 1280px;
  height: 64px;
  margin: 0 auto;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.mhd-logo {
  display: inline-flex;
  border-radius: 4px;
}
/* El logo es negro: invertido queda claro sobre el fondo oscuro */
.mhd-logo img {
  height: 26px;
  width: auto;
  filter: invert(1);
}
.mhd-logo:focus-visible,
.mhd-link:focus-visible,
.mhd-sheet-link:focus-visible {
  outline: 2px solid var(--mu-text-1);
  outline-offset: 3px;
}
.mhd-nav {
  display: none;
  align-items: center;
  gap: 28px;
}
.mhd-link {
  font-size: 14px;
  font-weight: 500;
  color: var(--mu-text-2);
  text-decoration: none;
  border-radius: 2px;
  transition: color var(--dur-1) var(--ease-out);
}
.mhd-link:hover {
  color: #fff;
}
.mhd-cta {
  display: inline-flex;
  align-items: center;
  height: 40px;
  padding: 0 16px;
  border-radius: 6px;
  background: var(--brand-lime);
  color: var(--mu-ink);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  transition: transform var(--dur-1) var(--ease-out);
}
.mhd-cta:hover {
  transform: translateY(-2px);
}
.mhd-cta:focus-visible,
.mhd-menu-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--mu-stage), 0 0 0 6px var(--brand-lime);
}
.mhd-menu-btn {
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(242, 240, 235, 0.28);
  border-radius: 6px;
  background: rgba(10, 10, 13, 0.4);
  color: var(--mu-text-1);
  cursor: pointer;
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}
.mhd-sheet {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  padding: 8px 20px 20px;
  display: flex;
  flex-direction: column;
  background: var(--mu-stage);
  border-bottom: 1px solid var(--mu-line);
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.5);
}
.mhd-sheet-link {
  padding: 14px 0;
  border-bottom: 1px solid var(--mu-line);
  font-size: 16px;
  font-weight: 500;
  color: var(--mu-text-1);
  text-decoration: none;
}
.mhd-sheet-cta {
  margin-top: 16px;
}
.mhd-sheet-enter-active,
.mhd-sheet-leave-active {
  transition: opacity var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out);
}
.mhd-sheet-enter-from,
.mhd-sheet-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
@media (min-width: 900px) {
  .mhd-inner {
    height: 72px;
    padding: 0 40px;
  }
  .mhd-logo img {
    height: 30px;
  }
  .mhd-nav {
    display: flex;
  }
  .mhd-menu-btn,
  .mhd-sheet {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .mhd,
  .mhd-cta,
  .mhd-sheet-enter-active,
  .mhd-sheet-leave-active {
    transition-duration: 1ms;
  }
}
</style>
