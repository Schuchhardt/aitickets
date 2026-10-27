<script setup>
// Header de la landing de teatro (SPEC_landing_teatro §3), con el patrón de MusicHeader: fijo y transparente sobre el
// hero; pasados 40 px de scroll, azul de sala al 86 % con blur y un filete inferior dorado al 25 %. Links: La obra ·
// Temporada · Puerta · Precio · Ingresar y el botón lima en píldora "Publicar mi obra". En mobile: logo y botón de menú
// circular de 44 × 44 con borde dorado. Lleva la barra de progreso de lectura en dorado (T19). Con sesión de
// productor, "Ingresar" pasa a "Ir a mi panel".
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
  { href: '#obra', label: 'La obra' },
  { href: '#temporada', label: 'Temporada' },
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
  <div class="thd-root">
  <ReadingProgress color="var(--te-oro)" />
  <header class="thd" :class="{ 'is-scrolled': scrolled || menuOpen }" data-testid="theatre-header">
    <div class="thd-inner">
      <a href="/" class="thd-logo" aria-label="AI Tickets, inicio">
        <img :src="logo.src" alt="" width="152" height="32" />
      </a>

      <nav class="thd-nav" aria-label="Principal">
        <a v-for="l in links" :key="l.href" :href="l.href" class="thd-link">{{ l.label }}</a>
        <a :href="accountHref" class="thd-link">{{ accountLabel }}</a>
        <a :href="props.publishHref" class="thd-cta" data-cta="publish" data-section="header">Publicar mi obra</a>
      </nav>

      <button
        ref="menuButton"
        type="button"
        class="thd-menu-btn"
        :aria-label="menuOpen ? 'Cerrar menú' : 'Abrir menú'"
        :aria-expanded="menuOpen ? 'true' : 'false'"
        aria-controls="theatre-menu"
        @click="toggleMenu"
      >
        <X v-if="menuOpen" :size="18" aria-hidden="true" />
        <Menu v-else :size="18" aria-hidden="true" />
      </button>
    </div>

    <Transition name="thd-sheet">
      <div v-if="menuOpen" id="theatre-menu" ref="sheet" class="thd-sheet">
        <a v-for="l in links" :key="l.href" :href="l.href" class="thd-sheet-link" @click="closeMenu()">{{ l.label }}</a>
        <a href="/mis-entradas" class="thd-sheet-link" @click="closeMenu()">Mis entradas</a>
        <a :href="accountHref" class="thd-sheet-link" @click="closeMenu()">{{ accountLabel }}</a>
        <a :href="props.publishHref" class="te-btn te-btn-lime thd-sheet-cta" data-cta="publish" data-section="header_menu">Publicar mi obra</a>
      </div>
    </Transition>
  </header>
  </div>
</template>

<style scoped>
.thd {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 40;
  border-bottom: 1px solid transparent;
  background: rgba(12, 18, 32, 0);
  font-family: "Prompt", system-ui, sans-serif;
  transition: background-color 240ms var(--ease-out), border-color 240ms var(--ease-out);
}
.thd.is-scrolled {
  background: rgba(12, 18, 32, 0.86);
  border-bottom-color: rgba(212, 175, 106, 0.25);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
}
.thd-inner {
  max-width: 1280px;
  height: 64px;
  margin: 0 auto;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.thd-logo {
  display: inline-flex;
  border-radius: 4px;
}
/* El logo es negro: invertido queda claro sobre el fondo oscuro */
.thd-logo img {
  height: 26px;
  width: auto;
  filter: invert(1);
}
.thd-logo:focus-visible,
.thd-link:focus-visible,
.thd-sheet-link:focus-visible {
  outline: 2px solid var(--te-text-1);
  outline-offset: 3px;
}
.thd-nav {
  display: none;
  align-items: center;
  gap: 28px;
}
.thd-link {
  font-size: 14px;
  font-weight: 500;
  color: var(--te-text-2);
  text-decoration: none;
  border-radius: 2px;
  transition: color var(--dur-1) var(--ease-out);
}
.thd-link:hover {
  color: #fff;
}
.thd-cta {
  display: inline-flex;
  align-items: center;
  height: 40px;
  padding: 0 18px;
  border-radius: 999px;
  background: var(--brand-lime);
  color: var(--te-ink);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  transition: transform var(--dur-1) var(--ease-out);
}
.thd-cta:hover {
  transform: translateY(-2px);
}
.thd-cta:focus-visible,
.thd-menu-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--te-sala), 0 0 0 6px var(--brand-lime);
}
.thd-menu-btn {
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(212, 175, 106, 0.7);
  border-radius: 50%;
  background: rgba(12, 18, 32, 0.4);
  color: var(--te-text-1);
  cursor: pointer;
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}
.thd-sheet {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  padding: 8px 20px 20px;
  display: flex;
  flex-direction: column;
  background: var(--te-sala);
  border-bottom: 1px solid var(--te-line);
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.5);
}
.thd-sheet-link {
  padding: 14px 0;
  border-bottom: 1px solid var(--te-line);
  font-size: 16px;
  font-weight: 500;
  color: var(--te-text-1);
  text-decoration: none;
}
.thd-sheet-cta {
  margin-top: 16px;
}
.thd-sheet-enter-active,
.thd-sheet-leave-active {
  transition: opacity var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out);
}
.thd-sheet-enter-from,
.thd-sheet-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
@media (min-width: 900px) {
  .thd-inner {
    height: 72px;
    padding: 0 40px;
  }
  .thd-logo img {
    height: 30px;
  }
  .thd-nav {
    display: flex;
  }
  .thd-menu-btn,
  .thd-sheet {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .thd,
  .thd-cta,
  .thd-sheet-enter-active,
  .thd-sheet-leave-active {
    transition-duration: 1ms;
  }
}
</style>
