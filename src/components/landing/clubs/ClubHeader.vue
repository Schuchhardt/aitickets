<script setup>
// Header de la landing de clubs (SPEC_landing_clubs §3), con el patrón de MusicHeader: fijo y transparente sobre el
// hero; pasados 40 px de scroll, negro violáceo al 84 % con blur y borde. Links: Noches · La lista · La puerta · Precio ·
// Ingresar y el botón lima "Publicar mi noche" (radio 12). En vez de la barra de lectura lleva el reloj de la noche
// (NightClock), a la izquierda del botón; en mobile va junto al botón de menú (44×44, radio 12). Es un solo reloj para
// los dos tamaños (un par de listeners): CSS esconde los links y el botón lima en mobile, y el menú en desktop. Con
// sesión de productor, "Ingresar" pasa a "Ir a mi panel".
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Menu, X } from 'lucide-vue-next'
import logo from '../../../images/logo.png'
import { fetchSession } from '../../../lib/sessionHints.js'
import NightClock from './NightClock.vue'

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
  { href: '#noches', label: 'Noches' },
  { href: '#lista', label: 'La lista' },
  { href: '#puerta', label: 'La puerta' },
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
  <header class="chd" :class="{ 'is-scrolled': scrolled || menuOpen }" data-testid="club-header">
    <div class="chd-inner">
      <a href="/" class="chd-logo" aria-label="AI Tickets, inicio">
        <img :src="logo.src" alt="" width="152" height="32" />
      </a>

      <div class="chd-actions">
        <nav class="chd-nav" aria-label="Principal">
          <a v-for="l in links" :key="l.href" :href="l.href" class="chd-link">{{ l.label }}</a>
          <a :href="accountHref" class="chd-link">{{ accountLabel }}</a>
        </nav>
        <NightClock />
        <a :href="props.publishHref" class="chd-cta" data-cta="publish" data-section="header">Publicar mi noche</a>
        <button
          ref="menuButton"
          type="button"
          class="chd-menu-btn"
          :aria-label="menuOpen ? 'Cerrar menú' : 'Abrir menú'"
          :aria-expanded="menuOpen ? 'true' : 'false'"
          aria-controls="club-menu"
          @click="toggleMenu"
        >
          <X v-if="menuOpen" :size="18" aria-hidden="true" />
          <Menu v-else :size="18" aria-hidden="true" />
        </button>
      </div>
    </div>

    <Transition name="chd-sheet">
      <div v-if="menuOpen" id="club-menu" ref="sheet" class="chd-sheet">
        <a v-for="l in links" :key="l.href" :href="l.href" class="chd-sheet-link" @click="closeMenu()">{{ l.label }}</a>
        <a href="/mis-entradas" class="chd-sheet-link" @click="closeMenu()">Mis entradas</a>
        <a :href="accountHref" class="chd-sheet-link" @click="closeMenu()">{{ accountLabel }}</a>
        <a :href="props.publishHref" class="cl-btn cl-btn-lime chd-sheet-cta" data-cta="publish" data-section="header_menu">Publicar mi noche</a>
      </div>
    </Transition>
  </header>
</template>

<style scoped>
.chd {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 40;
  border-bottom: 1px solid transparent;
  background: rgba(7, 6, 11, 0);
  font-family: "Prompt", system-ui, sans-serif;
  transition: background-color 240ms var(--ease-out), border-color 240ms var(--ease-out);
}
.chd.is-scrolled {
  background: rgba(7, 6, 11, 0.84);
  border-bottom-color: var(--cl-line);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
}
.chd-inner {
  max-width: 1280px;
  height: 64px;
  margin: 0 auto;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.chd-logo {
  display: inline-flex;
  border-radius: 4px;
}
/* El logo es negro: invertido queda claro sobre el fondo oscuro */
.chd-logo img {
  height: 26px;
  width: auto;
  filter: invert(1);
}
.chd-logo:focus-visible,
.chd-link:focus-visible,
.chd-sheet-link:focus-visible {
  outline: 2px solid var(--cl-text-1);
  outline-offset: 3px;
}
.chd-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.chd-nav {
  display: none;
  align-items: center;
  gap: 24px;
}
.chd-link {
  font-size: 14px;
  font-weight: 500;
  color: var(--cl-text-2);
  text-decoration: none;
  border-radius: 2px;
  transition: color var(--dur-1) var(--ease-out);
}
.chd-link:hover {
  color: #fff;
}
.chd-cta {
  display: none;
  align-items: center;
  height: 40px;
  padding: 0 16px;
  border-radius: 12px;
  background: var(--brand-lime);
  color: var(--cl-ink);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35), inset 0 -8px 14px rgba(255, 255, 255, 0.28);
  transition: transform var(--dur-1) var(--ease-out);
}
.chd-cta:hover {
  transform: translateY(-2px);
}
.chd-cta:focus-visible,
.chd-menu-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--cl-noche), 0 0 0 6px var(--brand-lime);
}
.chd-menu-btn {
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--cl-line-strong);
  border-radius: 12px;
  background: rgba(7, 6, 11, 0.4);
  color: var(--cl-text-1);
  cursor: pointer;
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}
.chd-sheet {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  padding: 8px 20px 20px;
  display: flex;
  flex-direction: column;
  background: var(--cl-noche);
  border-bottom: 1px solid var(--cl-line);
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.5);
}
.chd-sheet-link {
  padding: 14px 0;
  border-bottom: 1px solid var(--cl-line);
  font-size: 16px;
  font-weight: 500;
  color: var(--cl-text-1);
  text-decoration: none;
}
.chd-sheet-cta {
  margin-top: 16px;
}
.chd-sheet-enter-active,
.chd-sheet-leave-active {
  transition: opacity var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out);
}
.chd-sheet-enter-from,
.chd-sheet-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
@media (min-width: 1024px) {
  .chd-inner {
    height: 72px;
    padding: 0 40px;
  }
  .chd-logo img {
    height: 30px;
  }
  .chd-actions {
    gap: 24px;
  }
  .chd-nav {
    display: flex;
  }
  .chd-cta {
    display: inline-flex;
  }
  .chd-menu-btn,
  .chd-sheet {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .chd,
  .chd-cta,
  .chd-sheet-enter-active,
  .chd-sheet-leave-active {
    transition-duration: 1ms;
  }
}
</style>
