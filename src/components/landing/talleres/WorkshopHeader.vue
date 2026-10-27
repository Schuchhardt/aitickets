<script setup>
// Header de la landing de talleres (SPEC_landing_talleres §3), con el patrón de TheatreHeader: fijo y transparente sobre
// el hero; pasados 40 px de scroll, papel al 90 % con blur y un borde inferior. Links: Tu taller · El día · Precio ·
// Espacios · Ingresar y el botón de cartón lima "Abrir inscripciones" (40 px de alto, sombra de 3 px). En mobile: logo y
// botón de menú de cartón de 44 × 44. Lleva la barra de progreso de lectura en azul lápiz pasta (TL19). Con sesión de
// productor, "Ingresar" pasa a "Ir a mi panel".
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Menu, X } from 'lucide-vue-next'
import logo from '../../../images/logo.png'
import { fetchSession } from '../../../lib/sessionHints.js'
import ReadingProgress from '../standup/ReadingProgress.vue'

const props = defineProps({
  publishHref: { type: String, required: true },
  ctaLabel: { type: String, required: true },
})

const scrolled = ref(false)
const menuOpen = ref(false)
const menuButton = ref(null)
const sheet = ref(null)
const producer = ref(null)
const accountHref = computed(() => (producer.value ? '/dashboard' : '/organizadores/login'))
const accountLabel = computed(() => (producer.value ? 'Ir a mi panel' : 'Ingresar'))

const links = [
  { href: '#arma', label: 'Tu taller' },
  { href: '#el-dia', label: 'El día' },
  { href: '#precio', label: 'Precio' },
  { href: '#espacios', label: 'Espacios' },
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
  <div class="whd-root">
  <ReadingProgress color="var(--tl-tinta)" />
  <header class="whd" :class="{ 'is-scrolled': scrolled || menuOpen }" data-testid="workshop-header">
    <div class="whd-inner">
      <a href="/" class="whd-logo" aria-label="AI Tickets, inicio">
        <img :src="logo.src" alt="" width="152" height="32" />
      </a>

      <nav class="whd-nav" aria-label="Principal">
        <a v-for="l in links" :key="l.href" :href="l.href" class="whd-link">{{ l.label }}</a>
        <a :href="accountHref" class="whd-link">{{ accountLabel }}</a>
        <a :href="props.publishHref" class="tl-btn tl-btn-lime tl-btn-sm whd-cta" data-cta="publish" data-section="header">{{ props.ctaLabel }}</a>
      </nav>

      <button
        ref="menuButton"
        type="button"
        class="whd-menu-btn"
        :aria-label="menuOpen ? 'Cerrar menú' : 'Abrir menú'"
        :aria-expanded="menuOpen ? 'true' : 'false'"
        aria-controls="workshop-menu"
        @click="toggleMenu"
      >
        <X v-if="menuOpen" :size="18" aria-hidden="true" />
        <Menu v-else :size="18" aria-hidden="true" />
      </button>
    </div>

    <Transition name="whd-sheet">
      <div v-if="menuOpen" id="workshop-menu" ref="sheet" class="whd-sheet">
        <a v-for="l in links" :key="l.href" :href="l.href" class="whd-sheet-link" @click="closeMenu()">{{ l.label }}</a>
        <a href="/mis-entradas" class="whd-sheet-link" @click="closeMenu()">Mis entradas</a>
        <a :href="accountHref" class="whd-sheet-link" @click="closeMenu()">{{ accountLabel }}</a>
        <a :href="props.publishHref" class="tl-btn tl-btn-lime whd-sheet-cta" data-cta="publish" data-section="header_menu">{{ props.ctaLabel }}</a>
      </div>
    </Transition>
  </header>
  </div>
</template>

<style scoped>
.whd {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 40;
  border-bottom: 1px solid transparent;
  background: rgba(244, 246, 241, 0);
  font-family: "Prompt", system-ui, sans-serif;
  transition: background-color 240ms var(--ease-out), border-color 240ms var(--ease-out);
}
.whd.is-scrolled {
  background: rgba(244, 246, 241, 0.9);
  border-bottom-color: var(--tl-line);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
}
.whd-inner {
  max-width: 1280px;
  height: 64px;
  margin: 0 auto;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.whd-logo {
  display: inline-flex;
  border-radius: 4px;
}
.whd-logo img {
  height: 26px;
  width: auto;
}
.whd-logo:focus-visible,
.whd-link:focus-visible,
.whd-sheet-link:focus-visible {
  outline: 2px solid var(--tl-tinta);
  outline-offset: 3px;
}
.whd-nav {
  display: none;
  align-items: center;
  gap: 26px;
}
.whd-link {
  font-size: 14px;
  font-weight: 500;
  color: var(--tl-grafito-2);
  text-decoration: none;
  border-radius: 2px;
  transition: color var(--dur-1) var(--ease-out);
}
.whd-link:hover {
  color: var(--tl-grafito);
}
.whd-cta {
  min-height: 40px;
}
.whd-menu-btn {
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--tl-grafito);
  border-radius: 10px;
  background: var(--tl-ficha);
  box-shadow: 2px 2px 0 var(--tl-grafito);
  color: var(--tl-grafito);
  cursor: pointer;
}
.whd-menu-btn:active {
  transform: translate(2px, 2px);
  box-shadow: 0 0 0 var(--tl-grafito);
}
.whd-menu-btn:focus-visible {
  outline: 3px solid var(--tl-tinta);
  outline-offset: 2px;
}
.whd-sheet {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  padding: 8px 16px 20px;
  display: flex;
  flex-direction: column;
  background: var(--tl-papel);
  border-bottom: 2px solid var(--tl-grafito);
}
.whd-sheet-link {
  padding: 14px 0;
  border-bottom: 1px solid var(--tl-line);
  font-size: 16px;
  font-weight: 500;
  color: var(--tl-grafito);
  text-decoration: none;
}
.whd-sheet-cta {
  margin-top: 16px;
}
.whd-sheet-enter-active,
.whd-sheet-leave-active {
  transition: opacity var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out);
}
.whd-sheet-enter-from,
.whd-sheet-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
@media (min-width: 900px) {
  .whd-inner {
    height: 72px;
    padding: 0 40px;
  }
  .whd-logo img {
    height: 30px;
  }
  .whd-nav {
    display: flex;
  }
  .whd-menu-btn,
  .whd-sheet {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .whd,
  .whd-sheet-enter-active,
  .whd-sheet-leave-active {
    transition-duration: 1ms;
  }
}
</style>
